mod engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            engine::cursor_pos,
            engine::gw2_foreground,
            engine::screen_fingerprints,
            engine::icon_fingerprints,
            engine::drag,
            engine::park_pointer,
            engine::type_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the GW2 Companion");
}
