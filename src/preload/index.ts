import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  checkForUpdates: async (): Promise<void> => {
    await ipcRenderer.invoke('update:check')
  },
  installUpdateNow: async (): Promise<void> => {
    await ipcRenderer.invoke('update:install')
  },
  onUpdateStatus: (
    callback: (payload: { status: string; message: string; percent?: number }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { status: string; message: string; percent?: number }
    ): void => {
      callback(payload)
    }

    ipcRenderer.on('update:status', listener)

    return (): void => {
      ipcRenderer.removeListener('update:status', listener)
    }
  }
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
