// B22: every native command is listed here so that each window can be given only the ones it needs
// (see capabilities/default.json for the main window and capabilities/preview.json for the Preview window).
// Keep this list in step with the invoke_handler in src/lib.rs.
const APP_COMMANDS: &[&str] = &[
    "set_crash_reporting_consent",
    "append_diagnostic_log",
    "export_diagnostic_logs",
    "get_diagnostics_platform",
    "save_project",
    "open_project",
    "load_project_history",
    "save_project_history",
    "save_project_as",
    "pick_project_save_path",
    "save_html_export",
    "save_image_asset",
    "read_image_asset",
    "read_dropped_image",
    "get_device_id",
    "get_wallet_identity",
    "reset_wallet_identity",
    "get_wallet_jwt",
    "save_wallet_jwt",
    "clear_wallet_jwt",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
