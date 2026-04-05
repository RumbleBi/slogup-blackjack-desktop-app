import { Navigate, Route, Routes } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { SessionProvider } from '@renderer/app/SessionProvider'
import { useSession } from '@renderer/app/session-context'
import { useAutoUpdate } from '@renderer/app/useAutoUpdate'
import { NicknameGate } from '@renderer/components/NicknameGate'
import { LobbyPage } from '@renderer/pages/LobbyPage'
import { RoomPage } from '@renderer/pages/RoomPage'
import { isSupabaseConfigured } from '@renderer/lib/supabase'
import slogupLogo from '../../../resources/icon.png'

function SessionSplash(): React.JSX.Element {
  return (
    <div className="flex min-h-screen w-full items-center justify-center">
      <div className="flex flex-col justify-center items-center gap-4">
        <img
          src={slogupLogo}
          alt="Slogup"
          className="mx-auto h-24 w-24 rounded-2xl border border-emerald-200/25 bg-black/25 p-2 shadow-[0_12px_36px_rgba(0,0,0,0.42)]"
        />
        <div className="inline-flex items-center px-4 py-2">
          <span className="size-6 animate-spin rounded-full border-4 border-emerald-300 border-t-transparent" />
        </div>
      </div>
    </div>
  )
}

function AppRoutes(): React.JSX.Element {
  const { playerToken, nickname, ready, setNickname } = useSession()
  const updateState = useAutoUpdate()

  if (!ready) {
    return <SessionSplash />
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
