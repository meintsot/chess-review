import { scoreCp, type Score } from './score'

/** Per-move accuracy (0..100) from the drop in expected score %, using Lichess's fitted curve. */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100
  const raw = 103.1668 * Math.exp(-0.04354 * (before - after)) - 3.1669 + 1 // +1 uncertainty bonus
  return Math.max(0, Math.min(100, raw))
}

/** chess.com-style game accuracy: a plain average of move accuracies ("school grade" scale, CAPS2-like). */
export function meanAccuracy(moves: { color: 'w' | 'b'; accuracy: number }[], color: 'w' | 'b'): number {
  const xs = moves.filter(m => m.color === color).map(m => m.accuracy)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 100
}

/**
 * Game-performance rating (Lichess scale) from average centipawn loss, the way chess.com shows a
 * "Game Rating". ACPL→Elo curve from the Lichess community estimate; when the player's rating is known
 * the estimate is anchored to it, so one sharp game doesn't swing it wildly.
 */
export function estimateRating(scores: Score[], color: 'w' | 'b', whiteFirst: boolean, knownRating?: number): number {
  let total = 0
  let n = 0
  for (let i = 0; i < scores.length - 1; i++) {
    const whiteToMove = (i % 2 === 0) === whiteFirst
    if ((color === 'w') !== whiteToMove) continue
    const before = scoreCp(scores[i])
    const after = scoreCp(scores[i + 1])
    total += Math.min(1000, Math.max(0, color === 'w' ? before - after : after - before))
    n++
  }
  const acpl = n ? total / n : 0
  const fromAcpl = 3100 * Math.exp(-0.01 * acpl)
  if (!knownRating) return fromAcpl
  const expectedAcpl = -100 * Math.log(Math.min(knownRating, 3100) / 3100)
  return knownRating * Math.exp(-0.005 * (acpl - expectedAcpl))
}
