use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

const MAX_PROJECT_FILE_BYTES: u64 = 10 * 1024 * 1024;
const PROJECT_EXTENSION: &str = "pflow";
const PROJECT_FILTER_NAME: &str = "Proto Flow project";
const MAX_IMAGE_FILE_BYTES: u64 = 25 * 1024 * 1024;
const IMAGE_ASSET_DIRECTORY: &str = "assets";

#[derive(Serialize)]
pub struct OpenedProject {
    path: String,
    content: String,
}

#[derive(Serialize)]
pub struct ImageAsset {
    path: String,
    mime: String,
    base64: String,
}

#[derive(Serialize)]
pub struct ImageFile {
    name: String,
    mime: String,
    size: usize,
    base64: String,
}

fn validate_project_path(path: &Path) -> Result<(), String> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(PROJECT_EXTENSION))
    {
        return Err("Proto Flow project files must use the .pflow extension.".into());
    }
    Ok(())
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The selected project path is not valid Unicode.".into())
}

fn selected_path(selected: FilePath) -> Result<PathBuf, String> {
    selected
        .into_path()
        .map_err(|error| format!("Could not resolve the selected project path: {error}"))
}

fn with_project_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension(PROJECT_EXTENSION)
    }
}

fn save_dialog(app: &AppHandle, default_filename: &str) -> Result<Option<PathBuf>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter(PROJECT_FILTER_NAME, &[PROJECT_EXTENSION])
        .set_file_name(default_filename)
        .blocking_save_file();
    selected.map(selected_path).transpose()
}

fn open_dialog(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter(PROJECT_FILTER_NAME, &[PROJECT_EXTENSION])
        .blocking_pick_file();
    selected.map(selected_path).transpose()
}

struct StagedProjectFile {
    path: Option<PathBuf>,
}

impl StagedProjectFile {
    fn create(target: &Path, content: &str) -> Result<Self, String> {
        let parent = target
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        if target.file_name().is_none() {
            return Err("The project path must include a file name.".into());
        }

        for _ in 0..10 {
            let temp_name = format!(".protoflow-{}.tmp", Uuid::new_v4());
            let temp_path = parent.join(temp_name);
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)
            {
                Ok(mut file) => {
                    if let Err(error) = write_and_sync(&mut file, content.as_bytes()) {
                        let _ = fs::remove_file(&temp_path);
                        return Err(format!("Could not write temporary project file: {error}"));
                    }
                    return Ok(Self {
                        path: Some(temp_path),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!("Could not create temporary project file: {error}"));
                }
            }
        }

        Err("Could not allocate a temporary project file.".into())
    }

    fn commit(mut self, target: &Path) -> Result<(), String> {
        let temp_path = self
            .path
            .as_ref()
            .ok_or_else(|| "The temporary project file is no longer available.".to_owned())?;
        replace_file(temp_path, target)
            .map_err(|error| format!("Could not replace the project file: {error}"))?;
        self.path = None;

        #[cfg(unix)]
        {
            let parent = target
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("Could not sync the project directory: {error}"))?;
        }

        Ok(())
    }
}

impl Drop for StagedProjectFile {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_file(path);
        }
    }
}

fn write_and_sync(file: &mut File, content: &[u8]) -> std::io::Result<()> {
    file.write_all(content)?;
    file.sync_all()
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

fn atomic_write_project(path: &Path, content: &str) -> Result<(), String> {
    validate_project_path(path)?;
    if content.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Err("This project file exceeds the 10 MB limit.".into());
    }
    StagedProjectFile::create(path, content)?.commit(path)
}

fn safe_default_filename(filename: &str) -> String {
    let file_name = Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled project");
    let sanitized: String = file_name
        .chars()
        .map(|character| {
            if character.is_control() || r#"<>:"/\|?*"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let stem = Path::new(&sanitized)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Untitled project");
    format!("{stem}.{PROJECT_EXTENSION}")
}

fn project_default_filename(content: &str) -> String {
    let project_name = serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|project| project.get("name")?.as_str().map(str::to_owned))
        .unwrap_or_else(|| "Untitled project".into());
    safe_default_filename(&project_name)
}

#[tauri::command]
pub fn save_project(
    app: AppHandle,
    path: Option<String>,
    content: String,
) -> Result<Option<String>, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match save_dialog(&app, &project_default_filename(&content))? {
            Some(path) => with_project_extension(path),
            None => return Ok(None),
        },
    };
    atomic_write_project(&path, &content)?;
    path_to_string(&path).map(Some)
}

#[tauri::command]
pub fn open_project(app: AppHandle) -> Result<Option<OpenedProject>, String> {
    let Some(path) = open_dialog(&app)? else {
        return Ok(None);
    };
    validate_project_path(&path)?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not inspect project file: {error}"))?;
    if metadata.len() > MAX_PROJECT_FILE_BYTES {
        return Err("This project file exceeds the 10 MB limit.".into());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read project file: {error}"))?;
    Ok(Some(OpenedProject {
        path: path_to_string(&path)?,
        content,
    }))
}

#[tauri::command]
pub fn save_project_as(
    app: AppHandle,
    default_filename: String,
    content: String,
) -> Result<Option<String>, String> {
    let Some(path) = save_dialog(&app, &safe_default_filename(&default_filename))? else {
        return Ok(None);
    };
    let path = with_project_extension(path);
    atomic_write_project(&path, &content)?;
    path_to_string(&path).map(Some)
}

#[tauri::command]
pub fn pick_project_save_path(
    app: AppHandle,
    default_filename: String,
) -> Result<Option<String>, String> {
    let Some(path) = save_dialog(&app, &safe_default_filename(&default_filename))? else {
        return Ok(None);
    };
    path_to_string(&with_project_extension(path)).map(Some)
}

fn project_assets_directory(project_path: &Path) -> Result<PathBuf, String> {
    validate_project_path(project_path)?;
    let parent = project_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    Ok(parent.join(IMAGE_ASSET_DIRECTORY))
}

fn image_extension(mime: &str) -> Result<&'static str, String> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/svg+xml" => Ok("svg"),
        "image/webp" => Ok("webp"),
        _ => Err("Unsupported image. Choose a PNG, JPG, SVG, or WebP file.".into()),
    }
}

fn validate_image_bytes(mime: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("The selected image file is empty.".into());
    }
    if bytes.len() as u64 > MAX_IMAGE_FILE_BYTES {
        return Err("Images must be 25 MB or smaller.".into());
    }

    let valid = match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "image/svg+xml" => {
            let text = std::str::from_utf8(bytes)
                .map_err(|_| "The SVG image is not valid UTF-8.".to_owned())?;
            let normalized = text.to_ascii_lowercase();
            let starts_with_svg = normalized.trim_start().starts_with("<svg")
                || (normalized.trim_start().starts_with("<?xml") && normalized.contains("<svg"));
            starts_with_svg
                && !normalized.contains("<script")
                && !normalized.contains("<foreignobject")
                && !normalized.contains("javascript:")
                && !normalized.contains("file:")
                && !normalized.contains("http:")
                && !normalized.contains("https:")
                && !normalized.contains(" onload")
                && !normalized.contains(" onclick")
        }
        _ => false,
    };
    if !valid {
        return Err("The selected image format does not match its contents.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn save_image_asset(
    project_path: String,
    mime: String,
    base64: String,
) -> Result<String, String> {
    let bytes = BASE64
        .decode(base64)
        .map_err(|error| format!("Could not decode the image data: {error}"))?;
    validate_image_bytes(&mime, &bytes)?;
    let extension = image_extension(&mime)?;
    let directory = project_assets_directory(Path::new(&project_path))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the project assets folder: {error}"))?;
    let file_name = format!("{}.{}", Uuid::new_v4(), extension);
    let destination = directory.join(&file_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| format!("Could not create the image asset: {error}"))?;
    write_and_sync(&mut file, &bytes)
        .map_err(|error| format!("Could not save the image asset: {error}"))?;
    Ok(format!("{IMAGE_ASSET_DIRECTORY}/{file_name}"))
}

#[tauri::command]
pub fn read_image_asset(project_path: String, asset_path: String) -> Result<ImageAsset, String> {
    let project_path = Path::new(&project_path);
    let directory = project_assets_directory(project_path)?;
    let relative = Path::new(&asset_path);
    let mut components = relative.components();
    if !matches!(components.next(), Some(std::path::Component::Normal(name)) if name == IMAGE_ASSET_DIRECTORY)
        || !matches!(components.next(), Some(std::path::Component::Normal(_)))
        || components.next().is_some()
    {
        return Err("The project image asset path is invalid.".into());
    }

    let directory_metadata = fs::symlink_metadata(&directory)
        .map_err(|error| format!("Could not inspect the project assets folder: {error}"))?;
    if !directory_metadata.is_dir() || directory_metadata.file_type().is_symlink() {
        return Err("The project assets folder is not a regular directory.".into());
    }
    let path = directory.join(relative.file_name().unwrap_or_default());
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Could not inspect the project image asset: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("The project image asset is not a regular file.".into());
    }
    if metadata.len() > MAX_IMAGE_FILE_BYTES {
        return Err("The project image asset exceeds the 25 MB limit.".into());
    }
    let mime = match path.extension().and_then(|extension| extension.to_str()) {
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => return Err("The project image asset has an unsupported format.".into()),
    };
    let bytes = fs::read(&path)
        .map_err(|error| format!("Could not read the project image asset: {error}"))?;
    validate_image_bytes(mime, &bytes)?;
    Ok(ImageAsset {
        path: asset_path,
        mime: mime.to_owned(),
        base64: BASE64.encode(bytes),
    })
}

#[tauri::command]
pub fn read_dropped_image(path: String) -> Result<ImageFile, String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect the dropped image: {error}"))?;
    if !metadata.is_file() {
        return Err("The dropped item is not a regular file.".into());
    }
    if metadata.len() > MAX_IMAGE_FILE_BYTES {
        return Err("Images must be 25 MB or smaller.".into());
    }
    let mime = match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("png") => "image/png",
        Some(extension)
            if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") =>
        {
            "image/jpeg"
        }
        Some(extension) if extension.eq_ignore_ascii_case("svg") => "image/svg+xml",
        Some(extension) if extension.eq_ignore_ascii_case("webp") => "image/webp",
        _ => return Err("Unsupported image. Choose a PNG, JPG, SVG, or WebP file.".into()),
    };
    let bytes =
        fs::read(&path).map_err(|error| format!("Could not read the dropped image: {error}"))?;
    validate_image_bytes(mime, &bytes)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The dropped image name is not valid Unicode.".to_owned())?
        .to_owned();
    Ok(ImageFile {
        name,
        mime: mime.to_owned(),
        size: bytes.len(),
        base64: BASE64.encode(bytes),
    })
}

#[tauri::command]
pub fn get_device_id() -> Result<String, String> {
    let hostname =
        hostname::get().map_err(|error| format!("Could not read the device hostname: {error}"))?;
    let seed = format!(
        "{}|{}|{}",
        hostname.to_string_lossy(),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    Ok(format!("{:x}", Sha256::digest(seed.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_pflow_extension_case_insensitively() {
        assert!(validate_project_path(Path::new("prototype.PFLOW")).is_ok());
        assert!(validate_project_path(Path::new("prototype.json")).is_err());
    }

    #[test]
    fn appends_extension_only_when_missing() {
        assert_eq!(
            with_project_extension(PathBuf::from("prototype")).as_os_str(),
            Path::new("prototype.pflow").as_os_str()
        );
        assert_eq!(
            with_project_extension(PathBuf::from("prototype.pflow")).as_os_str(),
            Path::new("prototype.pflow").as_os_str()
        );
    }

    #[test]
    fn sanitizes_dialog_default_filename() {
        assert_eq!(
            safe_default_filename(r"..\unsafe/name?.json"),
            "name-.pflow"
        );
        assert_eq!(
            safe_default_filename("Untitled project.pflow"),
            "Untitled project.pflow"
        );
    }

    #[test]
    fn derives_safe_default_filename_from_project_content() {
        assert_eq!(
            project_default_filename(r#"{"name":"Checkout flow"}"#),
            "Checkout flow.pflow"
        );
        assert_eq!(
            project_default_filename(r#"{"name":"../invalid/name"}"#),
            "name.pflow"
        );
        assert_eq!(
            project_default_filename("invalid JSON"),
            "Untitled project.pflow"
        );
    }

    #[test]
    fn atomic_write_replaces_existing_project() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("project.pflow");
        fs::write(&target, "old content").unwrap();

        atomic_write_project(&target, "new content").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "new content");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn interruption_before_replacement_preserves_original_project() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("project.pflow");
        fs::write(&target, "original content").unwrap();

        {
            let _staged = StagedProjectFile::create(&target, "replacement content").unwrap();
        }

        assert_eq!(fs::read_to_string(&target).unwrap(), "original content");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_project_content_over_ten_megabytes() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("project.pflow");
        let oversized = "x".repeat(MAX_PROJECT_FILE_BYTES as usize + 1);

        assert!(atomic_write_project(&target, &oversized).is_err());
        assert!(!target.exists());
    }

    #[test]
    fn saves_and_reads_image_assets_next_to_the_project() {
        let directory = tempfile::tempdir().unwrap();
        let project_path = directory.path().join("project.pflow");
        fs::write(&project_path, "{}").unwrap();
        let png = b"\x89PNG\r\n\x1a\nsmall-test";

        let asset_path = save_image_asset(
            project_path.to_string_lossy().into_owned(),
            "image/png".into(),
            BASE64.encode(png),
        )
        .unwrap();
        let asset = read_image_asset(
            project_path.to_string_lossy().into_owned(),
            asset_path.clone(),
        )
        .unwrap();

        assert!(asset_path.starts_with("assets/"));
        assert_eq!(asset.mime, "image/png");
        assert_eq!(BASE64.decode(asset.base64).unwrap(), png);
    }

    #[test]
    fn rejects_mismatched_and_unsafe_project_image_assets() {
        let directory = tempfile::tempdir().unwrap();
        let project_path = directory.path().join("project.pflow");
        fs::write(&project_path, "{}").unwrap();
        let invalid_image = BASE64.encode(b"not a png");
        assert!(
            save_image_asset(
                project_path.to_string_lossy().into_owned(),
                "image/png".into(),
                invalid_image,
            )
            .is_err()
        );
        assert!(
            read_image_asset(
                project_path.to_string_lossy().into_owned(),
                "assets/../../project.pflow".into(),
            )
            .is_err()
        );
    }

    #[test]
    fn device_id_is_a_sha256_hex_digest() {
        let device_id = get_device_id().unwrap();
        assert_eq!(device_id.len(), 64);
        assert!(
            device_id
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        );
    }
}
