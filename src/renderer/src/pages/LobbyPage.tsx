import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CreateRoomInput } from '@renderer/types/domain'
import {
  createRoom,
  fetchRooms,
  getReconnectCandidate,
  joinRoom,
  type ReconnectCandidate,
  type RoomListItem
} from '@renderer/lib/api'
import { formatCurrency } from '@renderer/lib/format'
import { notifyError, notifyInfo, notifySuccess } from '@renderer/lib/toast'
import { BlackjackRulesModal } from '@renderer/components/BlackjackRulesModal'
import { UpdateBanner } from '@renderer/components/UpdateBanner'
import type { UpdateState } from '@renderer/app/useAutoUpdate'

interface LobbyPageProps {
  playerToken: string
  nickname: string
  onChangeNickname: (nickname: string) => Promise<void>
  updateState: UpdateState
}

interface SystemNotice {
  title: string
  message: string
}

const ROOM_CLOSED_NOTICE_KEY = 'blackjack.roomClosedNotice'

const INITIAL_FORM: CreateRoomInput = {
  name: '',
  maxPlayers: 5,
  targetMoney: 500,
  startingMoney: 100,
  baseBet: 5
}

export function LobbyPage({
  playerToken,
  nickname,
  onChangeNickname,
  updateState
}: LobbyPageProps): React.JSX.Element {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RoomListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null)
  const [passwordModalRoom, setPasswordModalRoom] = useState<RoomListItem | null>(null)
  const [joinPassword, setJoinPassword] = useState('')
  const [reconnectCandidate, setReconnectCandidate] = useState<ReconnectCandidate | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [reconnectTick, setReconnectTick] = useState(Date.now())
  const [form, setForm] = useState<CreateRoomInput>(INITIAL_FORM)
  const [nicknameEdit, setNicknameEdit] = useState(nickname)
  const [nicknameSaving, setNicknameSaving] = useState(false)

  const roomCountLabel = useMemo(() => {
    if (rooms.length === 0) {
      return '열린 방이 없습니다'
    }

    return `현재 ${rooms.length}개 방이 열려 있습니다`
  }, [rooms.length])

  const loadRooms = async (): Promise<void> => {
    try {
      const nextRooms = await fetchRooms()
      setRooms(nextRooms)
    } catch (loadError) {
      notifyError(
        loadError instanceof Error ? loadError.message : '방 목록 조회에 실패했습니다.',
        'lobby-load'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRooms()
    const interval = window.setInterval(() => {
      void loadRooms()
    }, 2500)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const candidate = await getReconnectCandidate(playerToken)
        setReconnectCandidate(candidate && candidate.canReconnect ? candidate : null)
      } catch {
        // 재입장 체크 실패는 치명적이지 않아서 무시
      }
    })()
  }, [playerToken])

  useEffect(() => {
    const raw = window.sessionStorage.getItem(ROOM_CLOSED_NOTICE_KEY)
    if (!raw) {
      return
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SystemNotice>
      if (parsed.title && parsed.message) {
        notifyInfo(parsed.message, 'room-closed')
        setReconnectCandidate(null)
      }
    } catch {
      // ignore malformed data
    } finally {
      window.sessionStorage.removeItem(ROOM_CLOSED_NOTICE_KEY)
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReconnectTick(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    try {
      setCreating(true)

      const roomId = await createRoom(playerToken, nickname, form)
      await joinRoom(roomId, playerToken, nickname, form.password)
      navigate(`/room/${roomId}`)
    } catch (createError) {
      notifyError(
        createError instanceof Error ? createError.message : '방 생성에 실패했습니다.',
        'room-create'
      )
    } finally {
      setCreating(false)
    }
  }

  const performJoinRoom = async (room: RoomListItem, password = ''): Promise<boolean> => {
    try {
      setJoiningRoomId(room.id)
      await joinRoom(room.id, playerToken, nickname, password)
      navigate(`/room/${room.id}`)
      return true
    } catch (joinError) {
      notifyError(
        joinError instanceof Error ? joinError.message : '방 입장에 실패했습니다.',
        'room-join'
      )
      return false
    } finally {
      setJoiningRoomId(null)
    }
  }

  const handleJoinRoom = async (room: RoomListItem): Promise<void> => {
    if (room.password) {
      setPasswordModalRoom(room)
      setJoinPassword('')
      return
    }

    await performJoinRoom(room)
  }

  const handleJoinPasswordSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!passwordModalRoom) {
      return
    }

    const joined = await performJoinRoom(passwordModalRoom, joinPassword)
    if (joined) {
      setPasswordModalRoom(null)
      setJoinPassword('')
    }
  }

  const handleNicknameSave = async (): Promise<void> => {
    try {
      setNicknameSaving(true)
      await onChangeNickname(nicknameEdit)
      notifySuccess('닉네임이 변경되었습니다.', 'nickname-save')
    } catch (nicknameError) {
      notifyError(
        nicknameError instanceof Error ? nicknameError.message : '닉네임 변경 실패',
        'nickname-save'
      )
    } finally {
      setNicknameSaving(false)
    }
  }

  const reconnectRemainingSec = useMemo(() => {
    if (!reconnectCandidate) {
      return 0
    }

    const elapsedSec = Math.floor(
      (reconnectTick - new Date(reconnectCandidate.lastSeenAt).getTime()) / 1000
    )
    return Math.max(0, 30 - elapsedSec)
  }, [reconnectCandidate, reconnectTick])

  useEffect(() => {
    if (reconnectCandidate && reconnectRemainingSec <= 0) {
      setReconnectCandidate(null)
    }
  }, [reconnectCandidate, reconnectRemainingSec])

  const handleReconnectJoin = async (): Promise<void> => {
    if (!reconnectCandidate) {
      return
    }

    try {
      const latestCandidate = await getReconnectCandidate(playerToken)
      if (!latestCandidate?.canReconnect) {
        notifyInfo('재입장 가능 시간이 만료되었습니다.', 'reconnect-expired')
        setReconnectCandidate(null)
        return
      }

      setJoiningRoomId(reconnectCandidate.roomId)
      await joinRoom(reconnectCandidate.roomId, playerToken, nickname)
      navigate(`/room/${reconnectCandidate.roomId}`)
    } catch (joinError) {
      notifyError(
        joinError instanceof Error ? joinError.message : '재입장에 실패했습니다.',
        'reconnect-join'
      )
      setReconnectCandidate(null)
    } finally {
      setJoiningRoomId(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-10 pt-8 sm:px-8">
      <section className="mb-8 rounded-3xl border border-white/15 bg-[linear-gradient(120deg,rgba(11,28,20,0.92),rgba(12,20,27,0.86))] p-6 shadow-[0_25px_80px_rgba(0,0,0,0.45)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/90">
              In-house Blackjack
            </p>
            <h1 className="mt-3 font-display text-4xl text-slate-100">게임 로비</h1>
            <p className="mt-2 text-sm text-slate-300/80">{roomCountLabel}</p>
          </div>

          <div className="w-full max-w-sm rounded-2xl border border-emerald-200/20 bg-black/25 p-4">
            <label className="text-xs text-slate-300/80">닉네임 변경</label>
            <div className="mt-2 flex gap-2">
              <input
                value={nicknameEdit}
                onChange={(event) => setNicknameEdit(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300"
                minLength={2}
                maxLength={20}
              />
              <button
                type="button"
                disabled={nicknameSaving}
                onClick={() => void handleNicknameSave()}
                className="rounded-xl bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-70"
              >
                저장
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">현재 닉네임: {nickname}</p>
          </div>
        </div>
        <div className="mt-5">
          <UpdateBanner state={updateState} />
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="mt-3 rounded-xl border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-300/10"
          >
            게임 룰 보기
          </button>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <article className="rounded-3xl border border-white/10 bg-black/30 p-5 backdrop-blur-sm">
          <h2 className="font-display text-2xl text-slate-100">방 생성</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleCreateRoom}>
            <label className="grid gap-1 text-sm text-slate-200">
              방 이름
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-300"
                required
                minLength={2}
                maxLength={30}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-200">
              방 비밀번호 (선택)
              <input
                value={form.password ?? ''}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    password: event.target.value.trim().length > 0 ? event.target.value : undefined
                  }))
                }
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-300"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-200">
                최대 인원 (1~5)
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.maxPlayers}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, maxPlayers: Number(event.target.value || 1) }))
                  }
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-300"
                />
              </label>
              <label className="grid gap-1 text-sm text-slate-200">
                우승 금액 N$
                <input
                  type="number"
                  min={10}
                  value={form.targetMoney}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, targetMoney: Number(event.target.value || 10) }))
                  }
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-300"
                />
              </label>
              <label className="grid gap-1 text-sm text-slate-200">
                시작 자금 (10~1000)
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={form.startingMoney}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      startingMoney: Number(event.target.value || 10)
                    }))
                  }
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-300"
                />
              </label>
              <label className="grid gap-1 text-sm text-slate-200">
                기본 베팅 (1~100)
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.baseBet}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, baseBet: Number(event.target.value || 1) }))
                  }
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-emerald-300"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="mt-2 rounded-2xl bg-emerald-300 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-70"
            >
              {creating ? '생성 중...' : '게임 생성하기'}
            </button>
          </form>
        </article>

        <article className="rounded-3xl border border-white/10 bg-black/25 p-5">
          <h2 className="font-display text-2xl text-slate-100">개설된 방</h2>
          {loading ? <p className="mt-4 text-sm text-slate-400">불러오는 중...</p> : null}
          <div className="mt-4 grid gap-3">
            {rooms.map((room) => (
              <div key={room.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-100">{room.name}</h3>
                    <p className="text-xs text-slate-400">
                      인원 {room.player_count}/{room.max_players} · 시작자금{' '}
                      {formatCurrency(room.starting_money)} · 기본베팅{' '}
                      {formatCurrency(room.base_bet)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      목표 금액: {formatCurrency(room.target_money)}
                    </p>
                  </div>
                  {room.password ? (
                    <span className="rounded-full border border-amber-200/40 px-2 py-1 text-xs text-amber-100">
                      비밀방
                    </span>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={
                    joiningRoomId === room.id ||
                    room.player_count >= room.max_players ||
                    room.status === 'finished'
                  }
                  onClick={() => void handleJoinRoom(room)}
                  className="mt-3 rounded-xl border border-emerald-300/40 px-3 py-2 text-sm text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {joiningRoomId === room.id ? '입장 중...' : '입장하기'}
                </button>
              </div>
            ))}

            {!loading && rooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/20 p-5 text-sm text-slate-400">
                아직 생성된 방이 없습니다. 첫 방을 만들어 주세요.
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {passwordModalRoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[rgba(11,20,18,0.98)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
            <h3 className="font-display text-2xl text-slate-100">비밀번호 입력</h3>
            <p className="mt-2 text-sm text-slate-300/90">
              `{passwordModalRoom.name}` 방에 입장하려면 비밀번호가 필요합니다.
            </p>
            <form className="mt-4 grid gap-3" onSubmit={handleJoinPasswordSubmit}>
              <input
                type="password"
                value={joinPassword}
                onChange={(event) => setJoinPassword(event.target.value)}
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-slate-100 outline-none focus:border-emerald-300"
                placeholder="방 비밀번호"
                autoFocus
                required
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={joiningRoomId === passwordModalRoom.id}
                  className="rounded-xl bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-70"
                >
                  {joiningRoomId === passwordModalRoom.id ? '입장 중...' : '입장'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasswordModalRoom(null)
                    setJoinPassword('')
                  }}
                  className="rounded-xl border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {reconnectCandidate ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[rgba(11,20,18,0.98)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
            <h3 className="font-display text-2xl text-slate-100">재입장 확인</h3>
            <p className="mt-2 text-sm text-slate-300">
              이전에 참가 중이던 방 `{reconnectCandidate.roomName}` 에 다시 참가하시겠습니까?
            </p>
            <p className="mt-2 text-xs text-slate-400">
              현재 상태: {reconnectCandidate.roomStatus} · 재입장 가능 남은 시간:{' '}
              {reconnectRemainingSec}초
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => void handleReconnectJoin()}
                disabled={joiningRoomId === reconnectCandidate.roomId}
                className="rounded-xl bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
              >
                {joiningRoomId === reconnectCandidate.roomId ? '재입장 중...' : '참가'}
              </button>
              <button
                type="button"
                onClick={() => setReconnectCandidate(null)}
                className="rounded-xl border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <BlackjackRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </main>
  )
}
