//! Vault lock. See docs/SPEC.md section 4.5.
//! The lock is an OS file lock. The OS releases it when the process stops,
//! also after a crash. Thus a stale lock cannot occur.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::Write;
use std::path::Path;

use crate::vault_fs::{APP_FOLDER, describe};

pub struct VaultLock {
    // The lock stays while this file handle is open.
    _file: File,
}

/// Returns `Some(lock)` if this process now owns the vault.
/// Returns `None` if a different process owns it. Then the app must open the vault as read-only.
pub fn try_acquire(root: &Path) -> Result<Option<VaultLock>, String> {
    let folder = root.join(APP_FOLDER);
    fs::create_dir_all(&folder).map_err(|error| describe(&folder, error))?;
    let path = folder.join("lock");
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|error| describe(&path, error))?;
    match file.try_lock() {
        Ok(()) => {
            // The process ID helps a person who looks at the file. The lock does not use it.
            let _ = file.set_len(0);
            let _ = writeln!(file, "{}", std::process::id());
            Ok(Some(VaultLock { _file: file }))
        }
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(describe(&path, error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_lock_fails_until_first_is_released() {
        let folder = tempfile::tempdir().unwrap();
        let first = try_acquire(folder.path()).unwrap();
        assert!(first.is_some());
        assert!(try_acquire(folder.path()).unwrap().is_none());
        drop(first);
        assert!(try_acquire(folder.path()).unwrap().is_some());
    }
}
