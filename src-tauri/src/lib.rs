//! Inspoboard backend. It owns all file access. See docs/SPEC.md section 10.

mod backup;
mod commands;
mod history;
mod menu_text;
mod plugin_host;
mod subtitle;
mod vault_fs;
mod vault_lock;
mod vault_watch;

use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// Menu item IDs start with one of these prefixes. The frontend gets them as "menu" events.
const MENU_PREFIXES: [&str; 2] = ["vault-", "view-"];

/// The default menu (it has Edit: copy, paste, undo) plus a Vault menu.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let open = MenuItem::with_id(app, "vault-open", "Open Vault…", true, Some("CmdOrCtrl+O"))?;
    let create = MenuItem::with_id(app, "vault-new", "New Vault…", true, Some("CmdOrCtrl+Shift+N"))?;
    let close = MenuItem::with_id(app, "vault-close", "Close Vault", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let vault = Submenu::with_items(app, "Vault", true, &[&open, &create, &separator, &close])?;
    menu.insert(&vault, 1)?;
    // View: "Zen Mode" below "Enter Full Screen". If the default menu has no View menu, add one.
    let zen = MenuItem::with_id(app, "view-zen", "Zen Mode", true, Some("Ctrl+CmdOrCtrl+Z"))?;
    let view = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|text| text == "View") => Some(submenu),
        _ => None,
    });
    match view {
        Some(view) => view.append(&zen)?,
        None => menu.append(&Submenu::with_items(app, "View", true, &[&zen])?)?,
    }
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .manage(plugin_host::PluginState::default())
        .manage(subtitle::SubtitleState::default())
        .manage(menu_text::MenuTextState::default())
        .setup(|app| {
            commands::remove_legacy_memory(app.handle());
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if MENU_PREFIXES.iter().any(|prefix| id.starts_with(prefix)) {
                let _ = app.emit("menu", id.to_string());
            }
        })
        .invoke_handler(tauri::generate_handler![
            menu_text::menu_texts,
            menu_text::set_menu_texts,
            commands::open_vault,
            commands::close_vault,
            commands::write_files,
            commands::snapshot,
            commands::list_snapshots,
            commands::backup_vault,
            commands::list_backups,
            commands::delete_backup,
            commands::reveal_file,
            commands::open_in_browser,
            commands::save_image_bytes,
            commands::export_bundle,
            commands::read_bundle,
            commands::import_bundle_images,
            commands::startup_vault,
            commands::import_image,
            commands::read_image,
            commands::read_web_file,
            commands::write_web_file,
            commands::export_text,
            commands::read_web_bytes,
            commands::write_web_bytes,
            commands::import_pdf,
            plugin_host::plugins_folder_path,
            plugin_host::set_plugins_folder,
            plugin_host::list_plugins,
            plugin_host::plugin_call,
            subtitle::subtitle_set,
            subtitle::subtitle_text,
            subtitle::subtitle_dismiss,
        ])
        .build(tauri::generate_context!())
        .expect("Inspoboard could not start.")
        .run(|app, event| {
            match event {
                // Plugin programs stop with the app.
                RunEvent::Exit => app.state::<plugin_host::PluginState>().stop_all(),
                // The subtitle window must not keep the app open after the main window closed.
                RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => {
                    if let Some(window) = app.get_webview_window(subtitle::LABEL) {
                        let _ = window.destroy();
                    }
                }
                _ => {}
            }
        });
}
