// Expected points, calibrated against chess.com's own Game Review output. Ratings are on the chess.com
// scale (Lichess ratings are converted with the usual rule of thumb lichess ≈ 0.75 × chess.com + 650).
//
// Two curves, because chess.com's numbers show two different behaviours:
//  - Move labels use a rating-aware curve (steeper for stronger players), fitted to ~3,800 moves from 51
//    scraped chess.com Game Reviews. On chess.com's own evals it reproduces 85% of their labels exactly,
//    and the published thresholds (.02/.05/.10/.20) come out as the best fit.
//  - Accuracy uses an almost rating-free curve fitted to chess.com's official accuracies on 560
//    reviewed games from 100 to 3000 (RMSE 4.8 points, no bias by rating band).
import type { Score } from './score'

export type RatingSource = 'lichess' | 'chess.com' | 'other'

export const DEFAULT_RATING = 1200

/** Player rating on the chess.com scale. */
export function toChessComScale(rating: number | undefined, source: RatingSource): number {
  if (!rating || !Number.isFinite(rating)) return DEFAULT_RATING
  return source === 'lichess' ? (rating - 650) / 0.75 : rating
}

export function fromChessComScale(rating: number, source: RatingSource): number {
  return source === 'lichess' ? 0.75 * rating + 650 : rating
}

const clampRating = (r: number) => Math.max(100, Math.min(3000, r))

/** Slope used for move labels. */
export function labelSlope(rating: number): number {
  return 1.75e-6 * clampRating(rating) + 2.0e-3
}

/** Slope used for accuracy. */
export function accuracySlope(rating: number): number {
  return 2.795e-3 - 1.925e-7 * clampRating(rating)
}

/** Expected points (0..1) for `color` given a White-POV score and a slope. */
export function expectedPoints(s: Score, color: 'w' | 'b', slope: number): number {
  let white: number
  if ('mated' in s) white = s.mated === 'b' ? 1 : 0
  else if ('draw' in s) white = 0.5
  else if ('mate' in s) white = s.mate > 0 ? 1 : 0
  else white = 1 / (1 + Math.exp(-slope * s.cp))
  return color === 'w' ? white : 1 - white
}
