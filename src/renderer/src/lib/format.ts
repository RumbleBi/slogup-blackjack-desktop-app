import type { Card } from '@renderer/types/domain'

const SUIT_SYMBOL: Record<Card['suit'], string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣'
}

export function formatCurrency(value: number): string {
  return `${value.toFixed(2)}$`
}

export function formatCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}
