#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use arboard::Clipboard;
use encoding_rs::{BIG5, GB18030, GBK, WINDOWS_1252};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Default)]
struct WorkspaceState {
    opened_files: Mutex<HashMap<String, OpenedFile>>,
    known_roots: Mutex<HashSet<PathBuf>>,
    active_root: Mutex<Option<PathBuf>>,
    pending_files: Mutex<Vec<PathBuf>>,
}

#[derive(Clone)]
struct OpenedFile {
    path: PathBuf,
    encoding: String,
    bom: bool,
    root: PathBuf,
    selected_encoding: Option<String>,
}

impl WorkspaceState {
    fn queue_paths(&self, paths: Vec<PathBuf>) {
        if let Ok(mut pending) = self.pending_files.lock() {
            for path in paths {
                if !pending.contains(&path) {
                    pending.push(path);
                }
            }
        }
    }

    fn take_paths(&self) -> Vec<PathBuf> {
        self.pending_files.lock().map(|mut value| std::mem::take(&mut *value)).unwrap_or_default()
    }
}

#[derive(Default)]
struct CloseState {
    approved: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderInfo {
    name: String,
    path: String,
    entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    content: String,
    encoding: String,
    bom: bool,
    revision: String,
    id: String,
    path: String,
    root: String,
    directory: String,
    key: String,
    name: String,
    selected_encoding: Option<String>,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileResult {
    file: FileInfo,
    folder: FolderInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupResult {
    verify: bool,
    drafts: Vec<Value>,
    recovery_error: String,
    preferences: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFormat {
    encoding: String,
    bom: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    key: String,
    content: String,
    revision: String,
    format: Option<FileFormat>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAsRequest {
    name: String,
    content: String,
    key: Option<String>,
    open_keys: Vec<String>,
    format: Option<FileFormat>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReloadEncodingRequest {
    key: String,
    encoding: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMarkdownRequest {
    directory_id: String,
    name: String,
    root: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryActionRequest {
    action: String,
    id: String,
    root: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileActionRequest {
    action: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkRequest {
    href: String,
    from_key: Option<String>,
}

struct LinkInfo {
    kind: String,
    target: String,
    fragment: String,
    path: Option<PathBuf>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn path_key(path: &Path) -> String {
    let value = path_string(path);
    if cfg!(windows) { value.to_lowercase() } else { value }
}

fn revision_of(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let result = unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, target)
    }
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "保存路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temporary = parent.join(format!(".{}.{}.tmp", name, Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(value.to_string().as_bytes()).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        replace_file(&temporary, path).map_err(|error| error.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn read_preferences(app: &AppHandle) -> Result<Value, String> {
    let path = app_data_dir(app)?.join("preferences.json");
    let defaults = json!({ "theme": "light", "sidebar": "files", "readingZoom": 100 });
    let stored = match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<Value>(&text).unwrap_or(defaults.clone()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => defaults.clone(),
        Err(error) => return Err(error.to_string()),
    };
    Ok(normalize_preferences(&stored))
}

fn normalize_preferences(value: &Value) -> Value {
    let mut result = json!({ "theme": "light", "sidebar": "files", "readingZoom": 100 });
    if let Some(theme) = value.get("theme").and_then(Value::as_str) {
        if ["light", "dark", "cream", "gray"].contains(&theme) {
            result["theme"] = json!(theme);
        }
    }
    if let Some(sidebar) = value.get("sidebar").and_then(Value::as_str) {
        if ["files", "outline", "hidden"].contains(&sidebar) {
            result["sidebar"] = json!(sidebar);
        }
    }
    if let Some(zoom) = value.get("readingZoom").and_then(Value::as_i64) {
        if (50..=300).contains(&zoom) {
            result["readingZoom"] = json!(zoom);
        }
    }
    result
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("UTF-16 文件长度无效。".to_string());
    }
    let units = bytes.chunks_exact(2).map(|pair| {
        if little_endian { u16::from_le_bytes([pair[0], pair[1]]) }
        else { u16::from_be_bytes([pair[0], pair[1]]) }
    });
    std::char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|_| "UTF-16 文件包含无效字符序列。".to_string())
}

fn decode_with_rs(bytes: &[u8], encoding: &'static encoding_rs::Encoding) -> Option<String> {
    encoding.decode_without_bom_handling_and_without_replacement(bytes).map(|value| value.into_owned())
}

fn decode_encoding(bytes: &[u8], encoding: &str) -> Result<(String, bool), String> {
    match encoding {
        "utf-8" => {
            let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
            let payload = if bom { &bytes[3..] } else { bytes };
            String::from_utf8(payload.to_vec()).map(|value| (value, bom))
                .map_err(|_| "UTF-8 文件包含无效字节序列。".to_string())
        }
        "utf-16le" => {
            let bom = bytes.starts_with(&[0xFF, 0xFE]);
            let payload = if bom { &bytes[2..] } else { bytes };
            decode_utf16(payload, true).map(|value| (value, bom))
        }
        "utf-16be" => {
            let bom = bytes.starts_with(&[0xFE, 0xFF]);
            let payload = if bom { &bytes[2..] } else { bytes };
            decode_utf16(payload, false).map(|value| (value, bom))
        }
        "ascii" => {
            if bytes.iter().any(|byte| *byte > 0x7F) {
                return Err("文件包含 ASCII 无法表示的字符。".to_string());
            }
            Ok((bytes.iter().map(|byte| *byte as char).collect(), false))
        }
        "latin1" => Ok((bytes.iter().map(|byte| char::from(*byte)).collect(), false)),
        "gbk" => decode_with_rs(bytes, GBK).map(|value| (value, false))
            .ok_or_else(|| "GBK 文件包含无效字节序列。".to_string()),
        "gb18030" => decode_with_rs(bytes, GB18030).map(|value| (value, false))
            .ok_or_else(|| "GB18030 文件包含无效字节序列。".to_string()),
        "big5" => decode_with_rs(bytes, BIG5).map(|value| (value, false))
            .ok_or_else(|| "Big5 文件包含无效字节序列。".to_string()),
        "windows-1252" => decode_with_rs(bytes, WINDOWS_1252).map(|value| (value, false))
            .ok_or_else(|| "Windows-1252 文件包含无效字节序列。".to_string()),
        _ => Err("不支持这个读取编码。".to_string()),
    }
}

fn decode_text(bytes: &[u8]) -> Result<(String, String, bool), String> {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_encoding(bytes, "utf-16le").map(|(text, bom)| (text, "utf-16le".to_string(), bom));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_encoding(bytes, "utf-16be").map(|(text, bom)| (text, "utf-16be".to_string(), bom));
    }
    if bytes.starts_with(b"%PDF-") || bytes.contains(&0) {
        return Err("此文件不是当前可读取的文本文件。".to_string());
    }
    let candidates = ["utf-8", "gb18030", "big5", "windows-1252", "latin1"];
    for candidate in candidates {
        if let Ok((text, bom)) = decode_encoding(bytes, candidate) {
            let controls = text.chars().filter(|ch| {
                let value = *ch as u32;
                (value <= 0x08) || (value >= 0x0E && value <= 0x1F) || value == 0x7F
            }).count();
            if text.contains('\0') || controls as f64 / text.chars().count().max(1) as f64 > 0.02 {
                return Err("此文件不是当前可读取的文本文件。".to_string());
            }
            return Ok((text, candidate.to_string(), bom));
        }
    }
    Err("此文件不是当前可读取的文本文件。".to_string())
}

fn encode_text(content: &str, encoding: &str, bom: bool) -> Result<Vec<u8>, String> {
    let mut bytes = match encoding {
        "utf-8" => content.as_bytes().to_vec(),
        "utf-16le" | "utf-16be" => {
            let mut result = Vec::with_capacity(content.len() * 2);
            for unit in content.encode_utf16() {
                let encoded = if encoding == "utf-16le" { unit.to_le_bytes() } else { unit.to_be_bytes() };
                result.extend_from_slice(&encoded);
            }
            result
        }
        "ascii" => {
            if !content.is_ascii() { return Err("当前编码无法完整保存这些字符，请另存为 UTF-8 文件。".to_string()); }
            content.as_bytes().to_vec()
        }
        "latin1" => {
            let mut result = Vec::with_capacity(content.len());
            for ch in content.chars() {
                if ch as u32 > 0xFF { return Err("当前编码无法完整保存这些字符，请另存为 UTF-8 文件。".to_string()); }
                result.push(ch as u8);
            }
            result
        }
        "gbk" | "gb18030" | "big5" | "windows-1252" => {
            let encoder = match encoding {
                "gbk" => GBK,
                "gb18030" => GB18030,
                "big5" => BIG5,
                _ => WINDOWS_1252,
            };
            let (encoded, _, had_errors) = encoder.encode(content);
            if had_errors { return Err("当前编码无法完整保存这些字符，请另存为 UTF-8 文件。".to_string()); }
            let result = encoded.into_owned();
            let (roundtrip, _) = decode_encoding(&result, encoding)?;
            if roundtrip != content { return Err("当前编码无法完整保存这些字符，请另存为 UTF-8 文件。".to_string()); }
            result
        }
        _ => return Err("不支持这个保存编码。".to_string()),
    };
    if bom {
        let prefix: &[u8] = match encoding {
            "utf-8" => &[0xEF, 0xBB, 0xBF],
            "utf-16le" => &[0xFF, 0xFE],
            "utf-16be" => &[0xFE, 0xFF],
            _ => &[],
        };
        if !prefix.is_empty() {
            let mut with_bom = prefix.to_vec();
            with_bom.append(&mut bytes);
            bytes = with_bom;
        }
    }
    Ok(bytes)
}

fn disk_revision(path: &Path) -> Result<Option<String>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("保存目标必须是普通文件。".to_string());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(Some(revision_of(&bytes)))
}

fn write_atomic(path: &Path, bytes: &[u8], expected_revision: Option<&str>) -> Result<String, String> {
    let before = disk_revision(path)?;
    if before.as_deref() != expected_revision {
        return Err(if before.is_none() {
            "原文件已被移动或删除，请另存为。".to_string()
        } else {
            "文件已被其他程序修改，请重新载入或另存为。".to_string()
        });
    }
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.permissions().readonly() {
            return Err("文件是只读的，请另存为。".to_string());
        }
    }
    let parent = path.parent().ok_or_else(|| "保存路径无效。".to_string())?;
    let name = path.file_name().ok_or_else(|| "保存路径无效。".to_string())?.to_string_lossy();
    let temporary = parent.join(format!(".{}.{}.tmp", name, Uuid::new_v4()));
    let result = (|| -> Result<String, String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        let current = disk_revision(path)?;
        if current.as_deref() != expected_revision {
            return Err("文件已被其他程序修改，请重新载入或另存为。".to_string());
        }
        replace_file(&temporary, path).map_err(|error| error.to_string())?;
        let written = revision_of(bytes);
        let after = disk_revision(path)?;
        if after.as_deref() != Some(written.as_str()) {
            return Err("保存后文件又被其他程序修改，请重新载入或另存为。".to_string());
        }
        Ok(written)
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn add_known_root(state: &WorkspaceState, root: &Path) -> Result<(), String> {
    state.known_roots.lock().map_err(|_| "目录状态不可用。".to_string())?.insert(root.to_path_buf());
    Ok(())
}

fn resolve_path(state: &WorkspaceState, id: &str, root: &str) -> Result<(PathBuf, PathBuf), String> {
    let root_path = PathBuf::from(root).canonicalize().map_err(|error| error.to_string())?;
    let known = state.known_roots.lock().map_err(|_| "目录状态不可用。".to_string())?;
    if !known.contains(&root_path) {
        return Err("请先打开这个文件夹。".to_string());
    }
    drop(known);
    let relative = Path::new(id);
    if relative.is_absolute() || relative.components().any(|component| matches!(component, std::path::Component::Prefix(_) | std::path::Component::RootDir)) {
        return Err("文件路径无效。".to_string());
    }
    let full_path = root_path.join(relative).canonicalize().map_err(|error| error.to_string())?;
    if !full_path.starts_with(&root_path) {
        return Err("只能打开当前文件夹内的文件。".to_string());
    }
    Ok((root_path, full_path))
}

fn list_directory(root: &Path, directory: &Path) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(directory).map_err(|error| error.to_string())?;
    for item in read_dir {
        let item = match item { Ok(item) => item, Err(_) => continue };
        let file_type = match item.file_type() { Ok(value) => value, Err(_) => continue };
        if file_type.is_symlink() { continue; }
        let path = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
        let id = relative.to_string_lossy().replace('\\', "/");
        if file_type.is_dir() {
            entries.push(DirectoryEntry { id, name, kind: "directory".to_string() });
        } else if file_type.is_file() {
            let mut file = match fs::File::open(&path) { Ok(file) => file, Err(_) => continue };
            let mut sample = vec![0u8; 8192];
            let count = match file.read(&mut sample) { Ok(count) => count, Err(_) => continue };
            sample.truncate(count);
            if decode_text(&sample).is_ok() {
                entries.push(DirectoryEntry { id, name, kind: "file".to_string() });
            }
        }
    }
    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir.cmp(&left_dir).then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn open_folder(state: &WorkspaceState, folder_path: &Path, activate: bool) -> Result<FolderInfo, String> {
    let root = folder_path.canonicalize().map_err(|error| error.to_string())?;
    if !root.is_dir() { return Err("请选择一个文件夹。".to_string()); }
    add_known_root(state, &root)?;
    if activate {
        *state.active_root.lock().map_err(|_| "目录状态不可用。".to_string())? = Some(root.clone());
    }
    let entries = list_directory(&root, &root)?;
    Ok(FolderInfo {
        name: root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path_string(&root)),
        path: path_string(&root),
        entries,
    })
}

fn read_absolute(
    state: &WorkspaceState,
    file_path: &Path,
    root_override: Option<&Path>,
    requested_encoding: Option<&str>,
) -> Result<FileInfo, String> {
    let full_path = file_path.canonicalize().map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&full_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() { return Err("请选择一个文本文件。".to_string()); }
    if metadata.len() > MAX_FILE_BYTES { return Err("此原型暂支持打开 20 MB 以内的文本文件。".to_string()); }
    let bytes = fs::read(&full_path).map_err(|error| error.to_string())?;
    let key = path_key(&full_path);
    let previous = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?.get(&key).cloned();
    let selected = requested_encoding.map(str::to_string).or_else(|| previous.as_ref().and_then(|item| item.selected_encoding.clone()));
    let (content, encoding, bom) = if let Some(selected) = selected.as_deref() {
        let (text, bom) = decode_encoding(&bytes, selected)?;
        (text, selected.to_string(), bom)
    } else {
        decode_text(&bytes)?
    };
    let root = match root_override {
        Some(root) => root.canonicalize().map_err(|error| error.to_string())?,
        None => full_path.parent().ok_or_else(|| "文件目录无效。".to_string())?.to_path_buf(),
    };
    let relative = full_path.strip_prefix(&root).unwrap_or(full_path.as_path());
    let name = full_path.file_name().map(|value| value.to_string_lossy().into_owned()).unwrap_or_default();
    let kind = if [".md", ".markdown", ".mdown", ".mkd"].contains(&full_path.extension().and_then(|value| value.to_str()).map(|value| format!(".{}", value.to_lowercase())).as_deref().unwrap_or("")) {
        "markdown"
    } else { "text" };
    let file = FileInfo {
        content,
        encoding: encoding.clone(),
        bom,
        revision: revision_of(&bytes),
        id: relative.to_string_lossy().replace('\\', "/"),
        path: path_string(&full_path),
        root: path_string(&root),
        directory: path_string(full_path.parent().unwrap_or(&root)),
        key: key.clone(),
        name,
        selected_encoding: selected,
        kind: kind.to_string(),
    };
    state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?.insert(key, OpenedFile {
        path: full_path,
        encoding,
        bom,
        root,
        selected_encoding: file.selected_encoding.clone(),
    });
    Ok(file)
}

fn folder_for_file(state: &WorkspaceState, key: &str, activate: bool) -> Result<FolderInfo, String> {
    let opened = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?
        .get(key).cloned().ok_or_else(|| "请先打开这个文件。".to_string())?;
    let parent = opened.path.parent().ok_or_else(|| "文件目录无效。".to_string())?.to_path_buf();
    let folder = open_folder(state, &parent, activate)?;
    if let Some(file) = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?.get_mut(key) {
        file.root = parent;
    }
    Ok(folder)
}

fn with_file_folder(state: &WorkspaceState, path: &Path) -> Result<OpenFileResult, String> {
    let file = read_absolute(state, path, None, None)?;
    let folder = folder_for_file(state, &file.key, false)?;
    Ok(OpenFileResult { file, folder })
}

fn create_folder_result(state: &WorkspaceState, path: &Path) -> Result<Value, String> {
    let folder = open_folder(state, path, true)?;
    Ok(json!({ "folder": folder }))
}

fn resolve_link(state: &WorkspaceState, request: &LinkRequest) -> Result<LinkInfo, String> {
    let raw = request.href.trim();
    if raw.is_empty() || raw.contains('\0') { return Err("链接地址无效。".to_string()); }
    if let Some(fragment) = raw.strip_prefix('#') {
        return Ok(LinkInfo { kind: "anchor".to_string(), target: raw.to_string(), fragment: fragment.to_string(), path: None });
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Ok(LinkInfo { kind: "external".to_string(), target: raw.to_string(), fragment: String::new(), path: None });
    }
    if raw.starts_with("file://") {
        let url = url::Url::parse(raw).map_err(|error| error.to_string())?;
        let path = url.to_file_path().map_err(|_| "本地链接路径无效。".to_string())?;
        return Ok(LinkInfo { kind: "local".to_string(), target: raw.to_string(), fragment: url.fragment().unwrap_or("").to_string(), path: Some(path) });
    }
    let (without_fragment, fragment) = raw.split_once('#').unwrap_or((raw, ""));
    let without_query = without_fragment.split('?').next().unwrap_or(without_fragment);
    let target_path = if Path::new(without_query).is_absolute() {
        PathBuf::from(without_query)
    } else {
        let from_path = request.from_key.as_ref().and_then(|key| {
            state.opened_files.lock().ok()?.get(key).map(|file| file.path.clone())
        });
        let base = from_path.as_ref().and_then(|path| path.parent().map(Path::to_path_buf))
            .or_else(|| state.active_root.lock().ok().and_then(|value| value.clone()))
            .ok_or_else(|| "请先打开本地文件或文件夹，以确定相对链接的位置。".to_string())?;
        base.join(without_query)
    };
    let normalized = target_path.canonicalize().unwrap_or(target_path);
    let fragment = percent_encoding::percent_decode_str(fragment).decode_utf8_lossy().into_owned();
    Ok(LinkInfo {
        kind: "local".to_string(),
        target: if fragment.is_empty() { path_string(&normalized) } else { format!("{}#{}", path_string(&normalized), fragment) },
        fragment,
        path: Some(normalized),
    })
}

#[tauri::command]
fn startup(app: AppHandle, state: State<'_, WorkspaceState>) -> Result<StartupResult, String> {
    let data_dir = app_data_dir(&app)?;
    let recovery_path = data_dir.join("drafts.json");
    let (drafts, recovery_error) = match fs::read_to_string(&recovery_path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(value) if value.get("version").and_then(Value::as_i64) == Some(1) && value.get("documents").and_then(Value::as_array).is_some() => {
                (value["documents"].as_array().cloned().unwrap_or_default(), String::new())
            }
            _ => (Vec::new(), "恢复草稿格式不正确，原草稿文件已保留。".to_string()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Vec::new(), String::new()),
        Err(error) => (Vec::new(), error.to_string()),
    };
    // 恢复草稿只作为文件登记线索：路径必须仍存在，且与原文件身份一致。
    // 这样恢复后的已命名文档才能继续走原文件保存和冲突检查。
    for draft in &drafts {
        let Some(file) = draft.get("file") else { continue };
        let (Some(path), Some(key), Some(encoding)) = (
            file.get("path").and_then(Value::as_str),
            file.get("key").and_then(Value::as_str),
            file.get("encoding").and_then(Value::as_str),
        ) else { continue };
        if !["utf-8", "utf-16le", "utf-16be", "ascii", "gbk", "gb18030", "big5", "windows-1252", "latin1"].contains(&encoding) {
            continue;
        }
        let Ok(canonical) = PathBuf::from(path).canonicalize() else { continue };
        if !canonical.is_file() || path_key(&canonical) != key { continue; }
        let parent = canonical.parent().unwrap_or(&canonical).to_path_buf();
        let root = file.get("root").and_then(Value::as_str)
            .and_then(|candidate| PathBuf::from(candidate).canonicalize().ok())
            .filter(|candidate| canonical.starts_with(candidate))
            .unwrap_or(parent);
        let selected_encoding = file.get("selectedEncoding").and_then(Value::as_str)
            .filter(|selected| ["utf-8", "utf-16le", "utf-16be", "ascii", "gbk", "gb18030", "big5", "windows-1252", "latin1"].contains(selected))
            .map(str::to_string);
        state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?
            .insert(key.to_string(), OpenedFile {
                path: canonical,
                encoding: encoding.to_string(),
                bom: file.get("bom").and_then(Value::as_bool).unwrap_or(false),
                root: root.clone(), selected_encoding,
            });
        add_known_root(&state, &root)?;
    }
    Ok(StartupResult { verify: false, drafts, recovery_error, preferences: read_preferences(&app)? })
}

#[tauri::command]
fn preferences(app: AppHandle, value: Value) -> Result<Value, String> {
    let normalized = normalize_preferences(&value);
    write_json_atomic(&app_data_dir(&app)?.join("preferences.json"), &normalized)?;
    Ok(normalized)
}

#[tauri::command]
async fn choose_folder(app: AppHandle, state: State<'_, WorkspaceState>) -> Result<Option<FolderInfo>, String> {
    let Some(selected) = app.dialog().file().set_title("打开文本文件所在的文件夹").blocking_pick_folder() else { return Ok(None); };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    open_folder(&state, &path, true).map(Some)
}

#[tauri::command]
async fn open_file(app: AppHandle, state: State<'_, WorkspaceState>) -> Result<Option<OpenFileResult>, String> {
    // 不按扩展名限制选择：无扩展名、日志和配置文件仍可读取，内容由后端验证。
    let selected = app.dialog().file().set_title("打开文本文件").blocking_pick_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    with_file_folder(&state, &path).map(Some)
}

#[tauri::command]
fn parent_folder(root: String, state: State<'_, WorkspaceState>) -> Result<FolderInfo, String> {
    let root_path = PathBuf::from(&root).canonicalize().map_err(|error| error.to_string())?;
    if !state.known_roots.lock().map_err(|_| "目录状态不可用。".to_string())?.contains(&root_path) {
        return Err("请先打开这个文件夹。".to_string());
    }
    let parent = root_path.parent().unwrap_or(&root_path);
    open_folder(&state, parent, true)
}

#[tauri::command]
fn active_folder(key: String, state: State<'_, WorkspaceState>) -> Result<FolderInfo, String> {
    folder_for_file(&state, &key, false)
}

#[tauri::command]
fn take_open_files(state: State<'_, WorkspaceState>) -> Vec<Value> {
    let mut results = Vec::new();
    for path in state.take_paths() {
        let result = if path.is_dir() {
            create_folder_result(&state, &path)
        } else {
            with_file_folder(&state, &path).map(|value| json!({ "file": value.file, "folder": value.folder }))
        };
        match result {
            Ok(value) => results.push(value),
            Err(error) => results.push(json!({ "error": format!("无法打开 {}：{}", path.file_name().unwrap_or_default().to_string_lossy(), error) })),
        }
    }
    results
}

#[tauri::command]
fn open_default_apps() -> Result<Value, String> {
    #[cfg(windows)]
    Command::new("cmd").args(["/C", "start", "", "ms-settings:defaultapps"]).spawn().map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn save_as(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    request: SaveAsRequest,
) -> Result<Option<FileInfo>, String> {
    // 保留原扩展名，避免代码、日志等文件另存时被系统对话框改写为 Markdown。
    let mut dialog = app.dialog().file().set_title("另存为").set_file_name(request.name.clone());
    if let Some(key) = request.key.as_ref() {
        if let Ok(opened) = state.opened_files.lock() {
            if let Some(file) = opened.get(key) {
                if let Some(parent) = file.path.parent() { dialog = dialog.set_directory(parent); }
            }
        }
    }
    let Some(selected) = dialog.blocking_save_file() else { return Ok(None); };
    let target = selected.into_path().map_err(|error| error.to_string())?;
    let parent = target.parent().ok_or_else(|| "保存路径无效。".to_string())?.canonicalize().map_err(|error| error.to_string())?;
    let target = parent.join(target.file_name().ok_or_else(|| "保存路径无效。".to_string())?);
    let key = path_key(&target);
    for open_key in &request.open_keys {
        if Some(open_key) != request.key.as_ref() && open_key == &key {
            return Err("目标文件已在其他标签页打开，请选择其他位置。".to_string());
        }
    }
    let expected = disk_revision(&target)?;
    let encoding = request.format.as_ref().map(|value| value.encoding.as_str()).unwrap_or("utf-8");
    let bom = request.format.as_ref().map(|value| value.bom).unwrap_or(false);
    let bytes = encode_text(&request.content, encoding, bom)?;
    write_atomic(&target, &bytes, expected.as_deref())?;
    add_known_root(&state, &parent)?;
    read_absolute(&state, &target, Some(&parent), Some(encoding)).map(Some)
}

#[tauri::command]
fn save(state: State<'_, WorkspaceState>, request: SaveRequest) -> Result<FileInfo, String> {
    let opened = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?
        .get(&request.key).cloned().ok_or_else(|| "请先打开这个文件。".to_string())?;
    let encoding = request.format.as_ref().map(|value| value.encoding.as_str()).unwrap_or(opened.encoding.as_str());
    let bom = request.format.as_ref().map(|value| value.bom).unwrap_or(opened.bom);
    let bytes = encode_text(&request.content, encoding, bom)?;
    write_atomic(&opened.path, &bytes, Some(&request.revision))?;
    read_absolute(&state, &opened.path, Some(&opened.root), Some(encoding))
}

#[tauri::command]
fn reload_encoding(state: State<'_, WorkspaceState>, request: ReloadEncodingRequest) -> Result<FileInfo, String> {
    let opened = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?
        .get(&request.key).cloned().ok_or_else(|| "请先打开这个文件。".to_string())?;
    read_absolute(&state, &opened.path, Some(&opened.root), Some(&request.encoding))
}

#[tauri::command]
fn inspect(state: State<'_, WorkspaceState>, key: String) -> Result<Value, String> {
    let opened = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?
        .get(&key).cloned().ok_or_else(|| "请先打开这个文件。".to_string())?;
    if !opened.path.exists() { return Ok(json!({ "missing": true })); }
    read_absolute(&state, &opened.path, Some(&opened.root), opened.selected_encoding.as_deref())
        .map(|file| json!(file))
}

#[tauri::command]
fn list(id: String, root: String, state: State<'_, WorkspaceState>) -> Result<Vec<DirectoryEntry>, String> {
    let (root_path, directory) = resolve_path(&state, &id, &root)?;
    list_directory(&root_path, &directory)
}

#[tauri::command]
fn read(id: String, root: String, state: State<'_, WorkspaceState>) -> Result<FileInfo, String> {
    let (root_path, full_path) = resolve_path(&state, &id, &root)?;
    read_absolute(&state, &full_path, Some(&root_path), None)
}

#[tauri::command]
fn create_markdown(request: CreateMarkdownRequest, state: State<'_, WorkspaceState>) -> Result<FileInfo, String> {
    if request.name.trim().is_empty() { return Err("请输入文件名。".to_string()); }
    let mut filename = request.name.trim().to_string();
    if filename.chars().any(|ch| "<>:\"/\\|?*".contains(ch) || (ch as u32) < 0x20)
        || filename.ends_with('.') || filename.ends_with(' ')
        || ["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"].iter().any(|reserved| filename.to_lowercase().starts_with(&format!("{}.", reserved)) || filename.to_lowercase() == *reserved) {
        return Err("文件名包含不支持的字符或保留名称。".to_string());
    }
    if !filename.to_lowercase().ends_with(".md") { filename.push_str(".md"); }
    let (root, directory) = resolve_path(&state, &request.directory_id, &request.root)?;
    if !directory.is_dir() { return Err("请选择一个文件夹。".to_string()); }
    let target = directory.join(filename);
    OpenOptions::new().write(true).create_new(true).open(&target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists { "同名文件已存在，请换一个文件名。".to_string() } else { error.to_string() }
    })?;
    read_absolute(&state, &target, Some(&root), None)
}

#[tauri::command]
fn entry_action(request: EntryActionRequest, state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let (_root, target) = resolve_path(&state, &request.id, &request.root)?;
    match request.action.as_str() {
        "copy-path" => {
            Clipboard::new().and_then(|mut clipboard| clipboard.set_text(path_string(&target)))
                .map_err(|error| error.to_string())?;
        }
        "reveal" => reveal_path(&target)?,
        _ => return Err("不支持这个文件操作。".to_string()),
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn file_action(request: FileActionRequest, state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let opened = state.opened_files.lock().map_err(|_| "文件状态不可用。".to_string())?
        .get(&request.key).cloned().ok_or_else(|| "请先打开这个文件。".to_string())?;
    match request.action.as_str() {
        "copy-path" => {
            Clipboard::new().and_then(|mut clipboard| clipboard.set_text(path_string(&opened.path)))
                .map_err(|error| error.to_string())?;
        }
        "reveal" => reveal_path(&opened.path)?,
        _ => return Err("不支持这个文件操作。".to_string()),
    }
    Ok(json!({ "ok": true }))
}

fn reveal_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn().map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    {
        open::that_detached(path.parent().unwrap_or(path)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn describe_link(request: LinkRequest, state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let link = resolve_link(&state, &request)?;
    Ok(json!({
        "type": link.kind,
        "target": link.target,
        "fragment": link.fragment,
        "path": link.path.map(|path| path_string(&path))
    }))
}

#[tauri::command]
fn activate_link(request: LinkRequest, state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let link = resolve_link(&state, &request)?;
    match link.kind.as_str() {
        "anchor" => Ok(json!({ "type": "anchor", "fragment": link.fragment, "target": link.target })),
        "external" => {
            open::that_detached(&link.target).map_err(|error| error.to_string())?;
            Ok(json!({ "type": "external", "target": link.target }))
        }
        "local" => {
            let path = link.path.ok_or_else(|| "本地链接路径无效。".to_string())?;
            if path.is_dir() {
                let folder = open_folder(&state, &path, true)?;
                Ok(json!({ "type": "folder", "folder": folder }))
            } else {
                let root = path.parent().ok_or_else(|| "文件目录无效。".to_string())?.to_path_buf();
                let file = read_absolute(&state, &path, Some(&root), None)?;
                Ok(json!({ "type": "file", "file": file, "fragment": link.fragment }))
            }
        }
        _ => Err("不支持这个链接类型。".to_string()),
    }
}

#[tauri::command]
fn write_recovery(app: AppHandle, documents: Vec<Value>) -> Result<Value, String> {
    let value = json!({ "version": 1, "documents": documents });
    write_json_atomic(&app_data_dir(&app)?.join("drafts.json"), &value)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn read_recovery(app: AppHandle) -> Result<Vec<Value>, String> {
    let path = app_data_dir(&app)?.join("drafts.json");
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let value: Value = serde_json::from_str(&text).map_err(|_| "恢复草稿格式不正确，原草稿文件已保留。".to_string())?;
    if value.get("version").and_then(Value::as_i64) != Some(1) {
        return Err("恢复草稿格式不正确，原草稿文件已保留。".to_string());
    }
    value.get("documents").and_then(Value::as_array).cloned()
        .ok_or_else(|| "恢复草稿格式不正确，原草稿文件已保留。".to_string())
}

#[tauri::command]
fn approve_close(window: WebviewWindow, state: State<'_, CloseState>) -> Result<Value, String> {
    state.approved.store(true, Ordering::SeqCst);
    window.close().map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true }))
}

fn initial_paths() -> Vec<PathBuf> {
    std::env::args_os().skip(1).filter_map(|argument| {
        let text = argument.to_string_lossy();
        if text.starts_with('-') || text.trim().is_empty() { None } else { Some(PathBuf::from(argument)) }
    }).collect()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = argv.into_iter().skip(1)
                .filter(|argument| !argument.starts_with('-'))
                .map(PathBuf::from)
                .collect::<Vec<_>>();
            app.state::<WorkspaceState>().queue_paths(paths);
            let _ = app.emit("application:files-pending", ());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(WorkspaceState::default())
        .manage(CloseState::default())
        .invoke_handler(tauri::generate_handler![
            startup, preferences, choose_folder, open_file, parent_folder, active_folder,
            take_open_files, open_default_apps, save_as, save, reload_encoding, inspect,
            list, read, create_markdown, entry_action, file_action, describe_link,
            activate_link, write_recovery, read_recovery, approve_close
        ])
        .setup(|app| {
            app.state::<WorkspaceState>().queue_paths(initial_paths());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let state = window.state::<CloseState>();
                if !state.approved.swap(false, Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("application:request-close", ());
                }
            }
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                window.state::<WorkspaceState>().queue_paths(paths.clone());
                let _ = window.emit("application:files-pending", ());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running SuperMarkdown Tauri POC");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_and_utf16_round_trip_with_bom() {
        let text = "中文 Markdown 😀\r\n";
        for (encoding, bom) in [("utf-8", true), ("utf-16le", true), ("utf-16be", true)] {
            let bytes = encode_text(text, encoding, bom).unwrap();
            let (decoded, decoded_bom) = decode_encoding(&bytes, encoding).unwrap();
            assert_eq!(decoded, text);
            assert!(decoded_bom);
        }
    }

    #[test]
    fn legacy_encodings_reject_lossy_writes() {
        let text = "中文";
        let bytes = encode_text(text, "gb18030", false).unwrap();
        assert_eq!(decode_encoding(&bytes, "gb18030").unwrap().0, text);
        assert!(encode_text(text, "ascii", false).is_err());
        assert!(encode_text(text, "latin1", false).is_err());
    }

    #[test]
    fn binary_files_are_not_detected_as_text() {
        assert!(decode_text(&[0x89, 0x50, 0x00, 0x4E, 0x47]).is_err());
        assert!(decode_text(b"%PDF-1.7").is_err());
    }

    #[test]
    fn utf16_bom_is_detected_before_binary_filter() {
        let bytes = encode_text("中文", "utf-16le", true).unwrap();
        let (text, encoding, bom) = decode_text(&bytes).unwrap();
        assert_eq!(text, "中文");
        assert_eq!(encoding, "utf-16le");
        assert!(bom);
    }

    #[test]
    fn directory_entry_serializes_as_type() {
        let entry = DirectoryEntry { id: "note.md".into(), name: "note.md".into(), kind: "file".into() };
        assert_eq!(serde_json::to_value(entry).unwrap()["type"], "file");
    }

    #[test]
    fn sha256_revision_is_stable() {
        assert_eq!(revision_of(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
