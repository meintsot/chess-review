import type { RawScore } from './engine'

/** Evaluation from White's point of view. `mated` = the game ended in checkmate. */
export type Score = { cp: number } | { mate: number } | { mated: 'w' | 'b' } | { draw: true }

export function toWhitePov(s: RawScore, sideToMove: 'w' | 'b'): Score {
  const sign = sideToMove === 'w' ? 1 : -1
  return 'mate' in s ? { mate: s.mate * sign } : { cp: s.cp * sign }
}

/** Centipawns clamped like Lichess (mate counts as ±1000). */
export function scoreCp(s: Score): number {
  if ('cp' in s) return Math.max(-1000, Math.min(1000, s.cp))
  if ('mate' in s) return s.mate >= 0 ? 1000 : -1000
  if ('mated' in s) return s.mated === 'b' ? 1000 : -1000
  return 0
}

/** Lichess win% (0..100) for White. */
export function winPercent(s: Score): number {
  if ('mated' in s) return s.mated === 'b' ? 100 : 0
  const cp = scoreCp(s)
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export function formatScore(s: Score): string {
  if ('draw' in s) return '½-½'
  if ('mated' in s) return s.mated === 'b' ? '1-0' : '0-1'
  if ('mate' in s) return `${s.mate > 0 ? '' : '-'}M${Math.abs(s.mate)}`
  const v = s.cp / 100
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`
}

/** Eval bar fill for White, 0..1 (mates pinned to the ends). */
export function barFraction(s: Score): number {
  if ('mated' in s) return s.mated === 'b' ? 1 : 0
  if ('mate' in s) return s.mate > 0 ? 1 : 0
  return winPercent(s) / 100
}
