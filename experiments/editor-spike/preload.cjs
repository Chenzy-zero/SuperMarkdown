const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspaceFiles', {
  chooseFolder: () => ipcRenderer.invoke('workspace:choose-folder'),
  list: id => ipcRenderer.invoke('workspace:list', id),
  read: id => ipcRenderer.invoke('workspace:read', id),
  createMarkdown: request => ipcRenderer.invoke('workspace:create-markdown', request),
  entryAction: request => ipcRenderer.invoke('workspace:entry-action', request),
  describeLink: request => ipcRenderer.invoke('workspace:describe-link', request),
  activateLink: request => ipcRenderer.invoke('workspace:activate-link', request),
  fileAction: request => ipcRenderer.invoke('workspace:file-action', request),
});
