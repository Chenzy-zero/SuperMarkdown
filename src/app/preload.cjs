const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspaceFiles', {
  startup: () => ipcRenderer.invoke('application:startup'),
  openFile: () => ipcRenderer.invoke('workspace:open-file'),
  save: request => ipcRenderer.invoke('workspace:save', request),
  saveAs: request => ipcRenderer.invoke('workspace:save-as', request),
  inspect: key => ipcRenderer.invoke('workspace:inspect', key),
  writeRecovery: documents => ipcRenderer.invoke('recovery:write', documents),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  onCloseRequested: callback => ipcRenderer.on('application:request-close', () => callback()),
  approveClose: () => ipcRenderer.invoke('application:close-approved'),
  testFiles: request => ipcRenderer.invoke('testing:files', request),
  chooseFolder: () => ipcRenderer.invoke('workspace:choose-folder'),
  list: id => ipcRenderer.invoke('workspace:list', id),
  read: id => ipcRenderer.invoke('workspace:read', id),
  createMarkdown: request => ipcRenderer.invoke('workspace:create-markdown', request),
  entryAction: request => ipcRenderer.invoke('workspace:entry-action', request),
  describeLink: request => ipcRenderer.invoke('workspace:describe-link', request),
  activateLink: request => ipcRenderer.invoke('workspace:activate-link', request),
  fileAction: request => ipcRenderer.invoke('workspace:file-action', request),
});
