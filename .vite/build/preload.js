"use strict";
const electron = require("electron");
var define_process_env_default = {};
const electronAPI = {
  ipcRenderer: {
    send(channel, ...args) {
      electron.ipcRenderer.send(channel, ...args);
    },
    sendTo(webContentsId, channel, ...args) {
      const electronVer = process.versions.electron;
      const electronMajorVer = electronVer ? parseInt(electronVer.split(".")[0]) : 0;
      if (electronMajorVer >= 28) {
        throw new Error('"sendTo" method has been removed since Electron 28.');
      } else {
        electron.ipcRenderer.sendTo(webContentsId, channel, ...args);
      }
    },
    sendSync(channel, ...args) {
      return electron.ipcRenderer.sendSync(channel, ...args);
    },
    sendToHost(channel, ...args) {
      electron.ipcRenderer.sendToHost(channel, ...args);
    },
    postMessage(channel, message, transfer) {
      electron.ipcRenderer.postMessage(channel, message, transfer);
    },
    invoke(channel, ...args) {
      return electron.ipcRenderer.invoke(channel, ...args);
    },
    on(channel, listener) {
      electron.ipcRenderer.on(channel, listener);
      return () => {
        electron.ipcRenderer.removeListener(channel, listener);
      };
    },
    once(channel, listener) {
      electron.ipcRenderer.once(channel, listener);
      return () => {
        electron.ipcRenderer.removeListener(channel, listener);
      };
    },
    removeListener(channel, listener) {
      electron.ipcRenderer.removeListener(channel, listener);
      return this;
    },
    removeAllListeners(channel) {
      electron.ipcRenderer.removeAllListeners(channel);
    }
  },
  webFrame: {
    insertCSS(css) {
      return electron.webFrame.insertCSS(css);
    },
    setZoomFactor(factor) {
      if (typeof factor === "number" && factor > 0) {
        electron.webFrame.setZoomFactor(factor);
      }
    },
    setZoomLevel(level) {
      if (typeof level === "number") {
        electron.webFrame.setZoomLevel(level);
      }
    }
  },
  webUtils: {
    getPathForFile(file) {
      return electron.webUtils.getPathForFile(file);
    }
  },
  process: {
    get platform() {
      return process.platform;
    },
    get versions() {
      return process.versions;
    },
    get env() {
      return { ...define_process_env_default };
    }
  }
};
const api = {
  openFolder: () => electron.ipcRenderer.invoke("dialog:openFolder"),
  readDirectory: (dirPath) => electron.ipcRenderer.invoke("fs:readDirectory", dirPath),
  readFile: (filePath) => electron.ipcRenderer.invoke("fs:readFile", filePath),
  saveFile: (defaultPath) => electron.ipcRenderer.invoke("dialog:saveFile", defaultPath),
  exportFile: (defaultName, ext, desc) => electron.ipcRenderer.invoke("dialog:exportFile", defaultName, ext, desc),
  openFile: () => electron.ipcRenderer.invoke("dialog:openFile"),
  writeFile: (filePath, data) => electron.ipcRenderer.invoke("fs:writeFile", filePath, data),
  getAudioPath: () => electron.ipcRenderer.invoke("app:getAudioPath"),
  getLibraryPath: () => electron.ipcRenderer.invoke("app:getLibraryPath"),
  installSoundPack: () => electron.ipcRenderer.invoke("app:installSoundPack"),
  getDefaultProjectsPath: () => electron.ipcRenderer.invoke("app:getDefaultProjectsPath"),
  mkdir: (dirPath) => electron.ipcRenderer.invoke("fs:mkdir", dirPath),
  exists: (filePath) => electron.ipcRenderer.invoke("fs:exists", filePath),
  onOpenFile: (callback) => electron.ipcRenderer.on("open-file", (_event, path) => callback(path))
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = electronAPI;
  window.api = api;
}
