const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;

if (!window.workspaceFiles && typeof invoke === "function") {
  const call = async (command, args = {}) => {
    try {
      return await invoke(command, args);
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  };

  window.workspaceFiles = {
    preferences: value => call("preferences", { value }),
    parentFolder: root => call("parent_folder", { root }),
    startup: () => call("startup"),
    activeFolder: key => call("active_folder", { key }),
    takeOpenFiles: () => call("take_open_files"),
    onFilesPending: callback => {
      if (typeof listen === "function") {
        listen("application:files-pending", callback).catch(error => {
          console.error("Tauri file-open listener failed:", error);
        });
      }
      queueMicrotask(callback);
    },
    openDefaultApps: () => call("open_default_apps"),
    openFile: () => call("open_file"),
    // Image files are always imported relative to an already opened Markdown file.
    // Never pass a caller-selected destination path to the Rust backend.
    chooseImageAndImport: documentKey => call("choose_image_and_import", { documentKey }),
    importImageBytes: request => call("import_image_bytes", { request }),
    readImageAsset: request => call("read_image_asset", { request }),
    importDroppedImages: request => call("import_dropped_images", { request }),
    discardDroppedImages: tokens => call("discard_dropped_images", { tokens }),
    // Native OS drag-and-drop is queued by the Rust window event handler.
    openDroppedFiles: async () => [],
    save: request => call("save", { request }),
    saveAs: request => call("save_as", { request }),
    reloadEncoding: request => call("reload_encoding", { request }),
    inspect: key => call("inspect", { key }),
    writeRecovery: documents => call("write_recovery", { documents }),
    readRecovery: () => call("read_recovery"),
    onCloseRequested: callback => {
      if (typeof listen === "function") {
        listen("application:request-close", callback).catch(error => {
          console.error("Tauri close listener failed:", error);
        });
      }
    },
    approveClose: () => call("approve_close"),
    testFiles: async () => ({ error: "测试专用接口仅在 Electron 验证环境中提供。" }),
    chooseFolder: () => call("choose_folder"),
    list: (id, root) => call("list", { id, root }),
    read: (id, root) => call("read", { id, root }),
    createMarkdown: request => call("create_markdown", { request }),
    entryAction: request => call("entry_action", { request }),
    describeLink: request => call("describe_link", { request }),
    activateLink: request => call("activate_link", { request }),
    fileAction: request => call("file_action", { request })
  };
}
