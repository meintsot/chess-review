// Rating-aware expected points, like chess.com's "Expected Points" model: the same engine eval is worth
// less to a weaker player because they convert advantages less reliably.
//
// k(rating) was fitted on ~1M positions from 80k evaluated, rated Lichess games (September 2026 dump,
// blitz/rapid/classical, players within 150 points): P(score) = 1 / (1 + e^(-k·cp)).
// Observed k per 200-point band rose from 0.0018 (≈700) to 0.0040 (≈2300); a linear fit tracks it.
import type { Score } from './score'

export type RatingSource = 'lichess' | 'chess.com' | 'other'

const K_SLOPE = 1.45e-6
const K_BASE = 6.0e-4
export const DEFAULT_RATING = 1500 // Lichess scale, used when the PGN has no rating

/** Convert a rating to the Lichess scale the curve was fitted on (common rule of thumb for chess.com). */
export function toLichessScale(rating: number | undefined, source: RatingSource): number {
  if (!rating || !Number.isFinite(rating)) return DEFAULT_RATING
  return source === 'chess.com' ? 0.75 * rating + 650 : rating
}

export function fromLichessScale(rating: number, source: RatingSource): number {
  return source === 'chess.com' ? (rating - 650) / 0.75 : rating
}

export function slopeFor(lichessRating: number): number {
  const r = Math.max(700, Math.min(2600, lichessRating))
  return K_SLOPE * r + K_BASE
}

/** Expected points (0..1) for `color` given a White-POV score. */
export function expectedPoints(s: Score, color: 'w' | 'b', lichessRating: number): number {
  let white: number
  if ('mated' in s) white = s.mated === 'b' ? 1 : 0
  else if ('draw' in s) white = 0.5
  else if ('mate' in s) white = s.mate > 0 ? 1 : 0
  else white = 1 / (1 + Math.exp(-slopeFor(lichessRating) * s.cp))
  return color === 'w' ? white : 1 - white
}
