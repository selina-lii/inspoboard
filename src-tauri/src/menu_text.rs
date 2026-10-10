//! The text of the app menu (menu bar) in the UI language. See docs/SPEC.md section 7.9.
//! - `menu_texts` gives the English text of each menu item (the text when the app started).
//! - `set_menu_texts` writes a text for each item. The frontend translates with its language pack.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::MenuItemKind;
use tauri::{AppHandle, Runtime, State};

/// The English text of each menu item, by item ID. Kept from the first call.
#[derive(Default)]
pub struct MenuTextState(Mutex<HashMap<String, String>>);

#[derive(Serialize, Deserialize)]
pub struct MenuText {
    id: String,
    text: String,
}

fn visit<R: Runtime>(items: Vec<MenuItemKind<R>>, out: &mut Vec<MenuItemKind<R>>) {
    for item in items {
        if let MenuItemKind::Submenu(submenu) = &item {
            if let Ok(children) = submenu.items() {
                visit(children, out);
            }
        }
        out.push(item);
    }
}

fn all_items<R: Runtime>(app: &AppHandle<R>) -> Vec<MenuItemKind<R>> {
    let mut out = Vec::new();
    if let Some(menu) = app.menu() {
        if let Ok(items) = menu.items() {
            visit(items, &mut out);
        }
    }
    out
}

fn text_of<R: Runtime>(item: &MenuItemKind<R>) -> Option<String> {
    match item {
        MenuItemKind::MenuItem(item) => item.text().ok(),
        MenuItemKind::Submenu(item) => item.text().ok(),
        MenuItemKind::Predefined(item) => item.text().ok(),
        MenuItemKind::Check(item) => item.text().ok(),
        MenuItemKind::Icon(item) => item.text().ok(),
    }
}

fn set_text<R: Runtime>(item: &MenuItemKind<R>, text: &str) {
    let _ = match item {
        MenuItemKind::MenuItem(item) => item.set_text(text),
        MenuItemKind::Submenu(item) => item.set_text(text),
        MenuItemKind::Predefined(item) => item.set_text(text),
        MenuItemKind::Check(item) => item.set_text(text),
        MenuItemKind::Icon(item) => item.set_text(text),
    };
}

/// The English text of each menu item that has a text.
#[tauri::command]
pub fn menu_texts(app: AppHandle, state: State<'_, MenuTextState>) -> Vec<MenuText> {
    let mut originals = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut out = Vec::new();
    for item in all_items(&app) {
        let id = item.id().as_ref().to_string();
        let original = match originals.get(&id) {
            Some(text) => text.clone(),
            None => {
                let Some(text) = text_of(&item) else { continue };
                originals.insert(id.clone(), text.clone());
                text
            }
        };
        if !original.trim().is_empty() {
            out.push(MenuText { id, text: original });
        }
    }
    out
}

/// Writes the given texts. Items that are not in the list keep their text.
#[tauri::command]
pub fn set_menu_texts(app: AppHandle, texts: Vec<MenuText>) {
    let wanted: HashMap<String, String> = texts.into_iter().map(|entry| (entry.id, entry.text)).collect();
    for item in all_items(&app) {
        if let Some(text) = wanted.get(item.id().as_ref()) {
            set_text(&item, text);
        }
    }
}
