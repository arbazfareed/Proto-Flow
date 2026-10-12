mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::file_io::save_project,
            commands::file_io::open_project,
            commands::file_io::save_project_as,
            commands::file_io::get_device_id
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
