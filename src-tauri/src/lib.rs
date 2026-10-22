//! Inspoboard backend. It owns all file access. See docs/SPEC.md section 10.

mod backup;
mod clipboard;
mod commands;
mod debug_log;
mod history;
mod menu_text;
mod pdf_pages;
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
    let open_window = MenuItem::with_id(app, "vault-window", "Open Vault in New Window…", true, Some(r"CmdOrCtrl+Shift+O"))?;
    let create = MenuItem::with_id(app, "vault-new", "New Vault…", true, Some("CmdOrCtrl+Shift+N"))?;
    let close = MenuItem::with_id(app, "vault-close", "Close Vault", true, None::<&str>)?;
    let log = MenuItem::with_id(app, "vault-log", "Show Session Log in Finder", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;
    let vault = Submenu::with_items(app, "Vault", true, &[&open, &open_window, &create, &separator, &close, &separator_2, &log])?;
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

/// The answer of a `pdfpage` request: a PNG, or an error code with a short text.
fn pdf_page_response(app: &AppHandle, window: &str, path: &str, query: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    let answer = |status: u16, kind: &str, body: Vec<u8>| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", kind)
            .header("Cache-Control", "no-store")
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap_or_default()
    };
    let Some((key, page, width, crop)) = pdf_pages::parse(path, query) else {
        return answer(400, "text/plain", b"Not a page address.".to_vec());
    };
    let Some(file) = app.state::<commands::AppState>().web_pdf(window, &key) else {
        return answer(404, "text/plain", b"No such PDF in the open vault.".to_vec());
    };
    match pdf_pages::render(file, page - 1, width, crop) {
        Ok(png) => answer(200, "image/png", png),
        Err(error) if error.starts_with("PDFium is not available") => answer(503, "text/plain", error.into_bytes()),
        Err(error) => answer(500, "text/plain", error.into_bytes()),
    }
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
            debug_log::write("app", "Started.");
            pdf_pages::set_library_folder(app.path().resource_dir().ok());
            debug_log::start_watchdog();
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        // PDF pages drawn by PDFium (pdf_pages.rs), off the main thread.
        .register_asynchronous_uri_scheme_protocol("pdfpage", |context, request, responder| {
            let app = context.app_handle().clone();
            let window = context.webview_label().to_string();
            let uri = request.uri().clone();
            std::thread::spawn(move || responder.respond(pdf_page_response(&app, &window, uri.path(), uri.query())));
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if MENU_PREFIXES.iter().any(|prefix| id.starts_with(prefix)) {
                // The menu is for the window in front (each window has its own vault).
                let focused = app.webview_windows().into_iter().find(|(label, window)| label != subtitle::LABEL && window.is_focused().unwrap_or(false));
                let _ = match focused {
                    Some((label, _)) => app.emit_to(label.as_str(), "menu", id.to_string()),
                    None => app.emit("menu", id.to_string()),
                };
            }
        })
        .invoke_handler(tauri::generate_handler![
            menu_text::menu_texts,
            menu_text::set_menu_texts,
            commands::open_vault,
            commands::close_vault,
            commands::open_vault_window,
            commands::focus_vault_window,
            commands::write_files,
            commands::snapshot,
            commands::list_snapshots,
            commands::backup_vault,
            commands::list_backups,
            commands::delete_backup,
            commands::reveal_file,
            commands::open_in_browser,
            commands::save_image_bytes,
            commands::paste_images,
            commands::export_bundle,
            commands::read_bundle,
            commands::import_bundle_images,
            commands::startup_vault,
            commands::import_image,
            commands::read_image,
            commands::read_web_file,
            commands::item_files_size,
            commands::copy_item_files,
            commands::write_web_file,
            commands::export_text,
            commands::read_web_bytes,
            commands::write_web_bytes,
            commands::import_pdf,
            debug_log::log_events,
            debug_log::log_path,
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
                RunEvent::Exit => {
                    app.state::<plugin_host::PluginState>().stop_all();
                    debug_log::exit();
                }
                // A window that closes closes its vault. The subtitle window must not keep the app open after the
                // last vault window closed.
                RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label != subtitle::LABEL => {
                    app.state::<commands::AppState>().close_window(&label);
                    let others = app.webview_windows().into_keys().any(|other| other != label && other != subtitle::LABEL);
                    if !others {
                        if let Some(window) = app.get_webview_window(subtitle::LABEL) {
                            let _ = window.destroy();
                        }
                    }
                }
                _ => {}
            }
        });
}
