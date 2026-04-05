import { ElectronAPI } from '@electron-toolkit/preload'

interface UpdateStatusPayload {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error'
  message: string
  percent?: number
}

interface AppBridgeApi {
  checkForUpdates: () => Promise<void>
  installUpdateNow: () => Promise<void>
  onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppBridgeApi
  }
}
