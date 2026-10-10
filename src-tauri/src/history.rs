//! Time machine: local Git snapshots of the vault. See docs/SPEC.md section 6.
//!
//! - The Git folder is `.inspoboard/history`. The working tree is the vault.
//!   Thus a user Git repository in the vault does not conflict with it.
//! - This module has no remote and no push function. The git2 build has no network support.

use std::fs;
use std::path::Path;

use git2::{Repository, RepositoryInitOptions, Signature, Sort};

use crate::vault_fs::{APP_FOLDER, describe};

const AUTHOR_NAME: &str = "Inspoboard";
const AUTHOR_EMAIL: &str = "inspoboard@localhost";
/// Folders with data files. A snapshot holds these folders and vault.json, nothing more.
const DATA_FOLDERS: [&str; 6] = ["table", "items", "assets", "images", "web", "marks"];
/// Tells other Git tools to ignore the app folder and temporary files.
const EXCLUDES: &str = "/.inspoboard/\n.*.tmp-*\n";

#[derive(Debug, serde::Serialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub message: String,
    /// Seconds since 1970-01-01 UTC.
    pub time: i64,
}

fn open_or_init(root: &Path) -> Result<Repository, String> {
    let git_folder = root.join(APP_FOLDER).join("history");
    let repository = if git_folder.join("HEAD").is_file() {
        Repository::open(&git_folder).map_err(to_text)?
    } else {
        fs::create_dir_all(&git_folder).map_err(|error| describe(&git_folder, error))?;
        // A bare init. A non-bare init with a separate working tree writes a ".git" link file
        // into the vault. That file makes the vault look like a Git repository to other tools.
        let mut options = RepositoryInitOptions::new();
        options.bare(true).no_reinit(true).external_template(false);
        Repository::init_opts(&git_folder, &options).map_err(to_text)?
    };
    // The vault folder can move. Always use the current location as the working tree.
    // `false`: do not write a ".git" link file into the vault.
    repository.set_workdir(root, false).map_err(to_text)?;
    remove_old_git_link(root, &git_folder);
    let exclude = git_folder.join("info").join("exclude");
    if fs::read_to_string(&exclude).ok().as_deref() != Some(EXCLUDES) {
        fs::create_dir_all(git_folder.join("info")).map_err(|error| describe(&git_folder, error))?;
        fs::write(&exclude, EXCLUDES).map_err(|error| describe(&exclude, error))?;
    }
    Ok(repository)
}

/// Earlier versions wrote a ".git" link file into the vault. Remove it only if it points to our history folder.
fn remove_old_git_link(root: &Path, git_folder: &Path) {
    let link = root.join(".git");
    if !link.is_file() {
        return;
    }
    let Ok(text) = fs::read_to_string(&link) else { return };
    let Some(target) = text.trim().strip_prefix("gitdir:") else { return };
    let target = Path::new(target.trim());
    let same = match (fs::canonicalize(target), fs::canonicalize(git_folder)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if same {
        let _ = fs::remove_file(&link);
    }
}

/// Saves the current files as a snapshot. Returns `None` if nothing changed since the last snapshot.
pub fn snapshot(root: &Path, message: &str) -> Result<Option<String>, String> {
    let repository = open_or_init(root)?;
    let mut index = repository.index().map_err(to_text)?;
    // The index holds exactly the current data files. Thus deleted files leave the snapshot.
    index.clear().map_err(to_text)?;
    for relative in snapshot_files(root)? {
        index.add_path(Path::new(&relative)).map_err(to_text)?;
    }
    index.write().map_err(to_text)?;
    let tree_id = index.write_tree().map_err(to_text)?;

    let parent = repository.head().ok().and_then(|head| head.peel_to_commit().ok());
    if parent.as_ref().is_some_and(|commit| commit.tree_id() == tree_id) {
        return Ok(None);
    }
    let tree = repository.find_tree(tree_id).map_err(to_text)?;
    let signature = Signature::now(AUTHOR_NAME, AUTHOR_EMAIL).map_err(to_text)?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let id = repository
        .commit(Some("HEAD"), &signature, &signature, message, &tree, &parents)
        .map_err(to_text)?;
    Ok(Some(id.to_string()))
}

/// Lists snapshots, the newest first.
pub fn list(root: &Path, limit: usize) -> Result<Vec<SnapshotInfo>, String> {
    let repository = open_or_init(root)?;
    if repository.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repository.revwalk().map_err(to_text)?;
    walk.set_sorting(Sort::TIME).map_err(to_text)?;
    walk.push_head().map_err(to_text)?;
    let mut result = Vec::new();
    for id in walk.take(limit) {
        let commit = repository.find_commit(id.map_err(to_text)?).map_err(to_text)?;
        result.push(SnapshotInfo {
            id: commit.id().to_string(),
            message: commit.message().unwrap_or("").to_string(),
            time: commit.time().seconds(),
        });
    }
    Ok(result)
}

/// Lists vault.json and all files in the data folders. Hidden files (temporary files) are skipped.
pub(crate) fn snapshot_files(root: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    if root.join("vault.json").is_file() {
        files.push("vault.json".to_string());
    }
    for folder in DATA_FOLDERS {
        collect_files(root, &root.join(folder), &mut files)?;
    }
    Ok(files)
}

fn collect_files(root: &Path, folder: &Path, files: &mut Vec<String>) -> Result<(), String> {
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(folder).map_err(|error| describe(folder, error))? {
        let entry = entry.map_err(|error| describe(folder, error))?;
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type().map_err(|error| describe(&path, error))?;
        if kind.is_dir() {
            collect_files(root, &path, files)?;
        } else if kind.is_file() {
            let relative = path.strip_prefix(root).map_err(|_| format!("{} is outside the vault.", path.display()))?;
            let parts: Vec<String> = relative.components().map(|part| part.as_os_str().to_string_lossy().to_string()).collect();
            files.push(parts.join("/"));
        }
    }
    Ok(())
}

fn to_text(error: git2::Error) -> String {
    format!("History: {}", error.message())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_fs::write_atomic;

    #[test]
    fn snapshots_only_when_files_change() {
        let folder = tempfile::tempdir().unwrap();
        write_atomic(folder.path(), "vault.json", "{}\n").unwrap();
        assert!(snapshot(folder.path(), "first").unwrap().is_some());
        assert!(snapshot(folder.path(), "same").unwrap().is_none());
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "text").unwrap();
        assert!(snapshot(folder.path(), "second").unwrap().is_some());
        let snapshots = list(folder.path(), 10).unwrap();
        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0].message, "second");
    }

    #[test]
    fn records_deletions_and_ignores_app_folder() {
        let folder = tempfile::tempdir().unwrap();
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "text").unwrap();
        fs::create_dir_all(folder.path().join(".inspoboard/cache")).unwrap();
        fs::write(folder.path().join(".inspoboard/cache/x"), "cache").unwrap();
        snapshot(folder.path(), "one").unwrap();
        fs::remove_file(folder.path().join("items/a1b2c3d4e5f6.md")).unwrap();
        assert!(snapshot(folder.path(), "two").unwrap().is_some());

        let repository = open_or_init(folder.path()).unwrap();
        let tree = repository.head().unwrap().peel_to_tree().unwrap();
        assert_eq!(tree.len(), 0, "deleted file is gone and the app folder is not in the snapshot");
        assert!(repository.remotes().unwrap().is_empty());
        assert!(!folder.path().join(".git").exists(), "no .git link file in the vault");
    }

    #[test]
    fn removes_only_our_old_git_link() {
        let folder = tempfile::tempdir().unwrap();
        let history = folder.path().join(".inspoboard/history");
        write_atomic(folder.path(), "vault.json", "{}\n").unwrap();
        snapshot(folder.path(), "one").unwrap();
        fs::write(folder.path().join(".git"), format!("gitdir: {}/\n", history.display())).unwrap();
        snapshot(folder.path(), "two").unwrap();
        assert!(!folder.path().join(".git").exists());

        fs::write(folder.path().join(".git"), "gitdir: /somewhere/else\n").unwrap();
        snapshot(folder.path(), "three").unwrap();
        assert!(folder.path().join(".git").exists(), "a link to a different repository stays");
    }
}
