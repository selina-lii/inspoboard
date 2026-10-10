//! The floating subtitle: a small window above all apps. It shows the sentence that read-aloud says now.
//! - The main window sends the text with `subtitle_set`. `None` hides the window.
//! - The user drags the window to move it. Release builds keep the position in the app config folder.
//!   Development builds keep it in memory only (they write no files outside the test data folder).

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "subtitle";
const WIDTH: f64 = 900.0;
const HEIGHT: f64 = 110.0;

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
struct Placement {
    x: f64,
    y: f64,
    width: f64,
}

#[derive(Default)]
pub struct SubtitleState {
    text: Mutex<String>,
    placement: Mutex<Option<Placement>>,
    /// The user closed the subtitle. It stays closed until the reading ends.
    dismissed: Mutex<bool>,
    /// Each move makes a new number. A save waits, and only the newest move saves.
    moves: AtomicU64,
}

/// Shows `text` in the subtitle window (it opens if necessary), or hides the window (`None`).
#[tauri::command]
pub fn subtitle_set(app: AppHandle, state: State<'_, SubtitleState>, text: Option<String>) -> Result<(), String> {
    let window = app.get_webview_window(LABEL);
    let Some(text) = text else {
        *state.dismissed.lock().map_err(|_| "Internal lock error.")? = false;
        if let Some(window) = window {
            window.hide().map_err(|error| error.to_string())?;
        }
        return Ok(());
    };
    if *state.dismissed.lock().map_err(|_| "Internal lock error.")? {
        return Ok(());
    }
    *state.text.lock().map_err(|_| "Internal lock error.")? = text.clone();
    let window = match window {
        Some(window) => window,
        None => create(&app, &state)?,
    };
    if !window.is_visible().unwrap_or(false) {
        window.show().map_err(|error| error.to_string())?;
    }
    app.emit_to(LABEL, "subtitle-text", text).map_err(|error| error.to_string())
}

/// The current text. The subtitle page asks for it when it loads.
#[tauri::command]
pub fn subtitle_text(state: State<'_, SubtitleState>) -> String {
    state.text.lock().map(|text| text.clone()).unwrap_or_default()
}

/// The close button of the subtitle: hide it until the reading ends.
#[tauri::command]
pub fn subtitle_dismiss(app: AppHandle, state: State<'_, SubtitleState>) -> Result<(), String> {
    *state.dismissed.lock().map_err(|_| "Internal lock error.")? = true;
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn create(app: &AppHandle, state: &SubtitleState) -> Result<WebviewWindow, String> {
    let saved = *state.placement.lock().map_err(|_| "Internal lock error.")?;
    let placement = saved.or_else(|| load(app)).unwrap_or_else(|| default_placement(app));
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("subtitle.html".into()))
        .title("Subtitle")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .resizable(true)
        .min_inner_size(240.0, 50.0)
        .inner_size(placement.width, HEIGHT)
        .position(placement.x, placement.y)
        .build()
        .map_err(|error| format!("The subtitle window could not open: {error}"))?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            remember(&handle);
        }
    });
    Ok(window)
}

/// Keeps the new position. Release builds write it to a file after the moves stop.
fn remember(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else { return };
    let placement = Placement { x: position.x as f64 / scale, y: position.y as f64 / scale, width: size.width as f64 / scale };
    let state = app.state::<SubtitleState>();
    if let Ok(mut slot) = state.placement.lock() {
        *slot = Some(placement);
    }
    let number = state.moves.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        if app.state::<SubtitleState>().moves.load(Ordering::SeqCst) == number {
            save(&app, placement);
        }
    });
}

/// Bottom center of the screen of the main window.
fn default_placement(app: &AppHandle) -> Placement {
    let monitor = app.get_webview_window("main").and_then(|window| window.current_monitor().ok().flatten());
    match monitor {
        Some(monitor) => {
            let scale = monitor.scale_factor();
            let size: LogicalSize<f64> = monitor.size().to_logical(scale);
            let origin: LogicalPosition<f64> = monitor.position().to_logical(scale);
            let width = WIDTH.min(size.width - 40.0);
            Placement { x: origin.x + (size.width - width) / 2.0, y: origin.y + size.height - HEIGHT - 90.0, width }
        }
        None => Placement { x: 200.0, y: 600.0, width: WIDTH },
    }
}

#[cfg(not(debug_assertions))]
fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|folder| folder.join("subtitle.json"))
}

#[cfg(not(debug_assertions))]
fn load(app: &AppHandle) -> Option<Placement> {
    let text = std::fs::read_to_string(file(app)?).ok()?;
    let placement: Placement = serde_json::from_str(&text).ok()?;
    (placement.x.is_finite() && placement.y.is_finite() && placement.width >= 240.0).then_some(placement)
}

#[cfg(not(debug_assertions))]
fn save(app: &AppHandle, placement: Placement) {
    let Some(path) = file(app) else { return };
    if let Some(folder) = path.parent() {
        let _ = std::fs::create_dir_all(folder);
    }
    if let Ok(text) = serde_json::to_string(&placement) {
        let temporary = path.with_extension("json.tmp");
        if std::fs::write(&temporary, text).is_ok() {
            let _ = std::fs::rename(&temporary, &path);
        }
    }
}

#[cfg(debug_assertions)]
fn load(_app: &AppHandle) -> Option<Placement> {
    None
}

#[cfg(debug_assertions)]
fn save(_app: &AppHandle, _placement: Placement) {}
