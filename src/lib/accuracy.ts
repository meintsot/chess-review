// Port of Lichess's AccuracyPercent: per-move accuracy from win% drop, and game accuracy as the
// average of a volatility-weighted mean and a harmonic mean.

export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100
  const raw = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669 + 1 // +1 uncertainty bonus
  return Math.max(0, Math.min(100, raw))
}

function stdDev(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length)
}

/** whiteWins: White win% for the start position followed by every position after each ply. */
export function gameAccuracy(whiteWins: number[], whiteMovesFirst: boolean): { w: number; b: number } {
  const plies = whiteWins.length - 1
  if (plies < 1) return { w: 100, b: 100 }
  const windowSize = Math.max(2, Math.min(8, Math.floor(plies / 10)))
  const windows: number[][] = []
  for (let i = 0; i < Math.min(windowSize, whiteWins.length) - 2; i++) windows.push(whiteWins.slice(0, windowSize))
  for (let i = 0; i + windowSize <= whiteWins.length; i++) windows.push(whiteWins.slice(i, i + windowSize))
  const weights = windows.map(w => Math.max(0.5, Math.min(12, stdDev(w))))

  const per: Record<'w' | 'b', { acc: number; weight: number }[]> = { w: [], b: [] }
  for (let i = 0; i < plies; i++) {
    const white = (i % 2 === 0) === whiteMovesFirst
    const [prev, next] = [whiteWins[i], whiteWins[i + 1]]
    const acc = white ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next)
    per[white ? 'w' : 'b'].push({ acc, weight: weights[i] ?? 1 })
  }
  const combine = (xs: { acc: number; weight: number }[]) => {
    if (!xs.length) return 100
    const weighted = xs.reduce((a, x) => a + x.acc * x.weight, 0) / xs.reduce((a, x) => a + x.weight, 0)
    const harmonic = xs.length / xs.reduce((a, x) => a + 1 / Math.max(1, x.acc), 0)
    return (weighted + harmonic) / 2
  }
  return { w: combine(per.w), b: combine(per.b) }
}
