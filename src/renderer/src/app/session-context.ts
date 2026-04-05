import { createContext, useContext } from 'react'

export interface SessionContextValue {
  playerToken: string
  nickname: string
  ready: boolean
  setNickname: (nickname: string) => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('SessionProvider 내부에서 사용해야 합니다.')
  }

  return context
}
