export type RoomStatus = 'waiting' | 'in_game' | 'finished'
export type ParticipantStatus = 'active' | 'disconnected' | 'eliminated' | 'left'
export type GameStatus = 'in_progress' | 'completed'

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

export interface Card {
  suit: Suit
  rank: Rank
}

export type RoundPlayerState = 'active' | 'stand' | 'bust' | 'blackjack' | 'out' | 'disconnected'

export interface RoundPlayer {
  playerToken: string
  nickname: string
  hand: Card[]
  bet: number
  state: RoundPlayerState
  canDouble: boolean
  lastActionAt: string
}

export type TurnAction = 'hit' | 'stand' | 'double'

export interface PlayerOutcome {
  playerToken: string
  nickname: string
  result: 'win' | 'lose' | 'push' | 'blackjack' | 'disconnected'
  delta: number
  finalBalance: number
  hand: Card[]
  handTotal: number
  handBust: boolean
}

export interface RoundOutcome {
  dealerHand: Card[]
  dealerValue: number
  dealerBust: boolean
  winners: string[]
  outcomes: PlayerOutcome[]
}

export type RoundPhase = 'player_turns' | 'dealer_turn' | 'settlement' | 'complete'

export interface BlackjackRoundState {
  roomId: string
  roundNo: number
  phase: RoundPhase
  deck: Card[]
  dealerHand: Card[]
  players: RoundPlayer[]
  currentTurnToken: string | null
  actionHistory: Array<{
    at: string
    playerToken: string
    action: TurnAction | 'auto-stand-disconnect'
  }>
  outcome: RoundOutcome | null
  startedAt: string
  updatedAt: string
}

export interface Room {
  id: string
  name: string
  password: string | null
  host_token: string
  max_players: number
  target_money: number
  starting_money: number
  base_bet: number
  status: RoomStatus
  winner_token: string | null
  created_at: string
  updated_at: string
}

export interface RoomPlayer {
  id: string
  room_id: string
  player_token: string
  nickname: string
  balance: number
  is_host: boolean
  is_ready: boolean
  status: ParticipantStatus
  last_seen_at: string
  joined_at: string
  updated_at: string
}

export interface RoomMessage {
  id: number
  room_id: string
  player_token: string
  nickname: string
  message: string
  created_at: string
}

export interface Game {
  id: string
  room_id: string
  round_no: number
  status: GameStatus
  state: BlackjackRoundState
  started_by: string
  created_at: string
  updated_at: string
}

export interface GameLog {
  id: number
  room_id: string
  game_id: string | null
  round_no: number | null
  event_type: string
  player_token: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export interface CreateRoomInput {
  name: string
  password?: string
  maxPlayers: number
  targetMoney: number
  startingMoney: number
  baseBet: number
}
