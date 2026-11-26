mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {}));
    #[cfg(feature = "wdio")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // B22: remember which files the person chose, so file commands can refuse any other path.
        .manage(commands::path_guard::ApprovedPaths::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window
                    .app_handle()
                    .state::<commands::path_guard::ApprovedPaths>()
                    .record_drop(paths);
            }
        })
        .setup(|app| {
            commands::diagnostics::initialize(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::diagnostics::set_crash_reporting_consent,
            commands::diagnostics::append_diagnostic_log,
            commands::diagnostics::export_diagnostic_logs,
            commands::diagnostics::get_diagnostics_platform,
            commands::file_io::save_project,
            commands::file_io::open_project,
            commands::file_io::load_project_history,
            commands::file_io::save_project_history,
            commands::file_io::save_project_as,
            commands::file_io::pick_project_save_path,
            commands::file_io::save_html_export,
            commands::file_io::save_image_asset,
            commands::file_io::read_image_asset,
            commands::file_io::read_dropped_image,
            commands::file_io::get_device_id,
            commands::wallet::get_wallet_identity,
            commands::wallet::reset_wallet_identity,
            commands::wallet::get_wallet_jwt,
            commands::wallet::save_wallet_jwt,
            commands::wallet::clear_wallet_jwt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
