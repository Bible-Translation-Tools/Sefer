//! A folder's files in one round trip: the `FolderTree` service's desktop
//! half (`src/core/resources/kinds/tree.ts`, `src/platform/tauri/tree.ts`).
//!
//! Through the fs plugin every file costs one IPC call, and a reference
//! resource is thousands of small files: Translation Notes' Psalms is about
//! 2,600 chunk files, which its freshness check stat'ed one at a time and its
//! first read read one at a time — 12 s and 40 s with the display awake
//! (2026-10-13). Here a listing and a bulk read are one call each, walked on a
//! blocking thread.
//!
//! Both are read-only, and both answer only inside the app data folder, where
//! the projects and the library live (`src/app/services.ts`). They read with
//! `std::fs` rather than through the fs plugin, so they check for themselves:
//! the folder asked for is canonicalised and refused unless it is below the
//! canonical app data folder, and each file read is checked the same way, so a
//! symlink cannot lead out. The walk does not follow symlinks at all, so a link
//! loop cannot recurse.

use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

use crate::errors::{fail, IO, REFUSED};

/// One file below the listed folder: its path relative to it (`/`-separated),
/// its size, and its modification time in milliseconds since the epoch (0
/// when the platform has none) — what `filesBelow` fingerprints.
#[derive(Serialize)]
pub struct ListedFile {
    path: String,
    size: u64,
    mtime: u64,
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn walk(root: &Path, directory: &Path, out: &mut Vec<ListedFile>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        // `file_type` does not follow a symlink: a link is skipped, so a loop
        // cannot recurse and a link cannot lead outside the root.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            walk(root, &path, out)?;
        } else if kind.is_file() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| {
                    u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
                });
            out.push(ListedFile {
                path: relative(root, &path),
                size: meta.len(),
                mtime,
            });
        }
    }
    Ok(())
}

/// The canonical app data folder: the only place these commands read.
fn allowed(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|error| fail(IO, error.to_string()))?;
    folder
        .canonicalize()
        .map_err(|error| fail(IO, format!("{}: {error}", folder.display())))
}

/// `directory` canonicalised when it is inside `allowed`; `Ok(None)` when it
/// does not exist but its nearest existing folder is inside; refused otherwise.
fn inside(allowed: &Path, directory: &str) -> Result<Option<PathBuf>, String> {
    let refused = || {
        fail(
            REFUSED,
            format!("{directory} is outside the app data folder"),
        )
    };
    let asked = Path::new(directory);
    if !asked.is_absolute() || asked.components().any(|part| part == Component::ParentDir) {
        return Err(refused());
    }
    let mut existing = asked;
    loop {
        match existing.canonicalize() {
            Ok(real) if real.starts_with(allowed) => {
                return Ok((existing == asked).then_some(real));
            }
            Ok(_) => return Err(refused()),
            Err(_) => match existing.parent() {
                Some(parent) => existing = parent,
                None => return Err(refused()),
            },
        }
    }
}

fn listing(allowed: &Path, directory: String) -> Result<Vec<ListedFile>, String> {
    // No folder is no files, as the port says, not a failure.
    let Some(root) = inside(allowed, &directory)? else {
        return Ok(Vec::new());
    };
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    walk(&root, &root, &mut files).map_err(|error| fail(IO, format!("{directory}: {error}")))?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Every file below `directory`, sorted by path, with its size and mtime.
#[tauri::command]
pub async fn tree_listing(
    app: tauri::AppHandle,
    directory: String,
) -> Result<Vec<ListedFile>, String> {
    let allowed = allowed(&app)?;
    tauri::async_runtime::spawn_blocking(move || listing(&allowed, directory))
        .await
        .map_err(|error| fail(IO, error.to_string()))?
}

fn read_all(allowed: &Path, directory: String, paths: Vec<String>) -> Result<Vec<u8>, String> {
    let root = inside(allowed, &directory)?
        .ok_or_else(|| fail(IO, format!("{directory}: no such folder")))?;
    let mut out = Vec::new();
    for path in &paths {
        let inside = Path::new(path);
        if inside
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(fail(REFUSED, format!("{path} is not inside {directory}")));
        }
        let file = root
            .join(inside)
            .canonicalize()
            .map_err(|error| fail(IO, format!("{path}: {error}")))?;
        // A symlink inside the folder may still point out of it.
        if !file.starts_with(&root) {
            return Err(fail(REFUSED, format!("{path} is not inside {directory}")));
        }
        let bytes = std::fs::read(&file).map_err(|error| fail(IO, format!("{path}: {error}")))?;
        let length = u32::try_from(bytes.len())
            .map_err(|_| fail(IO, format!("{path}: larger than 4 GiB")))?;
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&bytes);
    }
    Ok(out)
}

/// The bytes of `paths` (relative to `directory`), in the order asked, as one
/// binary answer: each file is a little-endian `u32` length and its bytes.
/// Binary rather than JSON because a JSON byte array is several times larger
/// and has to be parsed.
#[tauri::command]
pub async fn tree_read(
    app: tauri::AppHandle,
    directory: String,
    paths: Vec<String>,
) -> Result<tauri::ipc::Response, String> {
    let allowed = allowed(&app)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read_all(&allowed, directory, paths))
        .await
        .map_err(|error| fail(IO, error.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}
