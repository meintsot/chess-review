/**
 * Per-move accuracy (0..100) from expected points lost. Same exponential shape as Lichess, with the decay
 * fitted to chess.com's official accuracies with the in-browser lite engine (≈3.5× harsher per point).
 */
export function moveAccuracy(loss: number): number {
  if (loss <= 0) return 100
  const raw = 103.1668 * Math.exp(-0.155 * loss * 100) - 3.1669 + 1
  return Math.max(0, Math.min(100, raw))
}

/**
 * Game accuracy: mostly the plain mean of move accuracies, partly the harmonic mean (fitted weights).
 * Forced moves (only one legal move) are left out, as chess.com does (RMSE vs chess.com 4.3 → 4.0).
 */
export function gameAccuracy(moves: { color: 'w' | 'b'; accuracy: number; cls: string }[], color: 'w' | 'b'): number {
  const xs = moves.filter(m => m.color === color && m.cls !== 'forced').map(m => m.accuracy)
  if (!xs.length) return 100
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const harmonic = xs.length / xs.reduce((a, x) => a + 1 / Math.max(1, x), 0)
  return 0.884 * mean + 0.116 * harmonic
}

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'daily'

/** Speed from a PGN TimeControl tag ("180+2", "600", "1/86400", "-"). */
export function speedOf(timeControl: string | undefined): Speed {
  if (!timeControl || timeControl === '-' || timeControl.includes('/')) return timeControl ? 'daily' : 'rapid'
  const [base, inc = '0'] = timeControl.split('+')
  const t = Number(base) + 40 * Number(inc)
  return t < 180 ? 'bullet' : t < 600 ? 'blitz' : 'rapid'
}

// Typical chess.com accuracy by rating (chess.com scale), fitted per time control on ~18k reviewed
// chess.com games pulled from the public API (official accuracies).
const TYPICAL: Record<Speed, [number, number]> = {
  bullet: [65.81, 0.00451],
  blitz: [63.41, 0.00673],
  rapid: [58.92, 0.01137],
  daily: [68.01, 0.00798],
}
/**
 * chess.com-style "Game Rating" (chess.com scale), fitted on 218 players from scraped chess.com reviews using
 * our own accuracy as input (RMSE 171, held-out 162–185): the rating, pulled slightly toward 2050, moved ~33 points per accuracy point above or below
 * what is typical at that rating and time control. Without a known rating, the rating at which this
 * accuracy would be typical.
 */
export function estimateRating(accuracy: number, speed: Speed, rating?: number): number {
  const [a, b] = TYPICAL[speed]
  if (!rating) return Math.max(100, Math.min(3200, (accuracy - a) / b))
  return Math.max(100, Math.min(3300, 0.914 * rating + 0.086 * 2052 + 32.9 * (accuracy - (a + b * rating))))
}
