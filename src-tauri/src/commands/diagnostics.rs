use std::{
    fs::{self, OpenOptions},
    io::Write,
    panic,
    path::PathBuf,
    str::FromStr,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_LOG_BYTES: u64 = 512 * 1024;
const LOG_FILE_NAME: &str = "diagnostics.log";
const PRIVACY_FILE_NAME: &str = "privacy-diagnostics.json";
const GENERIC_PANIC_MESSAGE: &str = "ProtoFlow encountered an unexpected internal error.";

static CRASH_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
static SENTRY_GUARD: OnceLock<Mutex<Option<sentry::ClientInitGuard>>> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsPreferences {
    crash_reports: bool,
    #[serde(default)]
    dsn: Option<String>,
}

fn sentry_guard() -> &'static Mutex<Option<sentry::ClientInitGuard>> {
    SENTRY_GUARD.get_or_init(|| Mutex::new(None))
}

fn privacy_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| {
        format!("Could not resolve the diagnostics settings directory: {error}")
    })?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the diagnostics settings directory: {error}"))?;
    Ok(directory.join(PRIVACY_FILE_NAME))
}

fn log_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Could not resolve the diagnostics log directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the diagnostics log directory: {error}"))?;
    Ok(directory.join(LOG_FILE_NAME))
}

fn sanitize(input: &str) -> String {
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    static WINDOWS_PATH: OnceLock<Regex> = OnceLock::new();
    static UNIX_PATH: OnceLock<Regex> = OnceLock::new();
    static SECRET: OnceLock<Regex> = OnceLock::new();
    static UUID: OnceLock<Regex> = OnceLock::new();
    let mut output = input.to_owned();
    for (pattern, replacement) in [
        (
            EMAIL.get_or_init(|| Regex::new(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b").expect("valid email regex")),
            "[redacted-email]",
        ),
        (
            WINDOWS_PATH.get_or_init(|| Regex::new(r#"(?i)\b[A-Z]:\\(?:[^\s<>"']+\\?)*"#).expect("valid Windows path regex")),
            "[redacted-path]",
        ),
        (
            UNIX_PATH.get_or_init(|| Regex::new(r#"(?i)(?:/Users/|/home/|/private/|/tmp/|/var/)[^\s<>"']*"#).expect("valid Unix path regex")),
            "[redacted-path]",
        ),
        (
            SECRET.get_or_init(|| Regex::new(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~-]{16,})\b").expect("valid secret regex")),
            "[redacted-secret]",
        ),
        (
            UUID.get_or_init(|| Regex::new(r"(?i)\b[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}\b").expect("valid UUID regex")),
            "[redacted-id]",
        ),
    ] {
        output = pattern.replace_all(&output, replacement).into_owned();
    }
    output
        .chars()
        .filter(|character| !character.is_control() || *character == ' ')
        .take(2_000)
        .collect()
}

fn configure_crash_reporting(enabled: bool, dsn: Option<&str>) -> Result<(), String> {
    let valid_dsn = dsn
        .map(str::trim)
        .filter(|dsn| !dsn.is_empty())
        .map(|dsn| {
            if !dsn.starts_with("https://") && !dsn.starts_with("http://") {
                return Err("The configured crash-report endpoint is invalid.".to_owned());
            }
            sentry::types::Dsn::from_str(dsn)
                .map(Some)
                .map_err(|_| "The configured crash-report endpoint is invalid.".to_owned())
        })
        .transpose()?
        .flatten();

    let mut guard = sentry_guard()
        .lock()
        .map_err(|_| "Could not update crash-reporting state.".to_owned())?;
    CRASH_REPORTING_ENABLED.store(false, Ordering::Release);
    guard.take();
    if enabled {
        if let Some(dsn) = valid_dsn {
            let mut options = sentry::ClientOptions::default();
            options.dsn = Some(dsn);
            *guard = Some(sentry::init(options));
            CRASH_REPORTING_ENABLED.store(true, Ordering::Release);
        }
    }
    Ok(())
}

fn preferences_from_file(app: &AppHandle) -> Result<DiagnosticsPreferences, String> {
    let path = privacy_file(app)?;
    if !path.exists() {
        return Ok(DiagnosticsPreferences {
            crash_reports: false,
            dsn: None,
        });
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read diagnostics preferences: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Could not parse diagnostics preferences: {error}"))
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let preferences = preferences_from_file(app).unwrap_or_else(|error| {
        eprintln!(
            "Diagnostics preferences could not be loaded; crash reporting remains off: {error}"
        );
        DiagnosticsPreferences {
            crash_reports: false,
            dsn: None,
        }
    });
    if let Err(error) =
        configure_crash_reporting(preferences.crash_reports, preferences.dsn.as_deref())
    {
        eprintln!("Native crash reporting could not be initialized: {error}");
        CRASH_REPORTING_ENABLED.store(false, Ordering::Release);
    }
    PANIC_HOOK_INSTALLED.get_or_init(|| {
        let previous_hook = panic::take_hook();
        panic::set_hook(Box::new(move |panic_info| {
            if CRASH_REPORTING_ENABLED.load(Ordering::Acquire) {
                sentry::capture_message(GENERIC_PANIC_MESSAGE, sentry::Level::Error);
            }
            previous_hook(panic_info);
        }));
    });
    Ok(())
}

#[tauri::command]
pub fn set_crash_reporting_consent(
    app: AppHandle,
    enabled: bool,
    dsn: Option<String>,
) -> Result<(), String> {
    let safe_dsn = if enabled {
        dsn.as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    } else {
        None
    };
    let preferences = DiagnosticsPreferences {
        crash_reports: enabled,
        dsn: safe_dsn.clone(),
    };
    let path = privacy_file(&app)?;
    let serialized = serde_json::to_vec(&preferences)
        .map_err(|error| format!("Could not serialize diagnostics preferences: {error}"))?;
    fs::write(path, serialized)
        .map_err(|error| format!("Could not save diagnostics preferences: {error}"))?;
    configure_crash_reporting(enabled, safe_dsn.as_deref())
}

#[tauri::command]
pub fn append_diagnostic_log(app: AppHandle, line: String) -> Result<(), String> {
    let path = log_file(&app)?;
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() >= MAX_LOG_BYTES) {
        let rotated_path = path.with_extension("log.1");
        if rotated_path.exists() {
            fs::remove_file(&rotated_path)
                .map_err(|error| format!("Could not rotate the diagnostics log: {error}"))?;
        }
        fs::rename(&path, rotated_path)
            .map_err(|error| format!("Could not rotate the diagnostics log: {error}"))?;
    }
    let safe_line = sanitize(&line);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Could not open the diagnostics log: {error}"))?;
    writeln!(file, "{safe_line}")
        .map_err(|error| format!("Could not write the diagnostics log: {error}"))
}

#[tauri::command]
pub fn export_diagnostic_logs(
    app: AppHandle,
    recent_lines: Vec<String>,
) -> Result<Option<String>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Diagnostic log", &["log", "txt"])
        .set_file_name("protoflow-diagnostics.log")
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Could not resolve the selected log path: {error}"))?;
    let mut contents = Vec::new();
    if let Ok(rotated) = fs::read(log_file(&app)?.with_extension("log.1")) {
        contents.extend_from_slice(&rotated);
    }
    if let Ok(current) = fs::read(log_file(&app)?) {
        contents.extend_from_slice(&current);
    }
    for line in recent_lines.iter().take(20) {
        contents.extend_from_slice(sanitize(line).as_bytes());
        contents.push(b'\n');
    }
    let sanitized = sanitize(&String::from_utf8_lossy(&contents));
    fs::write(&path, sanitized.as_bytes())
        .map_err(|error| format!("Could not export the diagnostics log: {error}"))?;
    path.to_str()
        .map(str::to_owned)
        .map(Some)
        .ok_or_else(|| "The selected log path is not valid Unicode.".to_owned())
}

#[tauri::command]
pub fn get_diagnostics_platform() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
    })
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn sanitizes_emails_paths_credentials_and_identifiers() {
        let input = "person@example.com C:\\Users\\Alice\\project.pflow ghp_123456789012345678901234567890 123e4567-e89b-12d3-a456-426614174000";
        let output = sanitize(input);

        assert!(!output.contains("person@example.com"));
        assert!(!output.contains("C:\\Users\\Alice"));
        assert!(!output.contains("ghp_123456789012345678901234567890"));
        assert!(!output.contains("123e4567-e89b-12d3-a456-426614174000"));
    }
}
