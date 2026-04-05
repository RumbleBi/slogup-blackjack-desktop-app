const PLAYER_TOKEN_KEY = 'blackjack.playerToken'
const NICKNAME_KEY = 'blackjack.nickname'

export function getPlayerToken(): string {
  const existing = localStorage.getItem(PLAYER_TOKEN_KEY)
  if (existing) {
    return existing
  }

  const token = crypto.randomUUID()
  localStorage.setItem(PLAYER_TOKEN_KEY, token)
  return token
}

export function getStoredNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? ''
}

export function setStoredNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname)
}
