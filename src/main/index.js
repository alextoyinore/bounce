import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import * as fs from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import squirrelStartup from 'electron-squirrel-startup'

// ── Crash cymbal WAV synthesis ──────────────────────────────────────────────
// Generates a 2-second, 44100 Hz, 16-bit mono crash cymbal WAV in memory.
function buildCrashWavBuffer() {
  const RATE = 44100, DURATION = 2.0
  const N = Math.round(RATE * DURATION)
  const attack = Math.round(0.003 * RATE)
  const partials = [
    [1200, 0.08], [3100, 0.12], [4700, 0.18], [5800, 0.22],
    [7300, 0.20], [9100, 0.16], [11400, 0.12], [14000, 0.08]
  ]
  const phases = partials.map(() => 0)
  const floats = new Float32Array(N)
  let peak = 0
  for (let i = 0; i < N; i++) {
    const env = i < attack
      ? i / attack
      : Math.exp(-5.5 * (i - attack) / (N - attack))
    let s = (Math.random() * 2 - 1) * 0.55
    for (let p = 0; p < partials.length; p++) {
      phases[p] += (2 * Math.PI * partials[p][0]) / RATE
      s += Math.sin(phases[p]) * partials[p][1]
    }
    floats[i] = s * env
    if (Math.abs(floats[i]) > peak) peak = Math.abs(floats[i])
  }
  const scale = peak > 0.98 ? 0.98 / peak : 1
  const pcm = Buffer.alloc(N * 2)
  for (let i = 0; i < N; i++) {
    const v = Math.max(-1, Math.min(1, floats[i] * scale))
    const s = Math.round(v < 0 ? v * 0x8000 : v * 0x7fff)
    pcm[i * 2] = s & 0xff
    pcm[i * 2 + 1] = (s >> 8) & 0xff
  }
  const h = Buffer.alloc(44)
  const w32 = (o, v) => { h[o]=v&0xff; h[o+1]=(v>>8)&0xff; h[o+2]=(v>>16)&0xff; h[o+3]=(v>>24)&0xff }
  const w16 = (o, v) => { h[o]=v&0xff; h[o+1]=(v>>8)&0xff }
  h.write('RIFF',0); w32(4, 36+N*2); h.write('WAVE',8)
  h.write('fmt ',12); w32(16,16); w16(20,1); w16(22,1)
  w32(24,RATE); w32(28,RATE*2); w16(32,2); w16(34,16)
  h.write('data',36); w32(40,N*2)
  return Buffer.concat([h, pcm])
}

async function _isDrumKitFolder(dirPath) {
  try {
    const files = await fs.readdir(dirPath)
    const sigs = ['kick', 'snare', 'hihat', 'hi-hat', 'hat', 'clap', 'tom']
    return files.some(f => sigs.some(s => f.toLowerCase().includes(s)))
  } catch { return false }
}

async function _writeCrashIfMissing(dirPath, buf) {
  if (!await _isDrumKitFolder(dirPath)) return
  const crashPath = join(dirPath, 'crash.wav')
  try {
    const stat = await fs.stat(crashPath)
    if (stat.size > 100) return // already valid
  } catch { /* file missing */ }
  await fs.writeFile(crashPath, buf)
  console.log(`[Main] Generated crash.wav → ${crashPath}`)
}

async function ensureCrashSamples(libraryPath) {
  try {
    const crashBuf = buildCrashWavBuffer()
    const packs = await fs.readdir(libraryPath, { withFileTypes: true })
    for (const pack of packs) {
      if (!pack.isDirectory()) continue
      const packPath = join(libraryPath, pack.name)
      await _writeCrashIfMissing(packPath, crashBuf)
      try {
        const subs = await fs.readdir(packPath, { withFileTypes: true })
        for (const sub of subs) {
          if (!sub.isDirectory()) continue
          await _writeCrashIfMissing(join(packPath, sub.name), crashBuf)
        }
      } catch { /* skip unreadable subdirs */ }
    }
  } catch { /* library may not exist yet */ }
}

// Required for @electron-forge/maker-squirrel on Windows
if (squirrelStartup) app.quit()

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
    width: 1250,
    height: 720,
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
    fs.mkdir(bounceLibraryPath, { recursive: true })
      .then(() => ensureCrashSamples(bounceLibraryPath))
      .catch(err => console.error('Failed to create default library path on start:', err))
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

  ipcMain.handle('dialog:exportFile', async (event, defaultName, ext, desc) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Audio Mixdown',
      defaultPath: defaultName || ('Mixdown.' + ext),
      filters: [{ name: desc, extensions: [ext] }]
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
    return join(app.getAppPath(), '.vite/renderer/main_window/audio')
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
      await ensureCrashSamples(destPath)
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
