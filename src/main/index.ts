import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

function sendUpdateStatus(payload: { status: string; message: string; percent?: number }): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('update:status', payload)
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ status: 'checking', message: '업데이트를 확인 중입니다.' })
  })

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      status: 'available',
      message: `업데이트 발견: v${info.version}. 다운로드를 시작합니다.`
    })
  })

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ status: 'none', message: '현재 최신 버전입니다.' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      status: 'downloading',
      message: '업데이트 다운로드 중',
      percent: progress.percent
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      status: 'downloaded',
      message: `v${info.version} 업데이트가 준비되었습니다. 재시작하면 설치됩니다.`
    })
  })

  autoUpdater.on('error', (error) => {
    sendUpdateStatus({
      status: 'error',
      message: `업데이트 실패: ${error.message}`
    })
  })
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
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
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      sendUpdateStatus({
        status: 'none',
        message: '개발 모드에서는 자동 업데이트를 확인하지 않습니다.'
      })
      return
    }

    await autoUpdater.checkForUpdates()
  })
  ipcMain.handle('update:install', async () => {
    if (!app.isPackaged) {
      return
    }

    autoUpdater.quitAndInstall()
  })

  setupAutoUpdater()
  createWindow()

  if (app.isPackaged) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates()
    }, 2500)
  } else {
    sendUpdateStatus({
      status: 'none',
      message: '개발 모드입니다. 자동 업데이트는 패키징 후 동작합니다.'
    })
  }

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
