import { toast, type ToastOptions } from 'react-toastify'

const BASE_TOAST_OPTIONS: ToastOptions = {
  position: 'top-center',
  autoClose: 2600,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: false
}

function scopedToastId(scope: string, message: string): string {
  return `${scope}:${message}`
}

export function notifyError(message: string, scope = 'error'): void {
  toast.error(message, {
    ...BASE_TOAST_OPTIONS,
    toastId: scopedToastId(scope, message)
  })
}

export function notifySuccess(message: string, scope = 'success'): void {
  toast.success(message, {
    ...BASE_TOAST_OPTIONS,
    toastId: scopedToastId(scope, message)
  })
}

export function notifyInfo(message: string, scope = 'info'): void {
  toast.info(message, {
    ...BASE_TOAST_OPTIONS,
    toastId: scopedToastId(scope, message)
  })
}
