//! Watch the vault for changes from other programs. See docs/SPEC.md section 4.4.
//!
//! `KnownFiles` holds a hash of each data file as the app last read or wrote it.
//! A file event is sent to the frontend only if the file is now different.
//! Thus the app does not see its own writes as outside changes.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use tauri::{AppHandle, Emitter};

use crate::vault_fs::is_writable_path;

pub const CHANGE_EVENT: &str = "vault-file-changed";
const DEBOUNCE: Duration = Duration::from_millis(250);

/// Relative path -> hash of the content. `None` means "the file does not exist".
#[derive(Default)]
pub struct KnownFiles {
    hashes: HashMap<String, Option<u64>>,
}

impl KnownFiles {
    pub fn set(&mut self, relative: &str, content: Option<&[u8]>) {
        self.hashes.insert(relative.to_string(), content.map(hash_of));
    }

    /// Records the new state. Returns true if it is different from the known state.
    fn update(&mut self, relative: &str, content: Option<&[u8]>) -> bool {
        let new_hash = content.map(hash_of);
        let old_hash = self.hashes.insert(relative.to_string(), new_hash);
        old_hash != Some(new_hash)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChange {
    pub path: String,
    /// `None` if the file was deleted or is not valid UTF-8.
    pub content: Option<String>,
    pub unreadable: bool,
}

pub type VaultWatcher = Debouncer<RecommendedWatcher>;

pub fn start(app: AppHandle, root: PathBuf, known: Arc<Mutex<KnownFiles>>) -> Result<VaultWatcher, String> {
    let event_root = root.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        for event in events {
            if let Some(change) = check(&event_root, &event.path, &known) {
                let _ = app.emit(CHANGE_EVENT, change);
            }
        }
    })
    .map_err(|error| format!("Watcher: {error}"))?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("Watcher: {error}"))?;
    Ok(debouncer)
}

fn check(root: &Path, full: &Path, known: &Arc<Mutex<KnownFiles>>) -> Option<FileChange> {
    let relative = full.strip_prefix(root).ok()?;
    let relative: Vec<String> = relative.components().map(|part| part.as_os_str().to_string_lossy().to_string()).collect();
    let relative = relative.join("/");
    if !is_writable_path(&relative) {
        return None;
    }
    let bytes = fs::read(full).ok();
    let mut known = known.lock().ok()?;
    if !known.update(&relative, bytes.as_deref()) {
        return None;
    }
    let content = bytes.as_ref().and_then(|data| String::from_utf8(data.clone()).ok());
    let unreadable = bytes.is_some() && content.is_none();
    Some(FileChange { path: relative, content, unreadable })
}

fn hash_of(content: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}
