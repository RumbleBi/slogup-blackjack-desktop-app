import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { upsertProfile } from '@renderer/lib/api'
import { getPlayerToken, getStoredNickname, setStoredNickname } from '@renderer/lib/storage'
import { SessionContext } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [playerToken] = useState(() => getPlayerToken())
  const [nickname, setNicknameState] = useState(() => getStoredNickname())
  const [ready, setReady] = useState(false)

  const setNickname = useCallback(
    async (nextNickname: string) => {
      const safeNickname = nextNickname.trim()
      await upsertProfile(playerToken, safeNickname)
      setStoredNickname(safeNickname)
      setNicknameState(safeNickname)
    },
    [playerToken]
  )

  useEffect(() => {
    let mounted = true

    const bootstrap = async (): Promise<void> => {
      const existing = getStoredNickname().trim()
      if (!existing) {
        if (mounted) {
          setReady(true)
        }
        return
      }

      try {
        await upsertProfile(playerToken, existing)
      } finally {
        if (mounted) {
          setReady(true)
        }
      }
    }

    void bootstrap()

    return () => {
      mounted = false
    }
  }, [playerToken])

  const value = useMemo(
    () => ({
      playerToken,
      nickname,
      ready,
      setNickname
    }),
    [nickname, playerToken, ready, setNickname]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
