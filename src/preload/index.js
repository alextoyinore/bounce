import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  saveFile: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  getAudioPath: () => ipcRenderer.invoke('app:getAudioPath'),
  installSoundPack: () => ipcRenderer.invoke('app:installSoundPack'),
  getDefaultProjectsPath: () => ipcRenderer.invoke('app:getDefaultProjectsPath'),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, path) => callback(path))
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
