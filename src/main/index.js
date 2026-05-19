import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import * as fs from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Required for @electron-forge/maker-squirrel on Windows
if (require('electron-squirrel-startup')) app.quit()

// Icon path — plain path.join replaces the ?asset Vite query (not supported in Forge)
const icon = join(__dirname, '../../resources/icon.png')

let mainWindow = null
let fileToOpen = null

// macOS: emitted when someone double clicks a file
app.on('open-file', (event, path) => {
  event.preventDefault()
  fileToOpen = path
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-file', path)
    fileToOpen = null
  }
})

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      // Find the file path from the command line arguments
      const path = commandLine.find(arg => arg.endsWith('.bounce'))
      if (path) {
        mainWindow.webContents.send('open-file', path)
      }
    }
  })

  // Windows/Linux initial launch file capture
  const initialPath = process.argv.find(arg => arg.endsWith('.bounce'))
  if (initialPath) {
    fileToOpen = initialPath
  }
}

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 650,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the Vite dev server URL in development (injected by @electron-forge/plugin-vite)
  // or the bundled index.html in production.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (fileToOpen) {
      mainWindow.webContents.send('open-file', fileToOpen)
      fileToOpen = null
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Create default Bounce folders (projects & library) inside Documents
  try {
    const docsPath = app.getPath('documents')
    const bounceProjectsPath = join(docsPath, 'Bounce', 'projects')
    const bounceLibraryPath = join(docsPath, 'Bounce', 'library')
    fs.mkdir(bounceProjectsPath, { recursive: true }).catch(err => console.error('Failed to create default projects path on start:', err))
    fs.mkdir(bounceLibraryPath, { recursive: true }).catch(err => console.error('Failed to create default library path on start:', err))
  } catch (err) {
    console.error('Failed to initialize default Bounce directories on startup:', err)
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Window controls
  ipcMain.on('window-minimize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.minimize()
  })
  
  ipcMain.on('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })
  
  ipcMain.on('window-close', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.close()
  })

  // File system and dialog handlers
  ipcMain.handle('dialog:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0]
    }
  })

  ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    try {
      console.log('[Main] Reading directory:', dirPath)
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const result = []
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)
        try {
          const stats = await fs.stat(fullPath)
          if (stats.isDirectory()) {
            result.push({ name: entry.name, path: fullPath, type: 'directory' })
          } else {
            const ext = extname(entry.name).toLowerCase()
            if (['.wav', '.mp3', '.ogg', '.flac'].includes(ext)) {
              result.push({ name: entry.name, path: fullPath, type: 'file' })
            }
          }
        } catch (e) {
          console.error(`[Main] Failed to stat ${fullPath}:`, e)
        }
      }
      console.log(`[Main] Found ${result.length} items in ${dirPath}`)
      return result
    } catch (error) {
      console.error('[Main] Failed to read directory:', dirPath, error)
      return []
    }
  })

  // These will be registered in app.whenReady()

  ipcMain.handle('dialog:saveFile', async (event, defaultPath) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Bounce Project',
      defaultPath: defaultPath || 'Untitled.bounce',
      filters: [{ name: 'Bounce Project', extensions: ['bounce'] }]
    })
    if (canceled || !filePath) return null
    return filePath
  })

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Open Bounce Project',
      filters: [{ name: 'Bounce Project', extensions: ['bounce'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return null
    return filePaths[0]
  })

  ipcMain.handle('fs:writeFile', async (event, filePath, data) => {
    try {
      if (typeof data === 'string') {
        await fs.writeFile(filePath, data, 'utf-8')
      } else {
        // data is a Buffer or Uint8Array
        await fs.writeFile(filePath, Buffer.from(data))
      }
      return true
    } catch (error) {
      console.error('Failed to write file:', error)
      return false
    }
  })

  ipcMain.handle('app:getDefaultProjectsPath', async () => {
    try {
      const docsPath = app.getPath('documents')
      const bounceProjectsPath = join(docsPath, 'Bounce', 'projects')
      await fs.mkdir(bounceProjectsPath, { recursive: true })
      // Create library directory inside Bounce folder
      const libraryPath = join(docsPath, 'Bounce', 'library')
      await fs.mkdir(libraryPath, { recursive: true })
      return bounceProjectsPath
    } catch (error) {
      console.error('Failed to get default projects path:', error)
      return app.getPath('userData')
    }
  })

  ipcMain.handle('app:getLibraryPath', async () => {
    try {
      const docsPath = app.getPath('documents')
      const libraryPath = join(docsPath, 'Bounce', 'library')
      await fs.mkdir(libraryPath, { recursive: true })
      return libraryPath
    } catch (error) {
      console.error('Failed to get library path:', error)
      return null
    }
  })

  ipcMain.handle('fs:mkdir', async (event, dirPath) => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
      return true
    } catch (error) {
      console.error('Failed to create directory:', error)
      return false
    }
  })

  ipcMain.handle('fs:exists', async (event, filePath) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // Register IPC handlers
  ipcMain.handle('app:getAudioPath', () => {
    if (is.dev) {
      return join(app.getAppPath(), 'src/renderer/public/audio')
    }
    return join(process.resourcesPath, 'audio')
  })

  ipcMain.handle('app:installSoundPack', async () => {
    console.log('[Main] Install sound pack requested')
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Sound Pack Folder to Install'
    })

    if (canceled || filePaths.length === 0) return null

    const srcPath = filePaths[0]
    const packName = srcPath.split(/[/\\]/).pop()
    
    const docsPath = app.getPath('documents')
    const targetBase = join(docsPath, 'Bounce', 'library')
    await fs.mkdir(targetBase, { recursive: true })
    
    const destPath = join(targetBase, packName)

    try {
      // Internal recursive copy function
      const recursiveCopy = async (s, d) => {
        await fs.mkdir(d, { recursive: true })
        const entries = await fs.readdir(s, { withFileTypes: true })
        for (const entry of entries) {
          const sp = join(s, entry.name), dp = join(d, entry.name)
          if (entry.isDirectory()) await recursiveCopy(sp, dp)
          else await fs.copyFile(sp, dp)
        }
      }
      await recursiveCopy(srcPath, destPath)
      return { success: true, name: packName }
    } catch (error) {
      console.error('Failed to install sound pack:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
      return await fs.readFile(filePath)
    } catch (error) {
      console.error('Failed to read file:', error)
      return null
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
