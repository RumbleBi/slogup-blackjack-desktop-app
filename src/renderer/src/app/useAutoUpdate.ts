import { useEffect, useState } from 'react'

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error'
  message: string
  percent?: number
}

const INITIAL: UpdateState = {
  status: 'idle',
  message: '업데이트 확인 대기 중'
}

export function useAutoUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>(INITIAL)

  useEffect(() => {
    const unsubscribe = window.api.onUpdateStatus((next) => {
      setState(next)
    })

    void window.api.checkForUpdates()

    return () => {
      unsubscribe()
    }
  }, [])

  return state
}
