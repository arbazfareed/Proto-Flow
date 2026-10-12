use std::fs;
use std::path::Path;

const MAX_PROJECT_FILE_BYTES: u64 = 10 * 1024 * 1024;

fn validate_project_path(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pflow"))
    {
        return Err("Proto Flow project files must use the .pflow extension.".into());
    }
    Ok(path)
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    let path = validate_project_path(&path)?;
    let metadata = fs::metadata(path).map_err(|error| format!("Could not inspect project file: {error}"))?;
    if metadata.len() > MAX_PROJECT_FILE_BYTES {
        return Err("This project file exceeds the 10 MB limit.".into());
    }
    fs::read_to_string(path).map_err(|error| format!("Could not read project file: {error}"))
}

#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
    let path = validate_project_path(&path)?;
    if contents.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Err("This project file exceeds the 10 MB limit.".into());
    }
    fs::write(path, contents).map_err(|error| format!("Could not save project file: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_project_file, write_project_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
