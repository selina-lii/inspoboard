//! Commands that the frontend can call. Each command is a thin wrapper.
//! The logic is in vault_fs, vault_lock, vault_watch, and history.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};

use crate::history::{self, SnapshotInfo};
use crate::vault_fs::{self, VaultFile};
use crate::vault_lock::{self, VaultLock};
use crate::vault_watch::{self, KnownFiles, VaultWatcher};

/// Development builds open only vaults in the test data folder of the repository.
/// They never read or write the last-vault file. Thus a development build cannot touch user data.
#[cfg(debug_assertions)]
fn dev_data_folder() -> Result<PathBuf, String> {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("data");
    fs::canonicalize(&folder).map_err(|error| vault_fs::describe(&folder, error))
}

/// Refuses a vault outside the test data folder in development builds.
fn check_allowed(root: &std::path::Path) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let allowed = dev_data_folder()?;
        if !root.starts_with(&allowed) {
            return Err(format!(
                "This is a development build. It opens only vaults inside {}. Use a release build for your own notes.",
                allowed.display()
            ));
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = root;
    Ok(())
}

pub struct OpenVault {
    root: PathBuf,
    read_only: bool,
    known: Arc<Mutex<KnownFiles>>,
    // Dropping these releases the lock and stops the watcher.
    _lock: Option<VaultLock>,
    _watcher: VaultWatcher,
}

#[derive(Default)]
pub struct AppState {
    vault: Mutex<Option<OpenVault>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedVault {
    root: String,
    /// True if a different app instance owns the vault.
    locked_by_other: bool,
    files: Vec<VaultFile>,
    unreadable: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct FileWrite {
    path: String,
    /// `None` moves the file to the trash.
    content: Option<String>,
}

/// Opens a vault into the slot. Closes the old vault first (this releases its lock).
fn open_into(app: &AppHandle, slot: &mut Option<OpenVault>, root: &Path) -> Result<vault_fs::VaultRead, String> {
    *slot = None;
    let lock = vault_lock::try_acquire(root)?;
    let read = vault_fs::read_vault(root)?;
    let known = Arc::new(Mutex::new(KnownFiles::default()));
    {
        let mut known = known.lock().map_err(|_| "Internal lock error.".to_string())?;
        for file in &read.files {
            known.set(&file.path, Some(file.content.as_bytes()));
        }
    }
    let watcher = vault_watch::start(app.clone(), root.to_path_buf(), known.clone())?;
    let read_only = lock.is_none();
    *slot = Some(OpenVault { root: root.to_path_buf(), read_only, known, _lock: lock, _watcher: watcher });
    Ok(read)
}

/// The canonical vault folder, after the checks that each command needs.
fn vault_root(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|error| format!("{path}: {error}"))?;
    if !root.is_dir() {
        return Err(format!("{path} is not a folder."));
    }
    check_allowed(&root)?;
    Ok(root)
}

/// The open vault for `root`. If the backend has no vault open, or a different one, it opens `root` again.
/// Thus a command never fails only because the backend lost its open vault.
fn ensure_open<'a>(app: &AppHandle, slot: &'a mut Option<OpenVault>, root: &str) -> Result<&'a OpenVault, String> {
    let root = vault_root(root)?;
    if slot.as_ref().is_none_or(|vault| vault.root != root) {
        open_into(app, slot, &root)?;
    }
    slot.as_ref().ok_or_else(|| "The vault could not be opened.".to_string())
}

#[tauri::command]
pub fn open_vault(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<OpenedVault, String> {
    let root = vault_root(&path)?;
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let read = open_into(&app, &mut slot, &root)?;
    let locked_by_other = slot.as_ref().is_some_and(|vault| vault.read_only);
    Ok(OpenedVault {
        root: root.to_string_lossy().to_string(),
        locked_by_other,
        files: read.files,
        unreadable: read.unreadable,
    })
}

#[tauri::command]
pub fn close_vault(state: State<'_, AppState>) -> Result<(), String> {
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    *slot = None;
    Ok(())
}

/// Writes or trashes files in the given order. Stops at the first error.
#[tauri::command]
pub fn write_files(app: AppHandle, state: State<'_, AppState>, root: String, writes: Vec<FileWrite>) -> Result<(), String> {
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    for write in writes {
        match &write.content {
            Some(content) => vault_fs::write_atomic(&vault.root, &write.path, content)?,
            None => vault_fs::move_to_trash(&vault.root, &write.path)?,
        }
        if let Ok(mut known) = vault.known.lock() {
            known.set(&write.path, write.content.as_deref().map(str::as_bytes));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn snapshot(app: AppHandle, state: State<'_, AppState>, root: String, message: String) -> Result<Option<String>, String> {
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Ok(None);
    }
    history::snapshot(&vault.root, &message)
}

/// Copies the vault data into `<vault>/.backup/<time>/` (see backup.rs).
#[tauri::command]
pub fn backup_vault(app: AppHandle, state: State<'_, AppState>, root: String) -> Result<crate::backup::BackupInfo, String> {
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    crate::backup::backup(&vault.root)
}

#[tauri::command]
pub fn list_snapshots(app: AppHandle, state: State<'_, AppState>, root: String, limit: usize) -> Result<Vec<SnapshotInfo>, String> {
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    history::list(&vault.root, limit)
}

/// The vault to open at startup. The app has no memory of vault locations.
/// A release build returns nothing: the user selects a folder. A development build returns the test vault.
#[tauri::command]
pub fn startup_vault() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        let vault = dev_data_folder().ok()?.join("vault");
        vault.is_dir().then(|| vault.to_string_lossy().to_string())
    }
    #[cfg(not(debug_assertions))]
    None
}

/// Earlier versions kept the last vault path in the app config folder. Remove that file.
pub fn remove_legacy_memory(app: &AppHandle) {
    if let Ok(folder) = app.path().app_config_dir() {
        let _ = fs::remove_file(folder.join("last-vault.txt"));
    }
}

/// Image files that a board background can use.
const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
const IMAGES_FOLDER: &str = "images";
/// The largest image that the app copies into a vault.
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

/// A safe vault path for an image: `images/<name>` with an image extension and no other folders.
pub fn image_path(relative: &str) -> Option<&str> {
    let name = relative.strip_prefix("images/")?;
    let valid_name = !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
    (valid_name && IMAGE_EXTENSIONS.contains(&extension.as_str())).then_some(name)
}

/// The vault name of an image: its file name (simple characters only) and a hash of its content.
/// The same image gives the same name, so a second import does not make a copy.
pub fn image_name(source: &Path, bytes: &[u8]) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let extension = source.extension().map(|value| value.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Use a PNG, JPEG, GIF, or WebP image, not \"{}\".", source.display()));
    }
    let stem: String = source
        .file_stem()
        .map(|value| value.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(40).collect())
        .unwrap_or_default();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    let stem = if stem.trim_matches('-').is_empty() { "image".to_string() } else { stem };
    Ok(format!("{stem}-{:016x}.{extension}", hasher.finish()))
}

/// Copies an image file into `images/` of the vault. Returns its vault path, for example "images/sky-1a2b….png".
#[tauri::command]
pub fn import_image(app: AppHandle, state: State<'_, AppState>, root: String, source: String) -> Result<String, String> {
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    let source = PathBuf::from(source);
    let size = fs::metadata(&source).map_err(|error| vault_fs::describe(&source, error))?.len();
    if size > MAX_IMAGE_BYTES {
        return Err("The image is larger than 50 MB.".to_string());
    }
    let bytes = fs::read(&source).map_err(|error| vault_fs::describe(&source, error))?;
    store_image(&vault.root, &source, &bytes)
}

/// Writes an image into `images/` of the vault under its content name. An existing file is never written again:
/// the same name means the same content. Returns the vault path.
fn store_image(root: &Path, source: &Path, bytes: &[u8]) -> Result<String, String> {
    let name = image_name(source, bytes)?;
    let folder = root.join(IMAGES_FOLDER);
    let target = folder.join(&name);
    if !target.is_file() {
        fs::create_dir_all(&folder).map_err(|error| vault_fs::describe(&folder, error))?;
        let temporary = folder.join(format!(".{name}.tmp-{}", std::process::id()));
        fs::write(&temporary, bytes).map_err(|error| vault_fs::describe(&temporary, error))?;
        fs::rename(&temporary, &target).map_err(|error| vault_fs::describe(&target, error))?;
    }
    Ok(format!("{IMAGES_FOLDER}/{name}"))
}

/// Saves image bytes (a pasted or dropped image) into `images/` of the vault. Returns its vault path.
/// The vault and a file name for the image ("pasted.png") come in the headers (URL-encoded).
#[tauri::command]
pub fn save_image_bytes(app: AppHandle, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let header = |key: &str| request.headers().get(key).and_then(|value| value.to_str().ok()).map(percent_decode).ok_or_else(|| format!("Header \"{key}\" is missing."));
    let root = header("x-root")?;
    let name = header("x-name")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("The image must come as raw bytes.".to_string()) };
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("The image is larger than 50 MB.".to_string());
    }
    // Only the file name counts: no folders.
    let source = PathBuf::from(Path::new(&name).file_name().ok_or("The image has no file name.")?);
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    store_image(&vault.root, &source, bytes)
}

/// The bytes of an image in the vault.
#[tauri::command]
pub fn read_image(app: AppHandle, state: State<'_, AppState>, root: String, path: String) -> Result<tauri::ipc::Response, String> {
    let name = image_path(&path).ok_or_else(|| format!("\"{path}\" is not an image of the vault."))?;
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    let file = vault.root.join(IMAGES_FOLDER).join(name);
    let bytes = fs::read(&file).map_err(|error| vault_fs::describe(&file, error))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Saved web pages and their notes: `web/<key>.html` and `web/<key>.notes.json`. The key is 24 hex digits.
const WEB_FOLDER: &str = "web";
/// The largest saved web page (with its images and styles inside).
const MAX_WEB_BYTES: usize = 60 * 1024 * 1024;

/// Marks (highlights and scribbles) of an item: `marks/<item id>.json`. The item text never changes for them.
const MARKS_FOLDER: &str = "marks";

/// A safe vault path for a web file or a marks file: (folder, file name). Other paths give None.
/// - `web/<key>.html`, `web/<key>.pdf`, `web/<key>.notes.json` (key: 24 hex digits)
/// - `marks/<item id>.json` (item id: 12 lowercase letters or digits)
pub fn web_path(relative: &str) -> Option<(&'static str, &str)> {
    if let Some(name) = relative.strip_prefix("marks/") {
        let id = name.strip_suffix(".json")?;
        let valid = id.len() == 12 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
        return valid.then_some((MARKS_FOLDER, name));
    }
    let name = relative.strip_prefix("web/")?;
    let (key, extension) = name.split_once('.')?;
    let valid_key = key.len() == 24 && key.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
    (valid_key && matches!(extension, "html" | "pdf" | "notes.json")).then_some((WEB_FOLDER, name))
}

/// A saved web page or its notes, or None if the file is not there.
#[tauri::command]
pub fn read_web_file(app: AppHandle, state: State<'_, AppState>, root: String, path: String) -> Result<Option<String>, String> {
    let (folder, name) = web_path(&path).ok_or_else(|| format!("\"{path}\" is not a web or marks file of the vault."))?;
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    let file = vault.root.join(folder).join(name);
    match fs::read_to_string(&file) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(vault_fs::describe(&file, error)),
    }
}

/// Writes a saved web page or its notes (atomic: a temporary file, then a rename).
#[tauri::command]
pub fn write_web_file(app: AppHandle, state: State<'_, AppState>, root: String, path: String, content: String) -> Result<(), String> {
    let (folder, name) = web_path(&path).ok_or_else(|| format!("\"{path}\" is not a web or marks file of the vault."))?;
    if content.len() > MAX_WEB_BYTES {
        return Err("The web page is larger than 60 MB.".to_string());
    }
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    let folder = vault.root.join(folder);
    fs::create_dir_all(&folder).map_err(|error| vault_fs::describe(&folder, error))?;
    let target = folder.join(name);
    let temporary = folder.join(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&temporary, content).map_err(|error| vault_fs::describe(&temporary, error))?;
    fs::rename(&temporary, &target).map_err(|error| vault_fs::describe(&target, error))
}

/// The bytes of a saved web file (a PDF). An error if the file is not there.
#[tauri::command]
pub fn read_web_bytes(app: AppHandle, state: State<'_, AppState>, root: String, path: String) -> Result<tauri::ipc::Response, String> {
    let (folder, name) = web_path(&path).ok_or_else(|| format!("\"{path}\" is not a web file of the vault."))?;
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    let file = vault.root.join(folder).join(name);
    let bytes = fs::read(&file).map_err(|error| vault_fs::describe(&file, error))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Writes a web file from raw bytes (a PDF). The vault and the path come in the headers (URL-encoded).
#[tauri::command]
pub fn write_web_bytes(app: AppHandle, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |key: &str| request.headers().get(key).and_then(|value| value.to_str().ok()).map(percent_decode).ok_or_else(|| format!("Header \"{key}\" is missing."));
    let root = header("x-root")?;
    let path = header("x-path")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("The file must come as raw bytes.".to_string()) };
    if bytes.len() > MAX_WEB_BYTES {
        return Err("The file is larger than 60 MB.".to_string());
    }
    let (folder, name) = web_path(&path).ok_or_else(|| format!("\"{path}\" is not a web file of the vault."))?;
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    let folder = vault.root.join(folder);
    fs::create_dir_all(&folder).map_err(|error| vault_fs::describe(&folder, error))?;
    let target = folder.join(name);
    let temporary = folder.join(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&temporary, bytes).map_err(|error| vault_fs::describe(&temporary, error))?;
    fs::rename(&temporary, &target).map_err(|error| vault_fs::describe(&target, error))
}

/// Copies a PDF file (from a file dialog) into the vault: `web/<key>.pdf`. The key comes from the content:
/// the same file gives the same key. Returns the key.
#[tauri::command]
pub fn import_pdf(app: AppHandle, state: State<'_, AppState>, root: String, source: String) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let source = local_path(&source)?;
    if !source.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("pdf")) {
        return Err(format!("\"{}\" is not a PDF file.", source.display()));
    }
    let size = fs::metadata(&source).map_err(|error| vault_fs::describe(&source, error))?.len();
    if size as usize > MAX_WEB_BYTES {
        return Err("The PDF is larger than 60 MB.".to_string());
    }
    let bytes = fs::read(&source).map_err(|error| vault_fs::describe(&source, error))?;
    let mut first = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut first);
    let mut second = std::collections::hash_map::DefaultHasher::new();
    (bytes.len(), "inspoboard-pdf").hash(&mut second);
    bytes.iter().rev().take(4096).collect::<Vec<_>>().hash(&mut second);
    let key = format!("{:016x}{:08x}", first.finish(), second.finish() as u32);
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    let folder = vault.root.join(WEB_FOLDER);
    fs::create_dir_all(&folder).map_err(|error| vault_fs::describe(&folder, error))?;
    let target = folder.join(format!("{key}.pdf"));
    if !target.is_file() {
        let temporary = folder.join(format!(".{key}.pdf.tmp-{}", std::process::id()));
        fs::write(&temporary, &bytes).map_err(|error| vault_fs::describe(&temporary, error))?;
        fs::rename(&temporary, &target).map_err(|error| vault_fs::describe(&target, error))?;
    }
    Ok(key)
}

/// A local file path from a link: "file:///…" (percent-encoded), "~/…" (the home folder), or a full path.
pub fn local_path(text: &str) -> Result<PathBuf, String> {
    let text = text.trim();
    let path = if let Some(rest) = text.strip_prefix("file://") {
        // "file:///Users/a" or "file://localhost/Users/a".
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        PathBuf::from(percent_decode(rest))
    } else if let Some(rest) = text.strip_prefix("~/") {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).ok_or("The home folder is not known.")?;
        PathBuf::from(home).join(rest)
    } else {
        PathBuf::from(text)
    };
    if !path.is_absolute() {
        return Err(format!("\"{text}\" is not a full file path."));
    }
    Ok(path)
}

/// Shows a local file in Finder (macOS), Explorer (Windows), or its folder (other systems). The app does not open the file.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    let path = local_path(&path)?;
    if !path.exists() {
        return Err(format!("There is no file at {}.", path.display()));
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg("-R").arg(&path).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open").arg(path.parent().unwrap_or(&path)).status();
    status.map(|_| ()).map_err(|error| format!("The file could not be shown: {error}"))
}

/// Opens a web address (http or https) in the default web browser. The app itself makes no network request.
#[tauri::command]
pub fn open_in_browser(url: String) -> Result<(), String> {
    let url = browser_url(&url)?;
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(&url).status();
    // rundll32 gets the address as one argument: no shell reads it.
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("rundll32").arg("url.dll,FileProtocolHandler").arg(&url).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open").arg(&url).status();
    status.map(|_| ()).map_err(|error| format!("The web browser could not open: {error}"))
}

/// The address, if it is a plain http or https address (no spaces or control characters).
fn browser_url(text: &str) -> Result<String, String> {
    let url = text.trim();
    let lower = url.to_ascii_lowercase();
    let web = (lower.starts_with("http://") || lower.starts_with("https://")) && url.len() > lower.find("//").unwrap_or(0) + 2;
    if !web || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("\"{url}\" is not a web address (http or https)."));
    }
    Ok(url.to_string())
}

/// "%2F" → "/". Header values are URL-encoded (a vault path can have characters that a header cannot).
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16)
        {
            out.push(byte);
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Writes an export file (Markdown or text) where the user selected in a save dialog.
#[tauri::command]
pub fn export_text(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let extension = target.extension().map(|value| value.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !target.is_absolute() || !matches!(extension.as_str(), "md" | "txt") {
        return Err(format!("\"{path}\" is not a Markdown or text file."));
    }
    let temporary = target.with_extension(format!("{extension}.tmp-{}", std::process::id()));
    fs::write(&temporary, content).map_err(|error| vault_fs::describe(&temporary, error))?;
    fs::rename(&temporary, &target).map_err(|error| vault_fs::describe(&target, error))
}

/// A text file of a board bundle: the board data in the vault format, or one Markdown document at the top.
pub fn bundle_text_path(relative: &str) -> bool {
    let simple = |part: &str| !part.is_empty() && !part.starts_with('.') && !part.contains('\\') && !part.contains(':');
    match relative.split('/').collect::<Vec<_>>().as_slice() {
        ["vault.json"] => true,
        [name] => simple(name) && name.ends_with(".md"),
        ["table", name] => simple(name) && name.ends_with(".jsonl"),
        ["items", name] => simple(name) && name.ends_with(".md"),
        _ => false,
    }
}

/// A folder name from a board name: no path characters, not empty.
fn bundle_folder_name(name: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '-' } else { c }).take(80).collect();
    let clean = clean.trim().trim_start_matches('.').trim().to_string();
    if clean.is_empty() { "Board".to_string() } else { clean }
}

/// The largest text file that a bundle import reads.
const MAX_BUNDLE_TEXT_BYTES: u64 = 20 * 1024 * 1024;

/// Writes a board bundle into a NEW folder in `parent` (an existing folder is never written into: the name gets
/// " 2", " 3", ...). `files`: bundle text files. `images`: vault images ("images/<name>") to copy. Returns the folder.
#[tauri::command]
pub fn export_bundle(app: AppHandle, state: State<'_, AppState>, root: String, parent: String, name: String, files: HashMap<String, String>, images: Vec<String>) -> Result<String, String> {
    let parent = PathBuf::from(&parent);
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(format!("\"{}\" is not a folder.", parent.display()));
    }
    let vault_root = {
        let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
        ensure_open(&app, &mut slot, &root)?.root.clone()
    };
    let base = bundle_folder_name(&name);
    let mut target = parent.join(&base);
    let mut number = 2;
    while target.exists() {
        target = parent.join(format!("{base} {number}"));
        number += 1;
    }
    if target.starts_with(&vault_root) {
        return Err("Choose a folder outside the vault.".to_string());
    }
    for relative in files.keys() {
        if !bundle_text_path(relative) {
            return Err(format!("\"{relative}\" is not a file of a board bundle."));
        }
    }
    fs::create_dir_all(&target).map_err(|error| vault_fs::describe(&target, error))?;
    for (relative, text) in &files {
        let path = target.join(relative);
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder).map_err(|error| vault_fs::describe(folder, error))?;
        }
        let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
        fs::write(&temporary, text).map_err(|error| vault_fs::describe(&temporary, error))?;
        fs::rename(&temporary, &path).map_err(|error| vault_fs::describe(&path, error))?;
    }
    for image in &images {
        let name = image_path(image).ok_or_else(|| format!("\"{image}\" is not an image of the vault."))?;
        let source = vault_root.join(IMAGES_FOLDER).join(name);
        // A missing image: its Markdown stays; the bundle has no file for it.
        if !source.is_file() {
            continue;
        }
        let folder = target.join(IMAGES_FOLDER);
        fs::create_dir_all(&folder).map_err(|error| vault_fs::describe(&folder, error))?;
        fs::copy(&source, folder.join(name)).map_err(|error| vault_fs::describe(&source, error))?;
    }
    Ok(target.display().to_string())
}

#[derive(serde::Serialize)]
pub struct BundleFiles {
    /// Text files of the board data: vault.json, table/*.jsonl, items/*.md.
    files: HashMap<String, String>,
    /// Images of the bundle ("images/<name>").
    images: Vec<String>,
}

/// Reads the board data of a bundle folder. It changes nothing.
#[tauri::command]
pub fn read_bundle(folder: String) -> Result<BundleFiles, String> {
    let folder = PathBuf::from(&folder);
    if !folder.is_absolute() || !folder.join("vault.json").is_file() {
        return Err("The folder is not a board bundle: it has no vault.json file.".to_string());
    }
    let read = |path: &Path| -> Result<String, String> {
        let size = fs::metadata(path).map_err(|error| vault_fs::describe(path, error))?.len();
        if size > MAX_BUNDLE_TEXT_BYTES {
            return Err(format!("{} is larger than 20 MB.", path.display()));
        }
        fs::read_to_string(path).map_err(|error| vault_fs::describe(path, error))
    };
    let mut files = HashMap::new();
    files.insert("vault.json".to_string(), read(&folder.join("vault.json"))?);
    for sub in ["table", "items"] {
        let Ok(entries) = fs::read_dir(folder.join(sub)) else { continue };
        for entry in entries.flatten() {
            let relative = format!("{sub}/{}", entry.file_name().to_string_lossy());
            if bundle_text_path(&relative) && entry.path().is_file() {
                files.insert(relative, read(&entry.path())?);
            }
        }
    }
    let mut images = Vec::new();
    if let Ok(entries) = fs::read_dir(folder.join(IMAGES_FOLDER)) {
        for entry in entries.flatten() {
            let relative = format!("{IMAGES_FOLDER}/{}", entry.file_name().to_string_lossy());
            if image_path(&relative).is_some() && entry.path().is_file() {
                images.push(relative);
            }
        }
    }
    images.sort();
    Ok(BundleFiles { files, images })
}

/// Copies the images of a bundle into `images/` of the vault (an existing image is never written again).
/// Returns bundle path -> vault path.
#[tauri::command]
pub fn import_bundle_images(app: AppHandle, state: State<'_, AppState>, root: String, folder: String, images: Vec<String>) -> Result<HashMap<String, String>, String> {
    let folder = PathBuf::from(&folder);
    let mut slot = state.vault.lock().map_err(|_| "Internal lock error.".to_string())?;
    let vault = ensure_open(&app, &mut slot, &root)?;
    if vault.read_only {
        return Err("The vault is read-only: a different Inspoboard window has it open.".to_string());
    }
    let mut paths = HashMap::new();
    for image in images {
        let name = image_path(&image).ok_or_else(|| format!("\"{image}\" is not an image of the bundle."))?;
        let source = folder.join(IMAGES_FOLDER).join(name);
        let size = fs::metadata(&source).map_err(|error| vault_fs::describe(&source, error))?.len();
        if size > MAX_IMAGE_BYTES {
            return Err(format!("{} is larger than 50 MB.", source.display()));
        }
        let bytes = fs::read(&source).map_err(|error| vault_fs::describe(&source, error))?;
        let stored = store_image(&vault.root, &source, &bytes)?;
        paths.insert(image, stored);
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_local_paths() {
        assert_eq!(local_path("file:///Users/a/My%20File.pdf").unwrap(), PathBuf::from("/Users/a/My File.pdf"));
        assert_eq!(local_path("file://localhost/tmp/x").unwrap(), PathBuf::from("/tmp/x"));
        assert!(local_path("~/Documents/x.pdf").unwrap().ends_with("Documents/x.pdf"));
        assert!(local_path("relative/x.pdf").is_err());
        assert!(reveal_file("/no/such/file/here".to_string()).is_err());
        assert!(browser_url("https://a.example/x?y=1").is_ok());
        assert!(browser_url("file:///etc/passwd").is_err());
        assert!(browser_url("https://a.example/ b").is_err());
        assert!(browser_url("https://").is_err());
        assert!(browser_url("-a https://x").is_err());
    }

    #[test]
    fn bundle_files_stay_in_the_bundle() {
        for good in ["vault.json", "Ideas.md", "table/items.jsonl", "items/abcdefghijkl.md"] {
            assert!(bundle_text_path(good), "{good}");
        }
        for bad in ["../x.md", "table/../../x.jsonl", "items/a/b.md", ".hidden.md", "images/a.png", "table/x.txt", "/etc/x.md", "a\\b.md", ""] {
            assert!(!bundle_text_path(bad), "{bad}");
        }
        assert_eq!(bundle_folder_name("A/B: c?"), "A-B- c-");
        assert_eq!(bundle_folder_name("  ..  "), "Board");
    }

    #[test]
    fn image_paths_stay_in_the_images_folder() {
        assert_eq!(image_path("images/sky-1.png"), Some("sky-1.png"));
        assert_eq!(image_path("images/../vault.json"), None);
        assert_eq!(image_path("images/a/b.png"), None);
        assert_eq!(image_path("images/.hidden.png"), None);
        assert_eq!(image_path("images/notes.md"), None);
        assert_eq!(image_path("table/items.jsonl"), None);
    }

    #[test]
    fn web_paths_stay_in_the_web_folder() {
        assert_eq!(web_path("web/0123456789abcdef01234567.html"), Some(("web", "0123456789abcdef01234567.html")));
        assert!(web_path("web/0123456789abcdef01234567.pdf").is_some());
        assert_eq!(web_path("marks/a1b2c3d4e5f6.json"), Some(("marks", "a1b2c3d4e5f6.json")));
        assert_eq!(web_path("marks/../items.json"), None);
        assert_eq!(web_path("marks/A1B2C3D4E5F6.json"), None);
        assert!(web_path("web/0123456789abcdef01234567.notes.json").is_some());
        assert_eq!(web_path("web/0123456789ABCDEF01234567.html"), None);
        assert_eq!(web_path("web/../table/items.jsonl"), None);
        assert_eq!(web_path("web/0123456789abcdef01234567.js"), None);
        assert_eq!(web_path("images/0123456789abcdef01234567.html"), None);
    }

    #[test]
    fn decodes_header_values() {
        assert_eq!(percent_decode("%2FUsers%2F%E4%BD%A0%2Fv"), "/Users/你/v");
        assert_eq!(percent_decode("plain%"), "plain%");
    }

    #[test]
    fn image_names_are_simple_and_stable() {
        let name = image_name(Path::new("/x/My Sky (1).JPG"), b"abc").unwrap();
        assert!(name.starts_with("My-Sky--1--") && name.ends_with(".jpg"));
        assert_eq!(name, image_name(Path::new("/y/My Sky (1).JPG"), b"abc").unwrap());
        assert!(image_path(&format!("images/{name}")).is_some());
        assert!(image_name(Path::new("/x/a.svg"), b"abc").is_err());
    }
}
