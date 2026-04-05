import type {
  BlackjackRoundState,
  CreateRoomInput,
  Game,
  GameLog,
  Room,
  RoomMessage,
  RoomPlayer,
  TurnAction
} from '@renderer/types/domain'
import { applyAction, canPlayerAct, markDisconnected, startRound } from './blackjack'
import { ensureSupabase } from './supabase'

export interface RoomListItem extends Room {
  player_count: number
}

export interface RoomSnapshot {
  room: Room
  players: RoomPlayer[]
  messages: RoomMessage[]
  logs: GameLog[]
  currentGame: Game | null
}

export interface ReconnectCandidate {
  roomId: string
  roomName: string
  roomStatus: Room['status']
  lastSeenAt: string
  elapsedSec: number
  canReconnect: boolean
}

interface ReconnectEligibility {
  elapsedSec: number
  canReconnect: boolean
}

interface LeaderboardEntry {
  rank: number
  playerToken: string
  nickname: string
  balance: number
}

function nowISO(): string {
  return new Date().toISOString()
}

function ensureNickname(nickname: string): string {
  const trimmed = nickname.trim()

  if (trimmed.length < 2 || trimmed.length > 20) {
    throw new Error('닉네임은 2~20자로 입력해주세요.')
  }

  return trimmed
}

function mapBalance(players: RoomPlayer[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const player of players) {
    map.set(player.player_token, Number(player.balance))
  }
  return map
}

function isTimedOut(lastSeenAt: string, thresholdSec = 30): boolean {
  const diffMs = Date.now() - new Date(lastSeenAt).getTime()
  return diffMs >= thresholdSec * 1000
}

function elapsedSecFrom(timestamp: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
}

function isRpcMissingError(error: { code?: string } | null): boolean {
  return Boolean(error?.code && ['PGRST202', '42883'].includes(error.code))
}

async function getReconnectEligibility(
  roomId: string,
  playerToken: string,
  fallbackLastSeenAt: string
): Promise<ReconnectEligibility> {
  const supabase = ensureSupabase()

  const { data, error } = await supabase.rpc('check_reconnect_eligibility', {
    p_room_id: roomId,
    p_player_token: playerToken
  })

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    if (row) {
      return {
        elapsedSec: Number(row.elapsed_sec ?? 0),
        canReconnect: Boolean(row.can_reconnect)
      }
    }
  } else if (!isRpcMissingError(error)) {
    throw error
  }

  const elapsedSec = elapsedSecFrom(fallbackLastSeenAt)
  return {
    elapsedSec,
    canReconnect: elapsedSec <= 30
  }
}

async function appendGameLog(
  roomId: string,
  eventType: string,
  payload: Record<string, unknown>,
  gameId?: string,
  roundNo?: number,
  playerToken?: string
): Promise<void> {
  const supabase = ensureSupabase()

  const { error } = await supabase.from('game_logs').insert({
    room_id: roomId,
    game_id: gameId,
    round_no: roundNo,
    event_type: eventType,
    player_token: playerToken,
    payload
  })

  if (error) {
    throw error
  }
}

async function cleanupExpiredHostRooms(): Promise<void> {
  const supabase = ensureSupabase()
  const threshold = new Date(Date.now() - 30_000).toISOString()

  const { data: staleHosts, error: staleHostsError } = await supabase
    .from('room_players')
    .select('room_id')
    .eq('is_host', true)
    .neq('status', 'left')
    .lt('last_seen_at', threshold)

  if (staleHostsError) {
    throw staleHostsError
  }

  const roomIds = [...new Set((staleHosts ?? []).map((entry) => entry.room_id))]
  if (roomIds.length === 0) {
    return
  }

  const { error: deleteError } = await supabase.from('rooms').delete().in('id', roomIds)
  if (deleteError) {
    throw deleteError
  }
}

async function buildLeaderboard(
  roomId: string,
  participants: RoomPlayer[],
  winnerToken: string | null
): Promise<LeaderboardEntry[]> {
  const supabase = ensureSupabase()
  const activeParticipants = participants.filter((player) => player.status !== 'left')
  const byToken = new Map(activeParticipants.map((player) => [player.player_token, player]))

  const { data: eliminationLogs, error: eliminationLogError } = await supabase
    .from('game_logs')
    .select('player_token, payload, created_at')
    .eq('room_id', roomId)
    .eq('event_type', 'player_eliminated')
    .order('created_at', { ascending: true })

  if (eliminationLogError) {
    throw eliminationLogError
  }

  const eliminationOrder: string[] = []
  for (const log of eliminationLogs ?? []) {
    const payload = (log.payload ?? {}) as { playerToken?: string }
    const token = payload.playerToken ?? log.player_token ?? undefined
    if (!token || !byToken.has(token) || eliminationOrder.includes(token)) {
      continue
    }
    eliminationOrder.push(token)
  }

  const rankingTokens: string[] = []

  if (winnerToken && byToken.has(winnerToken)) {
    rankingTokens.push(winnerToken)
  }

  for (const token of [...eliminationOrder].reverse()) {
    if (!rankingTokens.includes(token) && byToken.has(token)) {
      rankingTokens.push(token)
    }
  }

  const unresolved = activeParticipants
    .filter((player) => !rankingTokens.includes(player.player_token))
    .sort((a, b) => Number(b.balance) - Number(a.balance))

  for (const player of unresolved) {
    rankingTokens.push(player.player_token)
  }

  return rankingTokens.map((token, index) => {
    const player = byToken.get(token)
    if (!player) {
      throw new Error('리더보드 계산 중 플레이어 정보를 찾을 수 없습니다.')
    }

    return {
      rank: index + 1,
      playerToken: token,
      nickname: player.nickname,
      balance: Number(player.balance)
    }
  })
}

async function syncBalancesAndStatuses(
  room: Room,
  players: RoomPlayer[],
  balances: Map<string, number>,
  game?: Game
): Promise<RoomPlayer[]> {
  const supabase = ensureSupabase()

  const eliminationTransitions: Array<{
    token: string
    nickname: string
    reason: 'disconnect_timeout' | 'no_balance' | 'insufficient_for_base_bet'
    balance: number
  }> = []

  const updates = players.map(async (player) => {
    const nextBalance = Number((balances.get(player.player_token) ?? player.balance).toFixed(2))
    const isInsufficientForBaseBet = nextBalance < room.base_bet

    let nextStatus = player.status
    if (player.status !== 'left') {
      if (player.status === 'disconnected') {
        nextStatus = 'eliminated'
      } else if (player.status === 'active' && isInsufficientForBaseBet) {
        nextStatus = 'eliminated'
      }
    }

    if (player.status !== 'eliminated' && nextStatus === 'eliminated') {
      eliminationTransitions.push({
        token: player.player_token,
        nickname: player.nickname,
        reason:
          player.status === 'disconnected'
            ? 'disconnect_timeout'
            : nextBalance <= 0
              ? 'no_balance'
              : 'insufficient_for_base_bet',
        balance: nextBalance
      })
    }

    const { error } = await supabase
      .from('room_players')
      .update({
        balance: nextBalance,
        status: nextStatus,
        updated_at: nowISO()
      })
      .eq('id', player.id)

    if (error) {
      throw error
    }

    return {
      ...player,
      balance: nextBalance,
      status: nextStatus
    }
  })

  const updatedPlayers = await Promise.all(updates)

  for (const elimination of eliminationTransitions) {
    await appendGameLog(
      room.id,
      'player_eliminated',
      {
        playerToken: elimination.token,
        nickname: elimination.nickname,
        reason: elimination.reason,
        balance: elimination.balance
      },
      game?.id,
      game?.round_no,
      elimination.token
    )
  }

  const continuingPlayers = updatedPlayers.filter((player) => player.status === 'active')
  const participants = updatedPlayers.filter((player) => player.status !== 'left')

  let winnerToken: string | null = null
  let shouldFinishWithoutWinner = false

  const reachedTarget = continuingPlayers
    .filter((player) => Number(player.balance) >= room.target_money)
    .sort((a, b) => Number(b.balance) - Number(a.balance))

  if (reachedTarget.length > 0) {
    winnerToken = reachedTarget[0].player_token
  } else if (continuingPlayers.length === 1 && participants.length > 1) {
    winnerToken = continuingPlayers[0].player_token
  } else if (continuingPlayers.length === 0 && participants.length > 0) {
    winnerToken = [...participants].sort((a, b) => Number(b.balance) - Number(a.balance))[0]
      .player_token
  } else if (participants.length === 0) {
    shouldFinishWithoutWinner = true
  }

  const isMatchFinished = Boolean(winnerToken || shouldFinishWithoutWinner)

  const roomPatch = {
    status: isMatchFinished ? 'waiting' : 'in_game',
    winner_token: winnerToken,
    updated_at: nowISO()
  }

  const { error: roomUpdateError } = await supabase
    .from('rooms')
    .update(roomPatch)
    .eq('id', room.id)
  if (roomUpdateError) {
    throw roomUpdateError
  }

  if (isMatchFinished) {
    const leaderboard = await buildLeaderboard(room.id, updatedPlayers, winnerToken)
    const winnerNickname = winnerToken
      ? updatedPlayers.find((player) => player.player_token === winnerToken)?.nickname
      : null

    await appendGameLog(room.id, 'room_finished', {
      winnerToken,
      winnerNickname,
      reason: winnerToken ? 'winner_decided' : 'no_active_players'
    })

    await appendGameLog(room.id, 'match_finished', {
      winnerToken,
      winnerNickname,
      leaderboard
    })

    const disconnectedByTimeout = new Set(
      eliminationTransitions
        .filter((entry) => entry.reason === 'disconnect_timeout')
        .map((entry) => entry.token)
    )

    const resetPromises = updatedPlayers
      .filter((player) => player.status !== 'left')
      .map(async (player) => {
        const resetStatus = disconnectedByTimeout.has(player.player_token)
          ? 'disconnected'
          : 'active'

        const { error } = await supabase
          .from('room_players')
          .update({
            balance: room.starting_money,
            status: resetStatus,
            is_ready: false,
            updated_at: nowISO()
          })
          .eq('id', player.id)

        if (error) {
          throw error
        }
      })

    await Promise.all(resetPromises)
  }

  return updatedPlayers
}

async function completeRoundIfNeeded(
  room: Room,
  players: RoomPlayer[],
  game: Game,
  nextState: BlackjackRoundState,
  balances: Map<string, number>
): Promise<void> {
  const supabase = ensureSupabase()

  const gamePatch = {
    state: nextState,
    status: nextState.phase === 'complete' ? 'completed' : 'in_progress',
    updated_at: nowISO()
  }

  const { error: gameError } = await supabase.from('games').update(gamePatch).eq('id', game.id)
  if (gameError) {
    throw gameError
  }

  if (nextState.phase !== 'complete') {
    return
  }

  const updatedPlayers = await syncBalancesAndStatuses(room, players, balances, game)

  await appendGameLog(
    room.id,
    'round_completed',
    {
      gameId: game.id,
      roundNo: game.round_no,
      outcome: nextState.outcome,
      balances: updatedPlayers.map((player) => ({
        token: player.player_token,
        balance: player.balance,
        status: player.status
      }))
    },
    game.id,
    game.round_no
  )
}

export async function upsertProfile(playerToken: string, nickname: string): Promise<void> {
  const supabase = ensureSupabase()
  const safeNickname = ensureNickname(nickname)

  const { error } = await supabase.from('profiles').upsert(
    {
      player_token: playerToken,
      nickname: safeNickname,
      updated_at: nowISO()
    },
    {
      onConflict: 'player_token'
    }
  )

  if (error) {
    throw error
  }

  const { error: roomPlayerError } = await supabase
    .from('room_players')
    .update({ nickname: safeNickname, updated_at: nowISO() })
    .eq('player_token', playerToken)
    .neq('status', 'left')

  if (roomPlayerError) {
    throw roomPlayerError
  }
}

export async function fetchRooms(): Promise<RoomListItem[]> {
  const supabase = ensureSupabase()

  await cleanupExpiredHostRooms()

  const { data: rooms, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .order('created_at', { ascending: false })

  if (roomError) {
    throw roomError
  }

  if (!rooms || rooms.length === 0) {
    return []
  }

  const roomIds = rooms.map((room) => room.id)
  const { data: players, error: playerError } = await supabase
    .from('room_players')
    .select('room_id, status')
    .in('room_id', roomIds)
    .neq('status', 'left')

  if (playerError) {
    throw playerError
  }

  const countByRoom = new Map<string, number>()
  for (const player of players ?? []) {
    countByRoom.set(player.room_id, (countByRoom.get(player.room_id) ?? 0) + 1)
  }

  return rooms.map((room) => ({
    ...room,
    player_count: countByRoom.get(room.id) ?? 0
  }))
}

export async function createRoom(
  playerToken: string,
  nickname: string,
  input: CreateRoomInput
): Promise<string> {
  const supabase = ensureSupabase()
  const safeNickname = ensureNickname(nickname)

  if (input.maxPlayers < 1 || input.maxPlayers > 5) {
    throw new Error('최대 인원은 1~5명만 가능합니다.')
  }

  const { data: roomData, error: roomError } = await supabase
    .from('rooms')
    .insert({
      name: input.name.trim(),
      password: input.password?.trim() || null,
      host_token: playerToken,
      max_players: input.maxPlayers,
      target_money: input.targetMoney,
      starting_money: input.startingMoney,
      base_bet: input.baseBet,
      status: 'waiting'
    })
    .select('id')
    .single()

  if (roomError) {
    throw roomError
  }

  const roomId = roomData.id as string

  const { error: playerError } = await supabase.from('room_players').insert({
    room_id: roomId,
    player_token: playerToken,
    nickname: safeNickname,
    balance: input.startingMoney,
    is_host: true,
    is_ready: false,
    status: 'active',
    last_seen_at: nowISO()
  })

  if (playerError) {
    throw playerError
  }

  await appendGameLog(roomId, 'room_created', {
    roomName: input.name,
    hostToken: playerToken,
    maxPlayers: input.maxPlayers,
    targetMoney: input.targetMoney,
    startingMoney: input.startingMoney,
    baseBet: input.baseBet
  })

  return roomId
}

export async function joinRoom(
  roomId: string,
  playerToken: string,
  nickname: string,
  password?: string
): Promise<void> {
  const supabase = ensureSupabase()
  const safeNickname = ensureNickname(nickname)

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()
  if (roomError || !room) {
    throw new Error('방을 찾을 수 없습니다.')
  }

  const { data: players, error: playersError } = await supabase
    .from('room_players')
    .select('*')
    .eq('room_id', roomId)
    .neq('status', 'left')

  if (playersError) {
    throw playersError
  }

  if (room.status === 'finished') {
    throw new Error('이미 종료된 방입니다.')
  }

  const existing = players?.find((player) => player.player_token === playerToken)
  if (!existing && (room.password ?? '') !== (password ?? '')) {
    throw new Error('비밀번호가 일치하지 않습니다.')
  }

  const duplicatedNickname = players?.find(
    (player) => player.nickname === safeNickname && player.player_token !== playerToken
  )

  if (duplicatedNickname) {
    throw new Error('이미 사용 중인 닉네임입니다. 다른 닉네임으로 변경해주세요.')
  }

  if (existing) {
    const eligibility = await getReconnectEligibility(roomId, playerToken, existing.last_seen_at)
    if (room.status === 'in_game' && !eligibility.canReconnect) {
      throw new Error(
        `재접속 가능 시간이 만료되었습니다. (${eligibility.elapsedSec}초 경과, 30초 이내만 가능)`
      )
    }

    if (existing.status === 'eliminated' && room.status === 'in_game') {
      throw new Error('이미 탈락 처리되어 현재 게임에는 재참가할 수 없습니다.')
    }

    const { error: updateError } = await supabase
      .from('room_players')
      .update({
        nickname: safeNickname,
        status: 'active',
        is_ready: false,
        updated_at: nowISO(),
        last_seen_at: nowISO()
      })
      .eq('id', existing.id)

    if (updateError) {
      throw updateError
    }

    await appendGameLog(
      roomId,
      'player_reconnected',
      { playerToken, nickname: safeNickname, elapsedSec: eligibility.elapsedSec },
      undefined,
      undefined,
      playerToken
    )
    return
  }

  const participantCount = players?.length ?? 0
  if (participantCount >= room.max_players) {
    throw new Error('방 정원이 가득 찼습니다.')
  }

  const { error: insertError } = await supabase.from('room_players').insert({
    room_id: roomId,
    player_token: playerToken,
    nickname: safeNickname,
    balance: room.starting_money,
    is_host: false,
    is_ready: false,
    status: 'active',
    last_seen_at: nowISO()
  })

  if (insertError) {
    throw insertError
  }

  await appendGameLog(roomId, 'player_joined', { playerToken, nickname: safeNickname })
}

export async function leaveRoom(roomId: string, playerToken: string): Promise<void> {
  const supabase = ensureSupabase()

  const { data: currentPlayer, error: playerError } = await supabase
    .from('room_players')
    .select('*')
    .eq('room_id', roomId)
    .eq('player_token', playerToken)
    .single()

  if (playerError || !currentPlayer) {
    return
  }

  if (currentPlayer.is_host) {
    const { error: deleteRoomError } = await supabase.from('rooms').delete().eq('id', roomId)
    if (deleteRoomError) {
      throw deleteRoomError
    }
    return
  }

  const { error: leaveError } = await supabase
    .from('room_players')
    .update({ status: 'left', is_ready: false, updated_at: nowISO() })
    .eq('id', currentPlayer.id)

  if (leaveError) {
    throw leaveError
  }
}

export async function touchHeartbeat(roomId: string, playerToken: string): Promise<void> {
  const supabase = ensureSupabase()

  const { error } = await supabase
    .from('room_players')
    .update({ last_seen_at: nowISO(), updated_at: nowISO() })
    .eq('room_id', roomId)
    .eq('player_token', playerToken)
    .eq('status', 'active')

  if (error) {
    throw error
  }
}

export async function setReady(roomId: string, playerToken: string, ready: boolean): Promise<void> {
  const supabase = ensureSupabase()

  const { error } = await supabase
    .from('room_players')
    .update({ is_ready: ready, updated_at: nowISO() })
    .eq('room_id', roomId)
    .eq('player_token', playerToken)

  if (error) {
    throw error
  }
}

export async function sendRoomMessage(
  roomId: string,
  playerToken: string,
  nickname: string,
  message: string
): Promise<void> {
  const supabase = ensureSupabase()

  const trimmed = message.trim()
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error('메시지는 1~500자 사이로 입력해주세요.')
  }

  const { error } = await supabase.from('room_messages').insert({
    room_id: roomId,
    player_token: playerToken,
    nickname,
    message: trimmed
  })

  if (error) {
    throw error
  }
}

export async function getRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  const supabase = ensureSupabase()

  const [roomRes, playerRes, msgRes, gameRes, logRes] = await Promise.all([
    supabase.from('rooms').select('*').eq('id', roomId).single(),
    supabase
      .from('room_players')
      .select('*')
      .eq('room_id', roomId)
      .neq('status', 'left')
      .order('joined_at'),
    supabase
      .from('room_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(100),
    supabase
      .from('games')
      .select('*')
      .eq('room_id', roomId)
      .order('round_no', { ascending: false })
      .limit(1),
    supabase
      .from('game_logs')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(120)
  ])

  if (roomRes.error || !roomRes.data) {
    throw new Error('ROOM_NOT_FOUND')
  }

  if (playerRes.error) {
    throw playerRes.error
  }

  if (msgRes.error) {
    throw msgRes.error
  }

  if (gameRes.error) {
    throw gameRes.error
  }

  if (logRes.error) {
    throw logRes.error
  }

  return {
    room: roomRes.data,
    players: playerRes.data ?? [],
    messages: msgRes.data ?? [],
    logs: logRes.data ?? [],
    currentGame: gameRes.data?.[0] ?? null
  }
}

export async function getReconnectCandidate(
  playerToken: string
): Promise<ReconnectCandidate | null> {
  const supabase = ensureSupabase()

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_reconnect_candidate', {
    p_player_token: playerToken
  })

  if (!rpcError) {
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!row) {
      return null
    }

    if (!row.can_reconnect) {
      return null
    }

    return {
      roomId: String(row.room_id),
      roomName: String(row.room_name),
      roomStatus: row.room_status as Room['status'],
      lastSeenAt: String(row.last_seen_at),
      elapsedSec: Number(row.elapsed_sec ?? 0),
      canReconnect: Boolean(row.can_reconnect)
    }
  }

  if (!isRpcMissingError(rpcError)) {
    throw rpcError
  }

  const { data: myEntry, error: myEntryError } = await supabase
    .from('room_players')
    .select('*')
    .eq('player_token', playerToken)
    .in('status', ['active', 'disconnected'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (myEntryError) {
    throw myEntryError
  }

  if (!myEntry) {
    return null
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', myEntry.room_id)
    .maybeSingle()

  if (roomError) {
    throw roomError
  }

  if (!room || room.status === 'finished') {
    return null
  }

  const elapsedSec = elapsedSecFrom(myEntry.last_seen_at)
  if (elapsedSec > 30) {
    return null
  }

  return {
    roomId: room.id,
    roomName: room.name,
    roomStatus: room.status,
    lastSeenAt: myEntry.last_seen_at,
    elapsedSec,
    canReconnect: elapsedSec <= 30
  }
}

export async function startNewRound(
  room: Room,
  players: RoomPlayer[],
  hostToken: string
): Promise<void> {
  const supabase = ensureSupabase()
  let roomState = room

  if (room.host_token !== hostToken) {
    throw new Error('방장만 게임을 시작할 수 있습니다.')
  }

  if (roomState.status === 'waiting' && roomState.winner_token) {
    const { error: deleteGamesError } = await supabase
      .from('games')
      .delete()
      .eq('room_id', roomState.id)
    if (deleteGamesError) {
      throw deleteGamesError
    }

    const { error: deleteLogsError } = await supabase
      .from('game_logs')
      .delete()
      .eq('room_id', roomState.id)
    if (deleteLogsError) {
      throw deleteLogsError
    }

    const { error: clearWinnerError } = await supabase
      .from('rooms')
      .update({ winner_token: null, updated_at: nowISO() })
      .eq('id', roomState.id)

    if (clearWinnerError) {
      throw clearWinnerError
    }

    roomState = {
      ...roomState,
      winner_token: null
    }
  }

  const activePlayers = players.filter((player) => player.status === 'active')
  if (activePlayers.length < 1) {
    throw new Error('게임 시작에는 최소 1명이 필요합니다.')
  }

  if (roomState.status === 'waiting') {
    const nonHostPlayers = activePlayers.filter((player) => !player.is_host)
    const allReady = nonHostPlayers.every((player) => player.is_ready)
    if (!allReady) {
      throw new Error('방장을 제외한 모든 플레이어가 READY 상태여야 합니다.')
    }
  }

  const { data: latestGame, error: latestGameError } = await supabase
    .from('games')
    .select('round_no, status')
    .eq('room_id', room.id)
    .order('round_no', { ascending: false })
    .limit(1)

  if (latestGameError) {
    throw latestGameError
  }

  if (latestGame?.[0]?.status === 'in_progress') {
    throw new Error('이미 진행 중인 라운드가 있습니다.')
  }

  const roundNo = (latestGame?.[0]?.round_no ?? 0) + 1
  const balances = mapBalance(players)

  const { state, balances: nextBalances } = startRound(
    room.id,
    roundNo,
    room.base_bet,
    players,
    balances
  )

  const { data: insertedGame, error: gameInsertError } = await supabase
    .from('games')
    .insert({
      room_id: room.id,
      round_no: roundNo,
      status: state.phase === 'complete' ? 'completed' : 'in_progress',
      state,
      started_by: hostToken,
      updated_at: nowISO()
    })
    .select('*')
    .single()

  if (gameInsertError || !insertedGame) {
    if (gameInsertError?.code === '23505') {
      return
    }
    throw gameInsertError ?? new Error('게임 생성에 실패했습니다.')
  }

  await supabase
    .from('room_players')
    .update({ is_ready: false, updated_at: nowISO() })
    .eq('room_id', room.id)
  await supabase
    .from('rooms')
    .update({ status: state.phase === 'complete' ? 'in_game' : 'in_game', updated_at: nowISO() })
    .eq('id', room.id)

  await appendGameLog(
    room.id,
    'round_started',
    {
      gameId: insertedGame.id,
      roundNo,
      baseBet: room.base_bet,
      players: players.map((player) => ({
        token: player.player_token,
        nickname: player.nickname,
        balance: player.balance,
        status: player.status
      }))
    },
    insertedGame.id,
    roundNo,
    hostToken
  )

  if (state.phase === 'complete') {
    await completeRoundIfNeeded(room, players, insertedGame, state, nextBalances)
  }
}

export async function actInCurrentRound(
  room: Room,
  players: RoomPlayer[],
  game: Game,
  playerToken: string,
  action: TurnAction
): Promise<void> {
  if (game.status !== 'in_progress') {
    throw new Error('진행 중인 라운드가 없습니다.')
  }

  if (!canPlayerAct(game.state, playerToken)) {
    throw new Error('지금은 행동할 수 없는 턴입니다.')
  }

  const balances = mapBalance(players)
  const { state, balances: nextBalances } = applyAction(game.state, balances, playerToken, action)

  await completeRoundIfNeeded(room, players, game, state, nextBalances)

  await appendGameLog(
    room.id,
    'player_action',
    {
      gameId: game.id,
      roundNo: game.round_no,
      action,
      nextTurn: state.currentTurnToken,
      phase: state.phase
    },
    game.id,
    game.round_no,
    playerToken
  )
}

export async function evaluateDisconnects(
  room: Room,
  players: RoomPlayer[],
  game: Game | null
): Promise<void> {
  const supabase = ensureSupabase()

  const host = players.find((player) => player.is_host && player.status !== 'left')
  if (host && isTimedOut(host.last_seen_at, 30)) {
    const { error: deleteRoomError } = await supabase.from('rooms').delete().eq('id', room.id)
    if (deleteRoomError) {
      throw deleteRoomError
    }
    return
  }

  const timedOutPlayers = players.filter(
    (player) => player.status === 'active' && isTimedOut(player.last_seen_at, 30)
  )
  if (timedOutPlayers.length === 0) {
    return
  }

  const ids = timedOutPlayers.map((player) => player.id)
  const tokens = timedOutPlayers.map((player) => player.player_token)

  const { error: disconnectUpdateError } = await supabase
    .from('room_players')
    .update({ status: 'disconnected', is_ready: false, updated_at: nowISO() })
    .in('id', ids)

  if (disconnectUpdateError) {
    throw disconnectUpdateError
  }

  await appendGameLog(
    room.id,
    'players_disconnected',
    {
      tokens,
      reason: 'heartbeat_timeout_30s'
    },
    game?.id,
    game?.round_no
  )

  if (!game || game.status !== 'in_progress') {
    return
  }

  const playersAfterDisconnect = players.map((player) =>
    tokens.includes(player.player_token)
      ? {
          ...player,
          status: 'disconnected' as const,
          is_ready: false
        }
      : player
  )

  const balances = mapBalance(players)
  const { state, balances: nextBalances } = markDisconnected(game.state, balances, tokens)

  await completeRoundIfNeeded(room, playersAfterDisconnect, game, state, nextBalances)
}

export async function enforceTurnTimeout(
  room: Room,
  players: RoomPlayer[],
  game: Game | null
): Promise<void> {
  if (!game || game.status !== 'in_progress') {
    return
  }

  if (game.state.phase !== 'player_turns' || !game.state.currentTurnToken) {
    return
  }

  const turnPlayer = game.state.players.find(
    (player) => player.playerToken === game.state.currentTurnToken
  )

  if (!turnPlayer) {
    return
  }

  const elapsedSec = elapsedSecFrom(turnPlayer.lastActionAt)
  if (elapsedSec < 60) {
    return
  }

  await actInCurrentRound(room, players, game, turnPlayer.playerToken, 'stand')
  await appendGameLog(
    room.id,
    'turn_timeout_auto_stand',
    {
      gameId: game.id,
      roundNo: game.round_no,
      playerToken: turnPlayer.playerToken,
      nickname: turnPlayer.nickname,
      timeoutSec: 60
    },
    game.id,
    game.round_no,
    turnPlayer.playerToken
  )
}
