import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  actInCurrentRound,
  enforceTurnTimeout,
  evaluateDisconnects,
  getRoomSnapshot,
  leaveRoom,
  sendRoomMessage,
  setReady,
  startNewRound,
  touchHeartbeat,
  type RoomSnapshot
} from '@renderer/lib/api'
import { formatCard, formatCurrency } from '@renderer/lib/format'
import { notifyError } from '@renderer/lib/toast'
import { BlackjackRulesModal } from '@renderer/components/BlackjackRulesModal'
import type { Card, GameLog, PlayerOutcome } from '@renderer/types/domain'

interface RoomPageProps {
  playerToken: string
  nickname: string
}

const ROOM_CLOSED_NOTICE_KEY = 'blackjack.roomClosedNotice'

type RoundResultEntry = PlayerOutcome

interface RoundResultModalState {
  roundNo: number | string
  dealerHand: Card[]
  dealerValue: number | null
  dealerBust: boolean | null
  outcomes: RoundResultEntry[]
}

interface LeaderboardEntry {
  rank: number
  playerToken: string
  nickname: string
  balance: number
}

function handValueLabel(cards: { rank: string }[]): string {
  const values = cards.map((card) => {
    if (card.rank === 'A') return 11
    if (['K', 'Q', 'J'].includes(card.rank)) return 10
    return Number(card.rank)
  })

  let total = values.reduce((sum, value) => sum + value, 0)
  let aces = cards.filter((card) => card.rank === 'A').length

  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }

  return String(total)
}

function isRedSuit(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds'
}

function cardToneClass(card: Card): string {
  if (isRedSuit(card)) {
    return 'border-red-400 bg-rose-50 text-red-700'
  }

  return 'border-slate-900 bg-slate-100 text-slate-900'
}

function ordinal(rank: number): string {
  const mod100 = rank % 100
  if (mod100 >= 11 && mod100 <= 13) {
    return `${rank}th`
  }

  const mod10 = rank % 10
  if (mod10 === 1) return `${rank}st`
  if (mod10 === 2) return `${rank}nd`
  if (mod10 === 3) return `${rank}rd`
  return `${rank}th`
}

function rankTone(rank: number): string {
  if (rank === 1) return 'border-amber-300/55 bg-amber-300/15 text-amber-100'
  if (rank === 2) return 'border-slate-300/55 bg-slate-300/15 text-slate-100'
  if (rank === 3) return 'border-orange-300/55 bg-orange-300/15 text-orange-100'
  return 'border-white/20 bg-black/25 text-slate-200'
}

function handSummary(entry: RoundResultEntry): string {
  const hand = Array.isArray(entry.hand) ? entry.hand : []
  if (hand.length === 0) {
    return '카드 정보 없음'
  }

  const cards = hand.map((card) => formatCard(card)).join(' ')
  const computedTotal = Number(handValueLabel(hand))
  const total = Number.isFinite(entry.handTotal) ? entry.handTotal : computedTotal
  const bust = typeof entry.handBust === 'boolean' ? entry.handBust : total > 21

  return `${cards} · 합계 ${total}${bust ? ' (BUST)' : ''}`
}

function formatLog(log: GameLog): { title: string; detail: string } {
  const payload = (log.payload ?? {}) as Record<string, unknown>

  if (log.event_type === 'round_started') {
    return {
      title: `라운드 #${log.round_no ?? '-'} 시작`,
      detail: `기본 베팅 ${String(payload.baseBet ?? '-')}$`
    }
  }

  if (log.event_type === 'player_action') {
    const action = String(payload.action ?? '-')
    return {
      title: `플레이어 액션`,
      detail: `행동: ${action.toUpperCase()} · 라운드 #${log.round_no ?? '-'}`
    }
  }

  if (log.event_type === 'round_completed') {
    const outcomes = (
      payload.outcome as { outcomes?: Array<{ nickname: string; result: string; delta: number }> }
    )?.outcomes
    const summary =
      outcomes && outcomes.length > 0
        ? outcomes
            .map(
              (outcome) =>
                `${outcome.nickname} ${outcome.result} (${outcome.delta >= 0 ? '+' : ''}${outcome.delta}$)`
            )
            .join(' | ')
        : '결과 데이터 없음'

    return {
      title: `라운드 #${log.round_no ?? '-'} 결과`,
      detail: summary
    }
  }

  if (log.event_type === 'players_disconnected') {
    return {
      title: '연결 끊김 처리',
      detail: '30초 유예 초과 플레이어 자동 패배'
    }
  }

  if (log.event_type === 'room_finished') {
    const winnerLabel = String(payload.winnerNickname ?? payload.winnerToken ?? '없음')
    return {
      title: '게임 종료',
      detail: `우승자: ${winnerLabel}`
    }
  }

  if (log.event_type === 'player_joined') {
    return {
      title: '플레이어 입장',
      detail: `${String(payload.nickname ?? '-')}`
    }
  }

  if (log.event_type === 'player_eliminated') {
    return {
      title: '플레이어 탈락',
      detail: `${String(payload.nickname ?? payload.playerToken ?? '-')} · 사유: ${String(
        payload.reason ?? '-'
      )}`
    }
  }

  if (log.event_type === 'match_finished') {
    const winnerLabel = String(payload.winnerNickname ?? payload.winnerToken ?? '없음')
    return {
      title: '매치 종료',
      detail: `우승자: ${winnerLabel}`
    }
  }

  if (log.event_type === 'room_created') {
    return {
      title: '방 생성',
      detail: `${String(payload.roomName ?? '-')}`
    }
  }

  return {
    title: log.event_type,
    detail: `라운드 #${log.round_no ?? '-'} · ${new Date(log.created_at).toLocaleTimeString()}`
  }
}

export function RoomPage({ playerToken, nickname }: RoomPageProps): React.JSX.Element {
  const { roomId } = useParams()
  const navigate = useNavigate()

  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [sending, setSending] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [winnerCelebrationOpen, setWinnerCelebrationOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [turnTick, setTurnTick] = useState(Date.now())
  const [roundResultModal, setRoundResultModal] = useState<RoundResultModalState | null>(null)
  const autoStartedRoundRef = useRef<number | null>(null)
  const shownRoundResultLogIdsRef = useRef<Set<number>>(new Set())
  const shownMatchFinishedLogIdRef = useRef<number | null>(null)

  const loadSnapshot = useCallback(async (): Promise<void> => {
    if (!roomId) {
      return
    }

    try {
      const next = await getRoomSnapshot(roomId)
      setSnapshot(next)
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message === 'ROOM_NOT_FOUND') {
        window.sessionStorage.setItem(
          ROOM_CLOSED_NOTICE_KEY,
          JSON.stringify({
            title: '방 종료 안내',
            message:
              '방장이 연결 종료되어 방이 종료되었습니다. 모든 참가자가 로비로 이동되었습니다.'
          })
        )
        setSnapshot(null)
        navigate('/', { replace: true })
        return
      }
      notifyError(
        loadError instanceof Error ? loadError.message : '방 정보를 불러오지 못했습니다.',
        'room-load'
      )
    } finally {
      setLoading(false)
    }
  }, [navigate, roomId])

  useEffect(() => {
    void loadSnapshot()
    const poll = window.setInterval(() => {
      void loadSnapshot()
    }, 1500)

    return () => {
      window.clearInterval(poll)
    }
  }, [loadSnapshot])

  useEffect(() => {
    if (!roomId) {
      return
    }

    const heartbeat = window.setInterval(() => {
      void touchHeartbeat(roomId, playerToken)
    }, 5000)

    return () => {
      window.clearInterval(heartbeat)
    }
  }, [roomId, playerToken])

  useEffect(() => {
    if (!roomId) {
      return
    }

    const checkDisconnect = window.setInterval(async () => {
      try {
        const fresh = await getRoomSnapshot(roomId)
        await evaluateDisconnects(fresh.room, fresh.players, fresh.currentGame)
        await enforceTurnTimeout(fresh.room, fresh.players, fresh.currentGame)
      } catch {
        // 주기 동기화 호출
      }
    }, 5000)

    return () => {
      window.clearInterval(checkDisconnect)
    }
  }, [roomId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTurnTick(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!snapshot?.logs?.length) {
      return
    }

    const hasMatchFinished = snapshot.logs.some((log) => log.event_type === 'match_finished')
    if (hasMatchFinished) {
      return
    }

    const latestRoundCompletedLog = snapshot.logs.find(
      (log) => log.event_type === 'round_completed'
    )
    if (!latestRoundCompletedLog) {
      return
    }

    const logId = Number(latestRoundCompletedLog.id)
    if (shownRoundResultLogIdsRef.current.has(logId)) {
      return
    }

    const payload = (latestRoundCompletedLog.payload ?? {}) as {
      outcome?: {
        outcomes?: RoundResultEntry[]
        dealerHand?: Card[]
        dealerValue?: number
        dealerBust?: boolean
      }
    }
    const outcome = payload.outcome
    const outcomes = outcome?.outcomes
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      return
    }

    const dealerHand = Array.isArray(outcome?.dealerHand) ? outcome.dealerHand : []
    const fallbackDealerValue = dealerHand.length > 0 ? Number(handValueLabel(dealerHand)) : null
    const dealerValue =
      typeof outcome?.dealerValue === 'number' && Number.isFinite(outcome.dealerValue)
        ? outcome.dealerValue
        : fallbackDealerValue
    const dealerBust =
      typeof outcome?.dealerBust === 'boolean'
        ? outcome.dealerBust
        : dealerValue !== null
          ? dealerValue > 21
          : null

    shownRoundResultLogIdsRef.current.add(logId)
    setRoundResultModal({
      roundNo: latestRoundCompletedLog.round_no ?? '-',
      dealerHand,
      dealerValue,
      dealerBust,
      outcomes
    })
  }, [snapshot?.logs])

  const eliminationOrder = useMemo(() => {
    if (!snapshot?.logs?.length) {
      return []
    }

    const ordered = [...snapshot.logs]
      .filter((log) => log.event_type === 'player_eliminated')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    const tokens: string[] = []
    for (const log of ordered) {
      const payload = (log.payload ?? {}) as { playerToken?: string }
      const token = payload.playerToken ?? log.player_token ?? undefined
      if (token && !tokens.includes(token)) {
        tokens.push(token)
      }
    }

    return tokens
  }, [snapshot?.logs])

  const provisionalRankByToken = useMemo(() => {
    if (!snapshot?.players?.length) {
      return new Map<string, number>()
    }

    const participantCount = snapshot.players.filter((player) => player.status !== 'left').length
    const map = new Map<string, number>()

    eliminationOrder.forEach((token, index) => {
      map.set(token, participantCount - index)
    })

    return map
  }, [eliminationOrder, snapshot?.players])

  const latestMatchFinishedLog = useMemo(() => {
    return snapshot?.logs.find((log) => log.event_type === 'match_finished') ?? null
  }, [snapshot?.logs])

  const finalLeaderboard = useMemo<LeaderboardEntry[]>(() => {
    if (!latestMatchFinishedLog) {
      return []
    }

    const payload = (latestMatchFinishedLog.payload ?? {}) as {
      leaderboard?: LeaderboardEntry[]
    }

    if (!Array.isArray(payload.leaderboard)) {
      return []
    }

    return [...payload.leaderboard].sort((a, b) => a.rank - b.rank)
  }, [latestMatchFinishedLog])

  const finalRankByToken = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of finalLeaderboard) {
      map.set(entry.playerToken, entry.rank)
    }
    return map
  }, [finalLeaderboard])

  useEffect(() => {
    if (!latestMatchFinishedLog) {
      return
    }

    const logId = Number(latestMatchFinishedLog.id)
    if (shownMatchFinishedLogIdRef.current === logId) {
      return
    }

    shownMatchFinishedLogIdRef.current = logId
    setWinnerCelebrationOpen(true)
  }, [latestMatchFinishedLog])

  useEffect(() => {
    if (latestMatchFinishedLog) {
      setRoundResultModal(null)
    }
  }, [latestMatchFinishedLog])

  useEffect(() => {
    if (finalLeaderboard.length === 0) {
      setWinnerCelebrationOpen(false)
    }
  }, [finalLeaderboard.length])

  const me = useMemo(
    () => snapshot?.players.find((player) => player.player_token === playerToken) ?? null,
    [playerToken, snapshot?.players]
  )

  const activePlayers = useMemo(
    () => snapshot?.players.filter((player) => player.status === 'active') ?? [],
    [snapshot?.players]
  )

  const canHostStart = useMemo(() => {
    if (!snapshot || !me?.is_host || snapshot.room.status !== 'waiting') {
      return false
    }

    const nonHost = activePlayers.filter((player) => !player.is_host)
    return activePlayers.length >= 1 && nonHost.every((player) => player.is_ready)
  }, [activePlayers, me?.is_host, snapshot])

  useEffect(() => {
    const game = snapshot?.currentGame
    if (!game || game.status !== 'completed') {
      return
    }

    if (!snapshot || !me?.is_host) {
      return
    }

    if (snapshot.room.status !== 'in_game' || snapshot.room.winner_token) {
      return
    }

    if (autoStartedRoundRef.current === game.round_no) {
      return
    }

    autoStartedRoundRef.current = game.round_no

    void (async () => {
      try {
        await startNewRound(snapshot.room, snapshot.players, me.player_token)
        await loadSnapshot()
      } catch (startError) {
        const message =
          startError instanceof Error ? startError.message : '다음 라운드 자동 시작 실패'
        if (message !== '이미 진행 중인 라운드가 있습니다.') {
          autoStartedRoundRef.current = null
          notifyError(message, 'round-autostart')
        }
      }
    })()
  }, [loadSnapshot, me?.is_host, me?.player_token, snapshot])

  const isMyTurn = useMemo(() => {
    if (!snapshot?.currentGame || !me) {
      return false
    }

    return (
      snapshot.currentGame.status === 'in_progress' &&
      snapshot.currentGame.state.phase === 'player_turns' &&
      snapshot.currentGame.state.currentTurnToken === me.player_token
    )
  }, [me, snapshot?.currentGame])

  const currentTurnRemaining = useMemo(() => {
    const game = snapshot?.currentGame
    if (
      !game ||
      game.status !== 'in_progress' ||
      game.state.phase !== 'player_turns' ||
      !game.state.currentTurnToken
    ) {
      return null
    }

    const turnPlayer = game.state.players.find(
      (player) => player.playerToken === game.state.currentTurnToken
    )

    if (!turnPlayer) {
      return null
    }

    const elapsedSec = Math.floor((turnTick - new Date(turnPlayer.lastActionAt).getTime()) / 1000)
    const remainingSec = Math.max(0, 60 - elapsedSec)

    return {
      nickname: turnPlayer.nickname,
      remainingSec
    }
  }, [snapshot?.currentGame, turnTick])

  const handleReadyToggle = async (): Promise<void> => {
    if (!snapshot?.room || !me) {
      return
    }

    try {
      setActing(true)
      await setReady(snapshot.room.id, playerToken, !me.is_ready)
      await loadSnapshot()
    } catch (readyError) {
      notifyError(
        readyError instanceof Error ? readyError.message : 'READY 상태 변경 실패',
        'player-ready'
      )
    } finally {
      setActing(false)
    }
  }

  const handleStartRound = async (): Promise<void> => {
    if (!snapshot || !me?.is_host) {
      return
    }

    try {
      setActing(true)
      await startNewRound(snapshot.room, snapshot.players, me.player_token)
      await loadSnapshot()
    } catch (startError) {
      notifyError(startError instanceof Error ? startError.message : '게임 시작 실패', 'game-start')
    } finally {
      setActing(false)
    }
  }

  const handleAction = async (action: 'hit' | 'stand' | 'double'): Promise<void> => {
    if (!snapshot?.currentGame || !snapshot.room) {
      return
    }

    try {
      setActing(true)
      await actInCurrentRound(
        snapshot.room,
        snapshot.players,
        snapshot.currentGame,
        playerToken,
        action
      )
      await loadSnapshot()
    } catch (actionError) {
      notifyError(
        actionError instanceof Error ? actionError.message : '행동 처리 실패',
        'game-action'
      )
    } finally {
      setActing(false)
    }
  }

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!snapshot?.room || !message.trim()) {
      return
    }

    try {
      setSending(true)
      await sendRoomMessage(snapshot.room.id, playerToken, nickname, message)
      setMessage('')
      await loadSnapshot()
    } catch (messageError) {
      notifyError(
        messageError instanceof Error ? messageError.message : '메시지 전송 실패',
        'message-send'
      )
    } finally {
      setSending(false)
    }
  }

  const handleLeave = async (): Promise<void> => {
    if (!snapshot?.room) {
      window.sessionStorage.removeItem(ROOM_CLOSED_NOTICE_KEY)
      navigate('/')
      return
    }

    try {
      await leaveRoom(snapshot.room.id, playerToken)
    } finally {
      window.sessionStorage.removeItem(ROOM_CLOSED_NOTICE_KEY)
      navigate('/')
    }
  }

  const handleRequestLeave = (): void => {
    setLeaveConfirmOpen(true)
  }

  if (loading) {
    return <div className="px-6 py-10 text-slate-300">방 정보를 불러오는 중...</div>
  }

  if (!snapshot || !me) {
    return (
      <div className="px-6 py-10">
        <p className="text-slate-200">방 참가 정보가 없습니다. 로비에서 다시 입장해주세요.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-3 rounded-xl border border-emerald-300/40 px-3 py-2 text-sm text-emerald-100"
        >
          로비로 이동
        </button>
      </div>
    )
  }

  const game = snapshot.currentGame
  const outcome = game?.state.outcome
  const nextRoundPreparing = Boolean(
    me.is_host &&
    snapshot.room.status === 'in_game' &&
    game?.status === 'completed' &&
    !snapshot.room.winner_token
  )

  return (
    <div className="min-h-screen w-full overflow-x-auto bg-[#04080d]">
      <main className="min-h-screen min-w-[1520px] bg-[radial-gradient(circle_at_18%_10%,rgba(25,66,50,0.3),transparent_32%),radial-gradient(circle_at_90%_78%,rgba(29,49,78,0.35),transparent_40%),linear-gradient(160deg,#04080d,#0a1a26)] px-4 pb-4 pt-4">
        <header className="mb-4 rounded-2xl border border-white/12 bg-[rgba(11,18,26,0.92)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-emerald-300/85">
                Blackjack Room
              </p>
              <h1 className="mt-1 font-display text-3xl text-slate-100">{snapshot.room.name}</h1>
              <p className="mt-1 text-sm text-slate-300">
                상태 {snapshot.room.status} · 목표 {formatCurrency(snapshot.room.target_money)} ·
                기본 베팅 {formatCurrency(snapshot.room.base_bet)} · 인원 {activePlayers.length}/
                {snapshot.room.max_players}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!me.is_host && me.status === 'active' && snapshot.room.status === 'waiting' ? (
                <button
                  type="button"
                  onClick={() => void handleReadyToggle()}
                  disabled={acting}
                  className="rounded-xl border border-emerald-300/40 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-300/10 disabled:opacity-60"
                >
                  {me.is_ready ? 'READY 해제' : 'READY'}
                </button>
              ) : null}

              {me.is_host && snapshot.room.status === 'waiting' ? (
                <button
                  type="button"
                  onClick={() => void handleStartRound()}
                  disabled={acting || !canHostStart || game?.status === 'in_progress'}
                  className="rounded-xl bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                >
                  {game?.status === 'in_progress' ? '라운드 진행 중' : '게임 시작'}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setRulesOpen(true)}
                className="rounded-xl border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10"
              >
                게임 룰 보기
              </button>

              <button
                type="button"
                onClick={handleRequestLeave}
                className="rounded-xl border border-rose-300/40 px-3 py-2 text-sm text-rose-100 hover:bg-rose-400/10"
              >
                방 나가기
              </button>
            </div>
          </div>

          {finalLeaderboard.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200/35 bg-amber-400/10 px-3 py-3">
              <p className="text-sm text-amber-100">최종 리더보드</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {finalLeaderboard.map((entry) => (
                  <span
                    key={entry.playerToken}
                    className={`rounded-full border px-3 py-1 text-xs ${rankTone(entry.rank)}`}
                  >
                    {ordinal(entry.rank)} · {entry.nickname} · {formatCurrency(entry.balance)}
                  </span>
                ))}
              </div>
            </div>
          ) : snapshot.room.winner_token ? (
            <p className="mt-3 rounded-xl border border-amber-200/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              우승자 확정:{' '}
              {
                snapshot.players.find(
                  (player) => player.player_token === snapshot.room.winner_token
                )?.nickname
              }
            </p>
          ) : null}
        </header>

        <section className="grid h-[calc(100vh-178px)] grid-cols-[320px_minmax(0,1fr)_360px] gap-4">
          <aside className="rounded-2xl border border-white/12 bg-[rgba(7,12,18,0.9)] p-4">
            <h2 className="font-display text-2xl text-slate-100">게임 기록</h2>
            <p className="mt-1 text-xs text-slate-400">진행/결과 로그가 누적 표시됩니다.</p>
            <div className="mt-3 h-[calc(100%-72px)] space-y-2 overflow-auto pr-1">
              {snapshot.logs.map((log) => {
                const formatted = formatLog(log)
                return (
                  <div key={log.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-xs text-slate-400">
                      {new Date(log.created_at).toLocaleTimeString()} · {formatted.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-100">{formatted.detail}</p>
                  </div>
                )
              })}
              {snapshot.logs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/15 p-3 text-sm text-slate-400">
                  아직 기록이 없습니다.
                </p>
              ) : null}
            </div>
          </aside>

          <section className="rounded-2xl border border-white/12 bg-[radial-gradient(circle_at_20%_10%,rgba(18,60,40,0.34),transparent_35%),rgba(6,12,18,0.94)] p-5">
            <h2 className="font-display text-3xl text-slate-100">블랙잭 테이블</h2>

            <div className="mt-3 flex flex-wrap gap-2">
              {snapshot.players.map((player) => {
                const placementRank =
                  finalRankByToken.get(player.player_token) ??
                  provisionalRankByToken.get(player.player_token)

                return (
                  <div
                    key={player.id}
                    className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs text-slate-200"
                  >
                    {player.is_host ? '👑 ' : ''}
                    {player.nickname}
                    {player.player_token === playerToken ? ' (나)' : ''}
                    {' · '}
                    {formatCurrency(player.balance)}
                    {' · '}
                    {player.status}
                    {placementRank ? ` · ${ordinal(placementRank)}` : ''}
                    {player.status === 'active' && !player.is_host
                      ? ` · READY ${player.is_ready ? 'ON' : 'OFF'}`
                      : ''}
                  </div>
                )
              })}
            </div>

            {!game ? <p className="mt-5 text-slate-300">아직 시작된 라운드가 없습니다.</p> : null}

            {game ? (
              <>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Dealer</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {game.state.dealerHand.map((card, index) => {
                      const isHiddenCard =
                        game.status === 'in_progress' &&
                        game.state.phase === 'player_turns' &&
                        index === 1

                      return (
                        <span
                          key={`${card.rank}-${card.suit}-${index}`}
                          className={
                            isHiddenCard
                              ? 'rounded-lg border border-white/20 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-slate-100'
                              : `rounded-lg border px-3 py-2 text-sm font-semibold ${cardToneClass(card)}`
                          }
                        >
                          {isHiddenCard ? '🂠' : formatCard(card)}
                        </span>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    점수:{' '}
                    {game.status === 'in_progress' && game.state.phase === 'player_turns'
                      ? '공개 전'
                      : handValueLabel(game.state.dealerHand)}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {game.state.players.map((player) => (
                    <div
                      key={player.playerToken}
                      className={`rounded-2xl border p-3 ${
                        game.status === 'in_progress' &&
                        game.state.phase === 'player_turns' &&
                        game.state.currentTurnToken === player.playerToken
                          ? 'border-amber-300/70 bg-amber-200/10 shadow-[0_0_0_1px_rgba(252,211,77,0.35)]'
                          : 'border-white/10 bg-black/20'
                      }`}
                    >
                      <p className="text-sm text-slate-100">
                        {player.nickname}
                        {player.playerToken === playerToken ? ' (나)' : ''}
                      </p>
                      <p className="text-xs text-slate-400">
                        베팅 {formatCurrency(player.bet)} · 상태 {player.state}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {player.hand.map((card, index) => (
                          <span
                            key={`${card.rank}-${card.suit}-${index}`}
                            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${cardToneClass(card)}`}
                          >
                            {formatCard(card)}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-slate-300">
                        핸드 점수 {handValueLabel(player.hand)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-slate-300">
                    라운드 #{game.round_no} · 현재 턴:{' '}
                    {game.state.players.find(
                      (player) => player.playerToken === game.state.currentTurnToken
                    )?.nickname ?? '없음'}
                    {currentTurnRemaining
                      ? ` · 남은 시간 ${currentTurnRemaining.remainingSec}s`
                      : ''}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={acting || !isMyTurn}
                      onClick={() => void handleAction('hit')}
                      className="rounded-xl border border-sky-300/40 px-3 py-2 text-sm text-sky-100 disabled:opacity-60"
                    >
                      Hit
                    </button>
                    <button
                      type="button"
                      disabled={acting || !isMyTurn}
                      onClick={() => void handleAction('stand')}
                      className="rounded-xl border border-emerald-300/40 px-3 py-2 text-sm text-emerald-100 disabled:opacity-60"
                    >
                      Stand
                    </button>
                    <button
                      type="button"
                      disabled={acting || !isMyTurn}
                      onClick={() => void handleAction('double')}
                      className="rounded-xl border border-amber-300/40 px-3 py-2 text-sm text-amber-100 disabled:opacity-60"
                    >
                      Double
                    </button>
                  </div>
                </div>

                {outcome ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-sm text-slate-100">라운드 결과</p>
                    <div className="mt-2 grid gap-1 text-sm text-slate-300">
                      {outcome.outcomes.map((entry) => (
                        <div key={entry.playerToken}>
                          <p>
                            {entry.nickname}: {entry.result} ({entry.delta >= 0 ? '+' : ''}
                            {formatCurrency(entry.delta)}) → {formatCurrency(entry.finalBalance)}
                          </p>
                          <p className="text-xs text-slate-400">{handSummary(entry)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {nextRoundPreparing ? (
                  <p className="mt-4 text-sm text-emerald-200">다음 게임 준비중...</p>
                ) : null}
              </>
            ) : null}
          </section>

          <aside className="rounded-2xl border border-white/12 bg-[rgba(7,12,18,0.9)] p-4">
            <h2 className="font-display text-2xl text-slate-100">채팅</h2>
            <div className="mt-3 h-[calc(100%-116px)] space-y-2 overflow-auto rounded-xl border border-white/10 bg-black/25 p-3">
              {snapshot.messages.map((chat) => (
                <div key={chat.id}>
                  <p className="text-xs text-emerald-200">{chat.nickname}</p>
                  <p className="text-sm text-slate-100">{chat.message}</p>
                </div>
              ))}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={handleSendMessage}>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300"
                placeholder="메시지 입력"
                maxLength={500}
              />
              <button
                type="submit"
                disabled={sending}
                className="rounded-xl border border-emerald-300/40 px-3 py-2 text-sm text-emerald-100 disabled:opacity-60"
              >
                전송
              </button>
            </form>
          </aside>
        </section>

        {roundResultModal ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4">
            <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-[rgba(11,20,18,0.98)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
              <h3 className="font-display text-2xl text-slate-100">
                라운드 #{roundResultModal.roundNo} 결과
              </h3>
              <div className="mt-4 rounded-xl border border-white/15 bg-black/25 p-3">
                <p className="text-sm text-slate-100">딜러 카드</p>
                {roundResultModal.dealerHand.length > 0 ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {roundResultModal.dealerHand.map((card, index) => (
                        <span
                          key={`${card.rank}-${card.suit}-${index}`}
                          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${cardToneClass(card)}`}
                        >
                          {formatCard(card)}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      합계{' '}
                      {roundResultModal.dealerValue ?? handValueLabel(roundResultModal.dealerHand)}
                      {roundResultModal.dealerBust ? ' (BUST)' : ''}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">카드 정보 없음</p>
                )}
              </div>
              <div className="mt-4 grid gap-2 text-sm text-slate-200">
                {roundResultModal.outcomes.map((entry) => (
                  <div key={entry.playerToken}>
                    <p>
                      {entry.nickname}: {entry.result} ({entry.delta >= 0 ? '+' : ''}
                      {formatCurrency(entry.delta)}) → {formatCurrency(entry.finalBalance)}
                    </p>
                    <p className="text-xs text-slate-400">{handSummary(entry)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">다음 라운드는 자동으로 진행됩니다.</p>
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setRoundResultModal(null)}
                  className="rounded-xl bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <BlackjackRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

        {winnerCelebrationOpen && finalLeaderboard.length > 0 ? (
          <div className="fixed inset-0 z-[79] flex items-center justify-center bg-black/75 px-4">
            <div className="w-full max-w-2xl rounded-2xl border border-amber-200/40 bg-[linear-gradient(150deg,rgba(34,27,10,0.94),rgba(11,20,18,0.98))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
              <p className="text-xs uppercase tracking-[0.22em] text-amber-200/80">
                Match Finished
              </p>
              <h3 className="mt-2 font-display text-4xl text-amber-100">🏆 Victory</h3>
              <p className="mt-2 text-sm text-slate-200">
                우승자: <span className="font-semibold">{finalLeaderboard[0]?.nickname}</span>
              </p>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {finalLeaderboard.slice(0, 3).map((entry) => (
                  <div
                    key={entry.playerToken}
                    className={`rounded-xl border p-3 text-center ${rankTone(entry.rank)}`}
                  >
                    <p className="text-xs">
                      {entry.rank === 1 ? '금' : entry.rank === 2 ? '은' : '동'}
                    </p>
                    <p className="mt-1 text-sm font-semibold">{entry.nickname}</p>
                    <p className="mt-1 text-xs">{formatCurrency(entry.balance)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-white/15 bg-black/25 p-3">
                <p className="text-sm text-slate-100">전체 순위</p>
                <div className="mt-2 grid gap-1 text-sm text-slate-200">
                  {finalLeaderboard.map((entry) => (
                    <p key={entry.playerToken}>
                      {ordinal(entry.rank)} · {entry.nickname} · {formatCurrency(entry.balance)}
                    </p>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setWinnerCelebrationOpen(false)}
                  className="rounded-xl bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {leaveConfirmOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4">
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[rgba(11,20,18,0.98)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
              <h3 className="font-display text-2xl text-slate-100">방 나가기 확인</h3>
              <p className="mt-2 text-sm text-slate-300">정말 방에서 나가시겠습니까?</p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setLeaveConfirmOpen(false)}
                  className="rounded-xl border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleLeave()}
                  className="rounded-xl border border-rose-300/40 px-3 py-2 text-sm text-rose-100 transition hover:bg-rose-400/10"
                >
                  나가기
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
