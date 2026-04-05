import { Navigate, Route, Routes } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { SessionProvider } from '@renderer/app/SessionProvider'
import { useSession } from '@renderer/app/session-context'
import { useAutoUpdate } from '@renderer/app/useAutoUpdate'
import { NicknameGate } from '@renderer/components/NicknameGate'
import { LobbyPage } from '@renderer/pages/LobbyPage'
import { RoomPage } from '@renderer/pages/RoomPage'
import { isSupabaseConfigured } from '@renderer/lib/supabase'

function AppRoutes(): React.JSX.Element {
  const { playerToken, nickname, ready, setNickname } = useSession()
  const updateState = useAutoUpdate()

  if (!ready) {
    return <div className="px-6 py-10 text-slate-300">세션을 준비하는 중...</div>
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto my-16 w-full max-w-2xl rounded-3xl border border-rose-300/30 bg-rose-500/10 p-8 text-rose-100">
        <h1 className="font-display text-3xl">Supabase 설정 필요</h1>
        <p className="mt-3 text-sm text-rose-100/90">
          `.env` 파일에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` 값을
          넣어주세요.
        </p>
      </div>
    )
  }

  if (!nickname.trim()) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <NicknameGate onSubmit={setNickname} />
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <LobbyPage
            playerToken={playerToken}
            nickname={nickname}
            onChangeNickname={setNickname}
            updateState={updateState}
          />
        }
      />
      <Route
        path="/room/:roomId"
        element={<RoomPage playerToken={playerToken} nickname={nickname} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <ToastContainer
        position="top-center"
        newestOnTop
        closeButton={false}
        toastClassName="app-toast"
        progressClassName="app-toast-progress"
      />
      <AppRoutes />
    </SessionProvider>
  )
}

export default App
