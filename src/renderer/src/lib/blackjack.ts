import type {
  BlackjackRoundState,
  Card,
  PlayerOutcome,
  Rank,
  RoomPlayer,
  RoundPlayer,
  TurnAction
} from '@renderer/types/domain'

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export interface HandValue {
  total: number
  isSoft: boolean
  isBust: boolean
  isBlackjack: boolean
}

export function createShuffledDeck(): Card[] {
  const deck: Card[] = []

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }

  return deck
}

function draw(deck: Card[]): Card {
  const card = deck.shift()
  if (!card) {
    throw new Error('덱이 비었습니다. 새 라운드를 시작해주세요.')
  }

  return card
}

function rankValue(rank: Rank): number {
  if (rank === 'A') return 11
  if (['K', 'Q', 'J'].includes(rank)) return 10
  return Number(rank)
}

export function getHandValue(hand: Card[]): HandValue {
  let total = hand.reduce((sum, card) => sum + rankValue(card.rank), 0)
  let aceCount = hand.filter((card) => card.rank === 'A').length

  while (total > 21 && aceCount > 0) {
    total -= 10
    aceCount -= 1
  }

  const isSoft = hand.some((card) => card.rank === 'A') && total <= 21 && aceCount > 0
  const isBlackjack = hand.length === 2 && total === 21

  return {
    total,
    isSoft,
    isBust: total > 21,
    isBlackjack
  }
}

function nextActiveTurn(players: RoundPlayer[], fromIndex = 0): string | null {
  for (let i = fromIndex; i < players.length; i += 1) {
    if (players[i].state === 'active') {
      return players[i].playerToken
    }
  }

  return null
}

function nowISO(): string {
  return new Date().toISOString()
}

function setCurrentTurn(players: RoundPlayer[], token: string | null): void {
  if (!token) {
    return
  }

  const index = players.findIndex((player) => player.playerToken === token)
  if (index >= 0 && players[index].state === 'active') {
    players[index] = { ...players[index], lastActionAt: nowISO() }
  }
}

function resolveDealer(dealerHand: Card[], deck: Card[]): Card[] {
  let dealerValue = getHandValue(dealerHand)

  // 기본 룰: 딜러는 17 이상에서 스탠드
  while (dealerValue.total < 17) {
    dealerHand.push(draw(deck))
    dealerValue = getHandValue(dealerHand)
  }

  return dealerHand
}

function settleRound(
  state: BlackjackRoundState,
  balances: Map<string, number>
): { state: BlackjackRoundState; balances: Map<string, number> } {
  const dealerValue = getHandValue(state.dealerHand)
  const outcomes: PlayerOutcome[] = []

  for (const player of state.players) {
    const previousBalance = balances.get(player.playerToken) ?? 0
    const playerValue = getHandValue(player.hand)

    let result: PlayerOutcome['result'] = 'lose'
    let delta = 0

    if (player.state === 'disconnected') {
      result = 'disconnected'
      delta = -player.bet
    } else if (player.state === 'out') {
      result = 'lose'
      delta = 0
    } else if (playerValue.isBlackjack && !getHandValue(state.dealerHand).isBlackjack) {
      result = 'blackjack'
      delta = player.bet * 1.5
    } else if (playerValue.isBust) {
      result = 'lose'
      delta = -player.bet
    } else if (dealerValue.isBust) {
      result = 'win'
      delta = player.bet
    } else if (dealerValue.isBlackjack && !playerValue.isBlackjack) {
      result = 'lose'
      delta = -player.bet
    } else if (playerValue.total > dealerValue.total) {
      result = 'win'
      delta = player.bet
    } else if (playerValue.total === dealerValue.total) {
      result = 'push'
      delta = 0
    } else {
      result = 'lose'
      delta = -player.bet
    }

    const finalBalance = Number((previousBalance + delta).toFixed(2))
    balances.set(player.playerToken, finalBalance)

    outcomes.push({
      playerToken: player.playerToken,
      nickname: player.nickname,
      result,
      delta: Number(delta.toFixed(2)),
      finalBalance
    })
  }

  const winners = outcomes
    .filter((outcome) => outcome.delta > 0)
    .map((outcome) => outcome.playerToken)

  return {
    balances,
    state: {
      ...state,
      phase: 'complete',
      outcome: {
        dealerValue: dealerValue.total,
        dealerBust: dealerValue.isBust,
        winners,
        outcomes
      },
      updatedAt: nowISO()
    }
  }
}

function proceedIfNoActive(
  state: BlackjackRoundState,
  balances: Map<string, number>
): { state: BlackjackRoundState; balances: Map<string, number> } {
  if (state.currentTurnToken) {
    return { state, balances }
  }

  state.phase = 'dealer_turn'
  state.dealerHand = resolveDealer([...state.dealerHand], state.deck)
  state.phase = 'settlement'

  return settleRound(state, balances)
}

export function startRound(
  roomId: string,
  roundNo: number,
  baseBet: number,
  participants: RoomPlayer[],
  balances: Map<string, number>
): { state: BlackjackRoundState; balances: Map<string, number> } {
  const deck = createShuffledDeck()
  const now = nowISO()

  const players: RoundPlayer[] = participants.map((participant) => {
    const currentBalance = balances.get(participant.player_token) ?? participant.balance
    const canEnterRound = participant.status === 'active' && currentBalance >= baseBet
    const hand = canEnterRound ? [draw(deck), draw(deck)] : []
    const value = getHandValue(hand)

    return {
      playerToken: participant.player_token,
      nickname: participant.nickname,
      hand,
      bet: canEnterRound ? baseBet : 0,
      state: !canEnterRound ? 'out' : value.isBlackjack ? 'blackjack' : 'active',
      canDouble: canEnterRound,
      lastActionAt: now
    }
  })

  const dealerHand = [draw(deck), draw(deck)]
  const currentTurnToken = nextActiveTurn(players)

  const baseState: BlackjackRoundState = {
    roomId,
    roundNo,
    phase: 'player_turns',
    deck,
    dealerHand,
    players,
    currentTurnToken,
    actionHistory: [],
    outcome: null,
    startedAt: now,
    updatedAt: now
  }

  setCurrentTurn(baseState.players, baseState.currentTurnToken)

  return proceedIfNoActive(baseState, balances)
}

function markPlayerHandState(player: RoundPlayer): RoundPlayer {
  const value = getHandValue(player.hand)

  if (player.state === 'disconnected' || player.state === 'out') {
    return player
  }

  if (value.isBust) {
    return { ...player, state: 'bust', canDouble: false, lastActionAt: nowISO() }
  }

  if (value.isBlackjack) {
    return { ...player, state: 'blackjack', canDouble: false, lastActionAt: nowISO() }
  }

  return player
}

export function canPlayerAct(state: BlackjackRoundState, playerToken: string): boolean {
  return state.phase === 'player_turns' && state.currentTurnToken === playerToken
}

export function applyAction(
  previous: BlackjackRoundState,
  balances: Map<string, number>,
  playerToken: string,
  action: TurnAction
): { state: BlackjackRoundState; balances: Map<string, number> } {
  if (previous.phase !== 'player_turns') {
    throw new Error('현재는 플레이어 행동 단계가 아닙니다.')
  }

  if (previous.currentTurnToken !== playerToken) {
    throw new Error('현재 턴의 플레이어가 아닙니다.')
  }

  const state: BlackjackRoundState = {
    ...previous,
    deck: [...previous.deck],
    dealerHand: [...previous.dealerHand],
    players: previous.players.map((player) => ({ ...player, hand: [...player.hand] })),
    actionHistory: [...previous.actionHistory],
    updatedAt: nowISO()
  }

  const playerIndex = state.players.findIndex((player) => player.playerToken === playerToken)
  if (playerIndex < 0) {
    throw new Error('플레이어를 찾을 수 없습니다.')
  }

  const player = state.players[playerIndex]
  if (player.state !== 'active') {
    throw new Error('이미 행동이 종료된 플레이어입니다.')
  }

  if (action === 'hit') {
    const actionAt = nowISO()
    player.hand.push(draw(state.deck))
    const nextState = markPlayerHandState({ ...player, lastActionAt: actionAt })
    state.players[playerIndex] = nextState

    if (nextState.state !== 'active') {
      state.currentTurnToken = nextActiveTurn(state.players, playerIndex + 1)
      setCurrentTurn(state.players, state.currentTurnToken)
    }
  } else if (action === 'stand') {
    state.players[playerIndex] = {
      ...player,
      state: 'stand',
      canDouble: false,
      lastActionAt: nowISO()
    }
    state.currentTurnToken = nextActiveTurn(state.players, playerIndex + 1)
    setCurrentTurn(state.players, state.currentTurnToken)
  } else if (action === 'double') {
    const currentBalance = balances.get(player.playerToken) ?? 0
    if (!player.canDouble || player.hand.length !== 2 || currentBalance < player.bet * 2) {
      throw new Error('더블 조건을 만족하지 않습니다.')
    }

    const updated = {
      ...player,
      bet: player.bet * 2,
      canDouble: false
    }

    updated.hand.push(draw(state.deck))
    const evaluated = markPlayerHandState(updated)
    state.players[playerIndex] = {
      ...evaluated,
      state: evaluated.state === 'active' ? 'stand' : evaluated.state,
      lastActionAt: nowISO()
    }

    state.currentTurnToken = nextActiveTurn(state.players, playerIndex + 1)
    setCurrentTurn(state.players, state.currentTurnToken)
  }

  state.actionHistory.push({ at: nowISO(), playerToken, action })

  return proceedIfNoActive(state, balances)
}

export function markDisconnected(
  previous: BlackjackRoundState,
  balances: Map<string, number>,
  disconnectedTokens: string[]
): { state: BlackjackRoundState; balances: Map<string, number> } {
  const disconnected = new Set(disconnectedTokens)
  const state: BlackjackRoundState = {
    ...previous,
    deck: [...previous.deck],
    dealerHand: [...previous.dealerHand],
    players: previous.players.map((player) => ({ ...player, hand: [...player.hand] })),
    actionHistory: [...previous.actionHistory],
    updatedAt: nowISO()
  }

  let changed = false

  state.players = state.players.map((player) => {
    if (disconnected.has(player.playerToken) && player.state === 'active') {
      changed = true
      state.actionHistory.push({
        at: nowISO(),
        playerToken: player.playerToken,
        action: 'auto-stand-disconnect'
      })
      return {
        ...player,
        state: 'disconnected',
        canDouble: false,
        lastActionAt: nowISO()
      }
    }

    return player
  })

  if (!changed) {
    return { state: previous, balances }
  }

  if (state.currentTurnToken && disconnected.has(state.currentTurnToken)) {
    const currentIndex = state.players.findIndex(
      (player) => player.playerToken === state.currentTurnToken
    )
    state.currentTurnToken = nextActiveTurn(state.players, currentIndex + 1)
    setCurrentTurn(state.players, state.currentTurnToken)
  }

  return proceedIfNoActive(state, balances)
}
