//! Standalone HTML export. Paths come only from a user save dialog; image reads
//! are scoped to the parent of an already-open Markdown document.
use std::{fs, io::Read, path::{Component, Path, PathBuf}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use crate::{WorkspaceState, image_assets, disk_revision, path_key, write_atomic};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportRequest { name: String, html: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRequest { document_key: String, relative_path: String }
#[derive(Serialize)]
pub(crate) struct ExportImage { mime: &'static str, bytes: Vec<u8> }

fn redirected(info: &fs::Metadata) -> bool {
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if info.file_attributes() & 0x400 != 0 { return true; }
    }
    info.file_type().is_symlink()
}

fn image_path(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let decoded = percent_encoding::percent_decode_str(relative).decode_utf8().map_err(|_| "图片路径编码无效。")?;
    if decoded.is_empty() || decoded.chars().any(|ch| ch.is_control() || ['\\', ':', '?', '#'].contains(&ch)) { return Err("仅允许文档目录内的相对图片路径。".into()); }
    let mut path = base.to_path_buf();
    for part in Path::new(decoded.as_ref()).components() {
        match part {
            Component::Normal(name) => {
                path.push(name);
                if redirected(&fs::symlink_metadata(&path).map_err(|e| e.to_string())?) { return Err("不能导出符号链接图片。".into()); }
            }
            Component::CurDir => (),
            _ => return Err("图片不能越过文档目录。".into()),
        }
    }
    let canonical = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canonical.starts_with(base) { return Err("图片不能越过文档目录。".into()); }
    Ok(canonical)
}

#[tauri::command]
pub(crate) fn read_export_image(state: State<'_, WorkspaceState>, request: ImageRequest) -> Result<ExportImage, String> {
    read_export_image_bytes(&state, request)
}

fn read_export_image_bytes(state: &WorkspaceState, request: ImageRequest) -> Result<ExportImage, String> {
    let opened = state.opened_files.lock().map_err(|_| "文档状态不可用。")?
        .get(&request.document_key).cloned().ok_or("请先打开 Markdown 文档。")?;
    if !opened.path.extension().and_then(|s| s.to_str()).map(|s| ["md", "markdown", "mdown", "mkd"].contains(&s.to_ascii_lowercase().as_str())).unwrap_or(false)
        || dunce::canonicalize(&opened.path).map_err(|e| e.to_string())? != opened.path { return Err("文档身份无效。".into()); }
    let path = image_path(opened.path.parent().ok_or("文档目录无效。")?, &request.relative_path)?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || redirected(&metadata) || metadata.len() > image_assets::MAX_IMAGE_BYTES as u64 { return Err("图片超限或类型无效。".into()); }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|e| e.to_string())?.take(image_assets::MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > image_assets::MAX_IMAGE_BYTES { return Err("图片超过 8 MiB。".into()); }
    let (_, mime) = image_assets::detect_image(&bytes).ok_or("仅支持 PNG、JPEG、GIF、WebP。")?;
    Ok(ExportImage { mime, bytes })
}

fn write_export(state: &WorkspaceState, target: &Path, html: &str) -> Result<(), String> {
    if html.len() > 64 * 1024 * 1024 { return Err("导出 HTML 超过 64 MiB。".into()); }
    if !target.extension().and_then(|s| s.to_str()).map(|s| ["html", "htm"].contains(&s.to_ascii_lowercase().as_str())).unwrap_or(false) { return Err("导出目标必须是 .html 或 .htm。".into()); }
    let parent = dunce::canonicalize(target.parent().ok_or("导出目录无效。")?).map_err(|e| e.to_string())?;
    let target = parent.join(target.file_name().ok_or("导出文件名无效。")?);
    if let Ok(info) = fs::symlink_metadata(&target) {
        if redirected(&info) || !info.is_file() { return Err("导出目标不能是链接或目录。".into()); }
    }
    let identity = if target.exists() { dunce::canonicalize(&target).map_err(|e| e.to_string())? } else { target.clone() };
    if state.opened_files.lock().map_err(|_| "文档状态不可用。")?.values().any(|file| path_key(&file.path) == path_key(&identity)) { return Err("不能覆盖已打开的源文件。".into()); }
    let expected = disk_revision(&target)?;
    write_atomic(&target, html.as_bytes(), expected.as_deref())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn export_html(app: AppHandle, state: State<'_, WorkspaceState>, request: ExportRequest) -> Result<Option<String>, String> {
    if request.html.len() > 64 * 1024 * 1024 { return Err("导出 HTML 超过 64 MiB。".into()); }
    let name = Path::new(&request.name).file_stem().and_then(|s| s.to_str()).unwrap_or("导出文档");
    let selected = app.dialog().file().set_title("导出单文件 HTML").add_filter("HTML", &["html", "htm"]).set_file_name(format!("{name}.html")).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let target = selected.into_path().map_err(|e| e.to_string())?;
    write_export(&state, &target, &request.html)?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_rejects_non_html_and_preserves_files_on_failure() {
        let root = std::env::temp_dir().join(format!("sm-html-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("中文.md"); fs::write(&source, "original").unwrap();
        let state = WorkspaceState::default();
        assert!(write_export(&state, &source, "changed").is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), "original");
        let output = root.join("中文.html");
        write_export(&state, &output, "<!doctype html>中文").unwrap();
        assert_eq!(fs::read_to_string(&output).unwrap(), "<!doctype html>中文");
        let original_key = path_key(&output);
        state.opened_files.lock().unwrap().insert(original_key.clone(), crate::OpenedFile {
            path: dunce::canonicalize(&output).unwrap(), encoding: "utf-8".into(), bom: false,
            root: root.clone(), selected_encoding: None,
        });
        assert!(write_export(&state, &output, "bad").is_err());
        #[cfg(any(windows, target_os = "macos"))] {
            let alias = root.join("中文.HTML");
            if alias.exists() { assert!(write_export(&state, &alias, "bad").is_err()); }
        }
        state.opened_files.lock().unwrap().clear();
        #[cfg(unix)] {
            std::os::unix::fs::symlink(&output, root.join("link.html")).unwrap();
            assert!(write_export(&state, &root.join("link.html"), "bad").is_err());
        }
        let mut permissions = fs::metadata(&output).unwrap().permissions(); permissions.set_readonly(true); fs::set_permissions(&output, permissions).unwrap();
        assert!(write_export(&state, &output, "bad").is_err());
        assert_eq!(fs::read_to_string(&output).unwrap(), "<!doctype html>中文");
        let mut permissions = fs::metadata(&output).unwrap().permissions(); permissions.set_readonly(false); fs::set_permissions(&output, permissions).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn export_image_read_checks_document_magic_and_size() {
        let root = std::env::temp_dir().join(format!("sm-html-{}", uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let document = root.join("note.md"); fs::write(&document, "source").unwrap();
        let state = WorkspaceState::default();
        let key = path_key(&document);
        state.opened_files.lock().unwrap().insert(key.clone(), crate::OpenedFile {
            path: document, encoding: "utf-8".into(), bom: false, root: root.clone(), selected_encoding: None,
        });
        let request = || ImageRequest { document_key: key.clone(), relative_path: "image.png".into() };
        fs::write(root.join("image.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        assert_eq!(read_export_image_bytes(&state, request()).unwrap().mime, "image/png");
        fs::write(root.join("image.png"), b"<script>bad</script>").unwrap();
        assert!(read_export_image_bytes(&state, request()).is_err());
        fs::File::create(root.join("image.png")).unwrap().set_len(image_assets::MAX_IMAGE_BYTES as u64 + 1).unwrap();
        assert!(read_export_image_bytes(&state, request()).is_err());
        assert!(read_export_image_bytes(&state, ImageRequest { document_key: "unknown".into(), relative_path: "image.png".into() }).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn export_image_paths_are_relative_and_contained() {
        let root = std::env::temp_dir().join(format!("sm-html-{}", uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        fs::write(root.join("中文 图片.png"), b"image").unwrap();
        let root = dunce::canonicalize(root).unwrap();
        assert!(image_path(&root, "%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png").is_ok());
        for path in ["../secret.png", "%2e%2e/secret.png", "https://a/x.png", "C:/a.png", "/tmp/a.png", "data:image/png;base64,abc"] { assert!(image_path(&root, path).is_err(), "{path}"); }
        #[cfg(unix)] { std::os::unix::fs::symlink(root.join("中文 图片.png"), root.join("link.png")).unwrap(); assert!(image_path(&root, "link.png").is_err()); }
        fs::remove_dir_all(root).unwrap();
    }
}
