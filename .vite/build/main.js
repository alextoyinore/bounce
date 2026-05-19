"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs/promises");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const is = {
  dev: !electron.app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      electron.app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return electron.app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      electron.app.setLoginItemSettings({ openAtLogin: auto });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return electron.session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "KeyI" && (input.alt && input.meta || input.control && input.shift)) {
            event.preventDefault();
          }
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    electron.ipcMain.on("win:invoke", (event, action) => {
      const win = electron.BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
if (require("electron-squirrel-startup")) electron.app.quit();
const icon = path.join(__dirname, "../../resources/icon.png");
let mainWindow = null;
let fileToOpen = null;
electron.app.on("open-file", (event, path2) => {
  event.preventDefault();
  fileToOpen = path2;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("open-file", path2);
    fileToOpen = null;
  }
});
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const path2 = commandLine.find((arg) => arg.endsWith(".bounce"));
      if (path2) {
        mainWindow.webContents.send("open-file", path2);
      }
    }
  });
  const initialPath = process.argv.find((arg) => arg.endsWith(".bounce"));
  if (initialPath) {
    fileToOpen = initialPath;
  }
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1150,
    height: 650,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  {
    mainWindow.loadURL("http://localhost:5173");
  }
  mainWindow.webContents.on("did-finish-load", () => {
    if (fileToOpen) {
      mainWindow.webContents.send("open-file", fileToOpen);
      fileToOpen = null;
    }
  });
}
electron.app.whenReady().then(() => {
  try {
    const docsPath = electron.app.getPath("documents");
    const bounceProjectsPath = path.join(docsPath, "Bounce", "projects");
    const bounceLibraryPath = path.join(docsPath, "Bounce", "library");
    fs__namespace.mkdir(bounceProjectsPath, { recursive: true }).catch((err) => console.error("Failed to create default projects path on start:", err));
    fs__namespace.mkdir(bounceLibraryPath, { recursive: true }).catch((err) => console.error("Failed to create default library path on start:", err));
  } catch (err) {
    console.error("Failed to initialize default Bounce directories on startup:", err);
  }
  electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  electron.ipcMain.on("window-minimize", () => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });
  electron.ipcMain.on("window-maximize", () => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
  electron.ipcMain.on("window-close", () => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (win) win.close();
  });
  electron.ipcMain.handle("dialog:openFolder", async () => {
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });
  electron.ipcMain.handle("fs:readDirectory", async (event, dirPath) => {
    try {
      console.log("[Main] Reading directory:", dirPath);
      const entries = await fs__namespace.readdir(dirPath, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const stats = await fs__namespace.stat(fullPath);
          if (stats.isDirectory()) {
            result.push({ name: entry.name, path: fullPath, type: "directory" });
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if ([".wav", ".mp3", ".ogg", ".flac"].includes(ext)) {
              result.push({ name: entry.name, path: fullPath, type: "file" });
            }
          }
        } catch (e) {
          console.error(`[Main] Failed to stat ${fullPath}:`, e);
        }
      }
      console.log(`[Main] Found ${result.length} items in ${dirPath}`);
      return result;
    } catch (error) {
      console.error("[Main] Failed to read directory:", dirPath, error);
      return [];
    }
  });
  electron.ipcMain.handle("dialog:saveFile", async (event, defaultPath) => {
    const { canceled, filePath } = await electron.dialog.showSaveDialog({
      title: "Save Bounce Project",
      defaultPath: defaultPath || "Untitled.bounce",
      filters: [{ name: "Bounce Project", extensions: ["bounce"] }]
    });
    if (canceled || !filePath) return null;
    return filePath;
  });
  electron.ipcMain.handle("dialog:openFile", async () => {
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({
      title: "Open Bounce Project",
      filters: [{ name: "Bounce Project", extensions: ["bounce"] }],
      properties: ["openFile"]
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });
  electron.ipcMain.handle("fs:writeFile", async (event, filePath, data) => {
    try {
      if (typeof data === "string") {
        await fs__namespace.writeFile(filePath, data, "utf-8");
      } else {
        await fs__namespace.writeFile(filePath, Buffer.from(data));
      }
      return true;
    } catch (error) {
      console.error("Failed to write file:", error);
      return false;
    }
  });
  electron.ipcMain.handle("app:getDefaultProjectsPath", async () => {
    try {
      const docsPath = electron.app.getPath("documents");
      const bounceProjectsPath = path.join(docsPath, "Bounce", "projects");
      await fs__namespace.mkdir(bounceProjectsPath, { recursive: true });
      const libraryPath = path.join(docsPath, "Bounce", "library");
      await fs__namespace.mkdir(libraryPath, { recursive: true });
      return bounceProjectsPath;
    } catch (error) {
      console.error("Failed to get default projects path:", error);
      return electron.app.getPath("userData");
    }
  });
  electron.ipcMain.handle("app:getLibraryPath", async () => {
    try {
      const docsPath = electron.app.getPath("documents");
      const libraryPath = path.join(docsPath, "Bounce", "library");
      await fs__namespace.mkdir(libraryPath, { recursive: true });
      return libraryPath;
    } catch (error) {
      console.error("Failed to get library path:", error);
      return null;
    }
  });
  electron.ipcMain.handle("fs:mkdir", async (event, dirPath) => {
    try {
      await fs__namespace.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error("Failed to create directory:", error);
      return false;
    }
  });
  electron.ipcMain.handle("fs:exists", async (event, filePath) => {
    try {
      await fs__namespace.access(filePath);
      return true;
    } catch {
      return false;
    }
  });
  electron.ipcMain.handle("app:getAudioPath", () => {
    if (is.dev) {
      return path.join(electron.app.getAppPath(), "src/renderer/public/audio");
    }
    return path.join(process.resourcesPath, "audio");
  });
  electron.ipcMain.handle("app:installSoundPack", async () => {
    console.log("[Main] Install sound pack requested");
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Sound Pack Folder to Install"
    });
    if (canceled || filePaths.length === 0) return null;
    const srcPath = filePaths[0];
    const packName = srcPath.split(/[/\\]/).pop();
    const docsPath = electron.app.getPath("documents");
    const targetBase = path.join(docsPath, "Bounce", "library");
    await fs__namespace.mkdir(targetBase, { recursive: true });
    const destPath = path.join(targetBase, packName);
    try {
      const recursiveCopy = async (s, d) => {
        await fs__namespace.mkdir(d, { recursive: true });
        const entries = await fs__namespace.readdir(s, { withFileTypes: true });
        for (const entry of entries) {
          const sp = path.join(s, entry.name), dp = path.join(d, entry.name);
          if (entry.isDirectory()) await recursiveCopy(sp, dp);
          else await fs__namespace.copyFile(sp, dp);
        }
      };
      await recursiveCopy(srcPath, destPath);
      return { success: true, name: packName };
    } catch (error) {
      console.error("Failed to install sound pack:", error);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("fs:readFile", async (event, filePath) => {
    try {
      return await fs__namespace.readFile(filePath);
    } catch (error) {
      console.error("Failed to read file:", error);
      return null;
    }
  });
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
