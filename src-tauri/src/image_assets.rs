//! Issue #5: image assets are scoped to an already opened Markdown document.
//! No request can choose an arbitrary destination path or load a file outside
//! that document's own <stem>.assets directory.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::{OpenedFile, WorkspaceState};

pub(crate) const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const SEGMENT_ESCAPES: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'#')
    .add(b'%')
    .add(b'?')
    .add(b'(')
    .add(b')')
    .add(b'[')
    .add(b']')
    .add(b'\\')
    .add(b'<')
    .add(b'>');

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportImageRequest {
    document_key: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadImageRequest {
    document_key: String,
    relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageImportResult {
    relative_path: String,
    mime: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageReadResult {
    mime: &'static str,
    bytes: Vec<u8>,
}

// No SVG / HTML / PDF. A magic header, not a caller-provided extension or
// MIME string, determines the stored type. WebView2 still performs decoding.
pub(crate) fn detect_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.len() >= 3 && bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else {
        None
    }
}

fn verified_document(state: &WorkspaceState, key: &str) -> Result<(PathBuf, String), String> {
    let opened: OpenedFile = state.opened_files
        .lock().map_err(|_| "文档状态不可用。".to_string())?
        .get(key).cloned().ok_or_else(|| "请先保存或打开 Markdown 文件，再插入图片。".to_string())?;
    let path = &opened.path;
    let actual = dunce::canonicalize(path).map_err(|error| error.to_string())?;
    if actual != *path {
        return Err("文档路径已变化，请重新打开后再导入图片。".to_string());
    }
    let info = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !info.is_file() || info.file_type().is_symlink() {
        return Err("只允许向已打开的普通 Markdown 文件导入图片。".to_string());
    }
    let supported = path.extension().and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd"))
        .unwrap_or(false);
    if !supported {
        return Err("请先选择 Markdown 文档，而不是 TXT 或代码文件。".to_string());
    }
    let stem = path.file_stem().and_then(|name| name.to_str())
        .ok_or_else(|| "Markdown 文档名称无效。".to_string())?;
    if stem.is_empty() { return Err("Markdown 文档名称无效。".to_string()); }
    let parent = path.parent().ok_or_else(|| "文档所在目录无效。".to_string())?;
    if dunce::canonicalize(parent).map_err(|error| error.to_string())? != parent {
        return Err("文档所在目录已变化，请重新打开后重试。".to_string());
    }
    let folder = format!("{stem}.assets");
    Ok((parent.join(&folder), folder))
}

fn validated_asset_folder(state: &WorkspaceState, key: &str, create: bool)
    -> Result<(PathBuf, String), String>
{
    let (folder_path, folder_name) = verified_document(state, key)?;
    match fs::symlink_metadata(&folder_path) {
        Ok(info) if info.file_type().is_symlink() || !info.is_dir() =>
            return Err("图片资源目录不是普通文件夹，拒绝访问。".to_string()),
        Ok(_) => {},
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            match fs::create_dir(&folder_path) {
                Ok(()) => {},
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
                Err(error) => return Err(format!("无法创建图片资源目录：{error}")),
            }
        },
        Err(error) => return Err(format!("图片资源目录不可用：{error}")),
    }
    let info = fs::symlink_metadata(&folder_path).map_err(|error| error.to_string())?;
    if info.file_type().is_symlink() || !info.is_dir()
        || dunce::canonicalize(&folder_path).map_err(|error| error.to_string())? != folder_path {
        return Err("图片资源目录已变化或指向外部位置，拒绝访问。".to_string());
    }
    Ok((folder_path, folder_name))
}

// Publishing a new random filename must never replace an existing file.
// The temporary file is fully written and synced before becoming visible.
#[cfg(windows)]
fn publish_new_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
    let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn publish_new_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::hard_link(temporary, destination)?;
    fs::remove_file(temporary)
}

// Inspect an OS-dropped path without exposing it to the renderer. Only real
// regular files with a supported image signature are classified as images.
pub(crate) fn inspect_dropped_path(path: &Path) -> Result<Option<(u64, PathBuf)>, String> {
    let info = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if info.file_type().is_symlink() {
        if path.extension().and_then(|value| value.to_str())
            .map(|value| matches!(value.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp"))
            .unwrap_or(false) {
            return Err("拒绝导入符号链接图片，请直接拖入原始图片文件。".to_string());
        }
        return Ok(None);
    }
    if !info.is_file() { return Ok(None); }

    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 12];
    let count = file.read(&mut header).map_err(|error| error.to_string())?;
    let supported_header = detect_image(&header[..count]).is_some();
    let image_extension = path.extension().and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp"))
        .unwrap_or(false);
    if !supported_header && !image_extension { return Ok(None); }
    if info.len() > MAX_IMAGE_BYTES as u64 {
        return Err(format!("图片 {} 超过 8 MiB，已拒绝导入。", path.file_name().unwrap_or_default().to_string_lossy()));
    }
    if !supported_header {
        return Err(format!("图片 {} 的文件头无效，已拒绝导入。", path.file_name().unwrap_or_default().to_string_lossy()));
    }
    let canonical = dunce::canonicalize(path).map_err(|error| error.to_string())?;
    Ok(Some((info.len(), canonical)))
}

// The token is created only from a native user-initiated DragDrop event.
// Re-check the path and size immediately before reading, then reuse the exact
// same document-scoped atomic asset writer as clipboard and picker imports.
pub(crate) fn import_dropped_path(
    state: &WorkspaceState, key: &str, path: &Path,
) -> Result<ImageImportResult, String> {
    let info = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if info.file_type().is_symlink() || !info.is_file() {
        return Err("拖入的图片已变化，拒绝读取符号链接或非普通文件。".to_string());
    }
    if info.len() > MAX_IMAGE_BYTES as u64 {
        return Err("图片超过 8 MiB，已拒绝导入。".to_string());
    }
    let canonical = dunce::canonicalize(path).map_err(|error| error.to_string())?;
    if canonical != path {
        return Err("拖入的图片路径已变化，拒绝访问。".to_string());
    }
    let file = File::open(&canonical).map_err(|error| error.to_string())?;
    let mut limited = file.take(MAX_IMAGE_BYTES as u64 + 1);
    let mut bytes = Vec::with_capacity(info.len() as usize);
    limited.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片超过 8 MiB，已拒绝导入。".to_string());
    }
    if detect_image(&bytes).is_none() {
        return Err("拖入文件的图片格式无效，仅支持 PNG、JPEG、GIF 或 WebP。".to_string());
    }
    import_bytes(state, key, &bytes)
}

fn import_bytes(state: &WorkspaceState, key: &str, bytes: &[u8])
    -> Result<ImageImportResult, String>
{
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片必须是非空文件，大小不超过 8 MiB。".to_string());
    }
    let (extension, mime) = detect_image(bytes)
        .ok_or_else(|| "仅支持 PNG、JPEG、GIF 或 WebP 图片；拒绝 SVG 和其他文件类型。".to_string())?;
    // Do not create any output until the document authorization is checked.
    let (folder, folder_name) = validated_asset_folder(state, key, true)?;
    let uuid = Uuid::new_v4();
    let filename = format!("{uuid}.{extension}");
    let temporary = folder.join(format!(".{uuid}.tmp"));
    let destination = folder.join(&filename);
    let result = (|| -> Result<(), String> {
        let mut handle = OpenOptions::new().write(true).create_new(true).open(&temporary)
            .map_err(|error| format!("图片暂存文件创建失败：{error}"))?;
        handle.write_all(bytes).map_err(|error| format!("图片写入失败：{error}"))?;
        handle.sync_all().map_err(|error| format!("图片同步失败：{error}"))?;
        drop(handle);
        // Refuse changed/replaced asset directories before publishing the image.
        if fs::symlink_metadata(&folder).map_err(|error| error.to_string())?.file_type().is_symlink()
            || dunce::canonicalize(&folder).map_err(|error| error.to_string())? != folder {
            return Err("图片资源目录已变化，导入已取消。".to_string());
        }
        publish_new_file(&temporary, &destination)
            .map_err(|error| format!("无法安全发布图片文件：{error}"))?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result?;
    Ok(ImageImportResult {
        relative_path: format!("{}/{}", utf8_percent_encode(&folder_name, SEGMENT_ESCAPES), filename),
        mime,
    })
}

fn read_bytes(state: &WorkspaceState, request: &ReadImageRequest)
    -> Result<ImageReadResult, String>
{
    let (folder, folder_name) = validated_asset_folder(state, &request.document_key, false)?;
    let decoded = percent_decode_str(&request.relative_path).decode_utf8()
        .map_err(|_| "图片资源链接编码无效。".to_string())?;
    let relative = decoded.strip_prefix("./").unwrap_or(decoded.as_ref());
    let mut segments = relative.split('/');
    let first = segments.next().unwrap_or_default();
    let second = segments.next().unwrap_or_default();
    if first != folder_name || second.is_empty() || segments.next().is_some()
        || second.contains('\\') || second.contains(':') {
        return Err("图片资源链接不属于当前 Markdown 文档。".to_string());
    }
    let (uuid, ext) = second.rsplit_once('.')
        .ok_or_else(|| "图片文件名无效。".to_string())?;
    Uuid::parse_str(uuid).map_err(|_| "图片文件名无效。".to_string())?;
    if !matches!(ext, "png" | "jpg" | "gif" | "webp") {
        return Err("图片格式无效。".to_string());
    }
    let target = folder.join(second);
    let info = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if info.file_type().is_symlink() || !info.is_file() || info.len() > MAX_IMAGE_BYTES as u64 {
        return Err("拒绝读取不安全或超大图片。".to_string());
    }
    if dunce::canonicalize(&target).map_err(|error| error.to_string())? != target {
        return Err("图片资源路径已变化，拒绝访问。".to_string());
    }
    let bytes = fs::read(&target).map_err(|error| error.to_string())?;
    let (detected, mime) = detect_image(&bytes).ok_or_else(|| "图片内容类型无效。".to_string())?;
    if detected != ext { return Err("图片内容与扩展名不匹配。".to_string()); }
    Ok(ImageReadResult { mime, bytes })
}

#[tauri::command]
pub(crate) fn import_image_bytes(state: State<'_, WorkspaceState>, request: ImportImageRequest)
    -> Result<ImageImportResult, String>
{
    import_bytes(&state, &request.document_key, &request.bytes)
}

#[tauri::command]
pub(crate) async fn choose_image_and_import(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    document_key: String,
) -> Result<Option<ImageImportResult>, String> {
    // Validate the target before displaying a user-granted file picker.
    verified_document(&state, &document_key)?;
    let picker = app.dialog().file().set_title("插入本地图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp"]);
    let Some(selection) = picker.blocking_pick_file() else { return Ok(None); };
    let path = selection.into_path().map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("请选择不超过 8 MiB 的普通图片文件。".to_string());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    import_bytes(&state, &document_key, &bytes).map(Some)
}

#[tauri::command]
pub(crate) fn read_image_asset(state: State<'_, WorkspaceState>, request: ReadImageRequest)
    -> Result<ImageReadResult, String>
{
    read_bytes(&state, &request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{path_key, OpenedFile};

    fn sample_png() -> Vec<u8> {
        b"\x89PNG\r\n\x1a\nsmall-test-payload".to_vec()
    }

    fn fixture() -> (WorkspaceState, PathBuf, String) {
        let root = std::env::temp_dir().join(format!("supermarkdown-image-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let root = dunce::canonicalize(&root).unwrap();
        let document = root.join("中文 笔记.md");
        fs::write(&document, "# 本地图片\n").unwrap();
        let key = path_key(&document);
        let state = WorkspaceState::default();
        state.opened_files.lock().unwrap().insert(key.clone(), OpenedFile {
            path: document, encoding: "utf-8".to_owned(), bom: false,
            root: root.clone(), selected_encoding: None,
        });
        (state, root, key)
    }

    #[test]
    fn dropped_images_are_classified_by_magic_and_imported_through_managed_assets() {
        let (state, root, key) = fixture();
        let result = (|| -> Result<(), String> {
            let source = root.join("截图 中文.png");
            let bytes = sample_png();
            fs::write(&source, &bytes).map_err(|error| error.to_string())?;
            let (size, canonical) = inspect_dropped_path(&source)?
                .ok_or_else(|| "expected an image".to_string())?;
            assert_eq!(size, bytes.len() as u64);
            assert_eq!(canonical, dunce::canonicalize(&source).unwrap());
            let imported = import_dropped_path(&state, &key, &canonical)?;
            assert!(imported.relative_path.starts_with("%E4%B8%AD%E6%96%87%20"));
            let read = read_bytes(&state, &ReadImageRequest {
                document_key: key.clone(), relative_path: imported.relative_path,
            })?;
            assert_eq!(read.bytes, bytes);
            Ok(())
        })();
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }

    #[test]
    fn dropped_file_classifier_keeps_text_files_and_rejects_bad_or_oversize_images() {
        let (state, root, key) = fixture();
        let result = (|| -> Result<(), String> {
            let text = root.join("notes.txt");
            fs::write(&text, "ordinary text").map_err(|error| error.to_string())?;
            assert!(inspect_dropped_path(&text)?.is_none());

            let fake = root.join("fake.png");
            fs::write(&fake, b"not an image").map_err(|error| error.to_string())?;
            assert!(inspect_dropped_path(&fake).is_err());

            let huge = root.join("huge.webp");
            let mut file = File::create(&huge).map_err(|error| error.to_string())?;
            file.write_all(b"RIFFxxxxWEBP").map_err(|error| error.to_string())?;
            file.set_len(MAX_IMAGE_BYTES as u64 + 1).map_err(|error| error.to_string())?;
            assert!(inspect_dropped_path(&huge).is_err());
            assert!(import_dropped_path(&state, &key, &huge).is_err());
            Ok(())
        })();
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }

    #[test]
    fn import_round_trip_reopens_and_uses_portable_relative_url() {
        let (state, root, key) = fixture();
        let result = (|| -> Result<(), String> {
            let original = sample_png();
            let first = import_bytes(&state, &key, &original)?;
            let second = import_bytes(&state, &key, &original)?;
            assert_ne!(first.relative_path, second.relative_path);
            assert!(first.relative_path.starts_with("%E4%B8%AD%E6%96%87%20"));
            assert!(first.relative_path.contains(".assets/"));
            assert_eq!(first.mime, "image/png");
            let read = read_bytes(&state, &ReadImageRequest {
                document_key: key.clone(), relative_path: first.relative_path,
            })?;
            assert_eq!(read.bytes, original);
            assert_eq!(read.mime, "image/png");
            Ok(())
        })();
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }

    #[test]
    fn rejects_unauthorized_document_and_path_traversal() {
        let (state, root, key) = fixture();
        let result = (|| -> Result<(), String> {
            assert!(import_bytes(&state, "unopened.md", &sample_png()).is_err());
            let first = import_bytes(&state, &key, &sample_png())?;
            for malicious in [
                "../outside.png", "%2E%2E/outside.png", "/etc/passwd",
                "中文 笔记.assets/../../../outside.png",
                "other.assets/550e8400-e29b-41d4-a716-446655440000.png",
            ] {
                assert!(read_bytes(&state, &ReadImageRequest {
                    document_key: key.clone(), relative_path: malicious.to_string(),
                }).is_err(), "unexpectedly accepted: {malicious}");
            }
            let fake = first.relative_path.replace(".png", ".svg");
            assert!(read_bytes(&state, &ReadImageRequest {
                document_key: key.clone(), relative_path: fake,
            }).is_err());
            Ok(())
        })();
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }

    #[test]
    fn rejects_masqueraded_files_oversize_and_non_directory_assets() {
        let (state, root, key) = fixture();
        let result = (|| -> Result<(), String> {
            assert!(import_bytes(&state, &key, b"<svg><script>alert(1)</script></svg>").is_err());
            assert!(import_bytes(&state, &key, b"%PDF-1.7").is_err());
            assert!(import_bytes(&state, &key, &[]).is_err());
            assert!(import_bytes(&state, &key, &vec![b'x'; MAX_IMAGE_BYTES + 1]).is_err());
            fs::write(root.join("中文 笔记.assets"), b"not a directory").map_err(|error| error.to_string())?;
            assert!(import_bytes(&state, &key, &sample_png()).is_err());
            assert!(read_bytes(&state, &ReadImageRequest {
                document_key: key.clone(),
                relative_path: "中文 笔记.assets/fake.png".to_string(),
            }).is_err());
            Ok(())
        })();
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }
}
