import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js'
import { EnginePool, type EngineResult, type RawScore } from './engine'
import { estimateRating, meanAccuracy, moveAccuracy } from './accuracy'
import { expectedPoints, fromLichessScale, toLichessScale, type RatingSource } from './expectedPoints'
import { isSafe, other, sacrificedPieces, VALUE, type Piece } from './safety'
import { formatScore, toWhitePov, type Score } from './score'

export type Classification =
  | 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder'

export interface MoveReview {
  ply: number // 1-based
  color: 'w' | 'b'
  san: string
  uci: string
  from: Square
  to: Square
  fenBefore: string
  fenAfter: string
  scoreBefore: Score // best play from the position before (White POV)
  scoreAfter: Score // position after the move (White POV)
  bestUci?: string
  bestSan?: string
  bestLineSan: string[]
  replyLineSan: string[] // opponent's best continuation after the move
  winBefore: number // mover's expected score %, rating-aware
  winAfter: number
  loss: number // expected points lost, 0..1
  accuracy: number
  cls: Classification
  opening?: string
  comment: string
}

export interface GameReview {
  white: string
  black: string
  whiteElo?: string
  blackElo?: string
  result: string
  startFen: string
  opening?: string
  moves: MoveReview[]
  startScore: Score
  accuracy: { w: number; b: number }
  gameRating: { w: number; b: number }
  depth: number
}

const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

let bookPromise: Promise<Record<string, string>> | null = null
const loadBook = () => (bookPromise ??= fetch('/openings.json').then(r => r.json()))
const bookKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

const uciOf = (m: Move) => m.from + m.to + (m.promotion ?? '')

function sanLine(fen: string, uci: string[], max = 8): string[] {
  const c = new Chess(fen)
  const out: string[] = []
  for (const u of uci.slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san)
    } catch {
      break
    }
  }
  return out
}

function material(c: Chess, color: 'w' | 'b'): number {
  let sum = 0
  for (const row of c.board()) for (const p of row) if (p && p.type !== 'k') sum += p.color === color ? VALUE[p.type] : -VALUE[p.type]
  return sum
}

/** Material change (for `color`) after playing up to `plies` of a line. */
function lineMaterialSwing(fen: string, uci: string[], color: 'w' | 'b', plies = 6) {
  const c = new Chess(fen)
  const start = material(c, color)
  let last = 0
  const captured: { by: 'w' | 'b'; piece: PieceSymbol; square: Square; san: string }[] = []
  for (const u of uci.slice(0, plies)) {
    let m: Move
    try {
      m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
    } catch {
      break
    }
    if (m.captured) captured.push({ by: m.color, piece: m.captured, square: m.to, san: m.san })
    last = material(c, color) - start
  }
  return { swing: last, captured }
}

const pct = (n: number) => Math.round(n)

function describeLoss(swing: number) {
  if (swing >= 8) return 'the queen'
  if (swing >= 5) return 'a rook'
  if (swing >= 3) return 'a piece'
  if (swing >= 2) return 'material'
  return 'a pawn'
}

export async function reviewGame(
  pgn: string,
  depth: number,
  onProgress: (done: number, total: number) => void,
): Promise<GameReview> {
  const game = new Chess()
  game.loadPgn(pgn)
  const headers = game.getHeaders()
  const history = game.history({ verbose: true })
  if (!history.length) throw new Error('This game has no moves.')
  const startFen = history[0].before
  const book = await loadBook()

  const site = (headers.Site ?? '').toLowerCase()
  const source: RatingSource = site.includes('chess.com') ? 'chess.com' : site.includes('lichess') ? 'lichess' : 'other'
  const rating = {
    w: toLichessScale(Number(headers.WhiteElo), source),
    b: toLichessScale(Number(headers.BlackElo), source),
  }

  // Engine: every position from the start through the final one.
  const fens = [startFen, ...history.map(m => m.after)]
  const terminal = fens.map(f => {
    const c = new Chess(f)
    if (c.isCheckmate()) return { mated: c.turn() } as Score
    if (c.isStalemate() || c.isInsufficientMaterial()) return { draw: true } as Score
    return null
  })
  const pool = new EnginePool()
  const jobs = fens.map((_, i) => ({ startFen, moves: history.slice(0, i).map(uciOf), depth, multiPv: 2 }))
  const todo = jobs.map((j, i) => ({ j, i })).filter(({ i }) => !terminal[i])
  let results: EngineResult[]
  try {
    const raw = await pool.analyseAll(todo.map(t => t.j), d => onProgress(d, todo.length))
    results = new Array(fens.length)
    todo.forEach((t, k) => (results[t.i] = raw[k]))
  } finally {
    pool.terminate()
  }

  const scores: Score[] = fens.map((f, i) => {
    if (terminal[i]) return terminal[i]!
    const top = results[i].lines[0]
    if (!top) return { draw: true } // e.g. repetition / 50-move draw reported without a line
    return toWhitePov(top.score, f.split(' ')[1] as 'w' | 'b')
  })

  const moves: MoveReview[] = []
  let inBook = true
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    const mover = m.color
    const R = rating[mover]
    const ep = (s: Score) => expectedPoints(s, mover, R)
    const before = new Chess(m.before)
    const after = new Chess(m.after)
    const res = results[i]
    const bestUci = res?.lines[0]?.pv[0]
    const played = uciOf(m)

    // Judge the played move with the same search when it is one of the engine's lines (less depth noise).
    const playedLine = res?.lines.find(l => l.pv[0] === played)
    const scoreTop = scores[i]
    const scorePlayed = after.isCheckmate() || !playedLine ? scores[i + 1] : toWhitePov(playedLine.score, mover)
    const isBest = played === bestUci || (!!playedLine && sameScore(playedLine.score, res!.lines[0].score))
    const second = res?.lines.find(l => l.pv[0] !== bestUci)
    const scoreSecond = second ? toWhitePov(second.score, mover) : undefined

    const epBefore = ep(scoreTop)
    const epAfter = isBest ? epBefore : ep(scorePlayed)
    const loss = Math.max(0, epBefore - epAfter)

    const opening = book[bookKey(m.after)]
    inBook = inBook && opening !== undefined

    let cls: Classification
    if (before.moves().length === 1) cls = 'forced'
    else if (inBook) cls = 'book'
    else if (after.isCheckmate() || isBest) cls = 'best'
    else cls = pointLossClass(subjective(scoreTop, mover), subjective(scorePlayed, mover), loss, epBefore)

    // Shared gate for Great and Brilliant (chess.com: not when completely winning anyway, not when
    // losing afterwards; the open-source clones also skip check evasions and promotions).
    const curSubj = subjective(scorePlayed, mover)
    const secondSubj = scoreSecond && subjective(scoreSecond, mover)
    const winningAnyway = secondSubj ? secondSubj.value >= 700 : curSubj.value >= 700
    const candidate = !inBook && cls !== 'forced' && !after.isCheckmate() && !winningAnyway && curSubj.value >= 0 && !before.inCheck()

    let sacrificed: Piece[] = []
    const generous = R < 1500 // chess.com is more generous with Brilliant/Great for newer players
    const nearBest = isBest || loss < (generous ? 0.02 : 0.01)
    if (candidate && nearBest && !m.promotion) sacrificed = sacrificedPieces(before, after, m)
    if (sacrificed.length) {
      cls = 'brilliant'
    } else if (candidate && isBest && m.promotion !== 'q' && !(curSubj.mate && curSubj.mate > 0) && scoreSecond) {
      const prev = history[i - 1]
      const recapture = !!(prev?.captured && m.captured && prev.to === m.to)
      const freeCapture = !!m.captured && !isSafe(before, { square: capturedSquare(m), type: m.captured, color: other(mover) })
      const onlyMove = epBefore - ep(scoreSecond) >= greatThreshold(R)
      if (onlyMove && !recapture && !freeCapture) cls = 'great'
    }

    // Miss: the opponent just erred and this move let the chance slip (without losing more than that).
    const prevReview = moves[i - 1]
    if (prevReview && ['mistake', 'blunder', 'miss'].includes(prevReview.cls) && ['inaccuracy', 'mistake', 'blunder'].includes(cls)) {
      const beforeTheirError = ep(scores[i - 1])
      if (epBefore - beforeTheirError >= 0.1 && epAfter <= beforeTheirError + 0.05 && epAfter >= beforeTheirError - 0.15) cls = 'miss'
    }

    const bestLineSan = res ? sanLine(m.before, res.lines[0]?.pv ?? []) : []
    const replyPv = results[i + 1]?.lines[0]?.pv ?? []
    const replyLineSan = sanLine(m.after, replyPv)

    const review: MoveReview = {
      ply: i + 1,
      color: mover,
      san: m.san,
      uci: played,
      from: m.from,
      to: m.to,
      fenBefore: m.before,
      fenAfter: m.after,
      scoreBefore: scoreTop,
      scoreAfter: scores[i + 1],
      bestUci,
      bestSan: bestLineSan[0],
      bestLineSan,
      replyLineSan,
      winBefore: epBefore * 100,
      winAfter: epAfter * 100,
      loss,
      accuracy: moveAccuracy(epBefore * 100, epAfter * 100),
      cls,
      opening: opening || undefined,
      comment: '',
    }
    review.comment = explain(review, { sacrificed, res, replyPv, secondSan: second ? sanLine(m.before, second.pv, 1)[0] : undefined, after })
    moves.push(review)
  }

  const est = (c: 'w' | 'b', elo?: string) =>
    Math.round(fromLichessScale(estimateRating(scores, c, startFen.split(' ')[1] === 'w', elo ? rating[c] : undefined), source) / 50) * 50
  const openingName = [...moves].reverse().find(m => m.opening)?.opening ?? headers.Opening
  return {
    white: headers.White ?? 'White',
    black: headers.Black ?? 'Black',
    whiteElo: headers.WhiteElo,
    blackElo: headers.BlackElo,
    result: headers.Result ?? '*',
    startFen,
    opening: openingName,
    moves,
    startScore: scores[0],
    accuracy: { w: meanAccuracy(moves, 'w'), b: meanAccuracy(moves, 'b') },
    gameRating: { w: est('w', headers.WhiteElo), b: est('b', headers.BlackElo) },
    depth,
  }
}

const sameScore = (a: RawScore, b: RawScore) =>
  'mate' in a ? 'mate' in b && a.mate === b.mate : 'cp' in b && Math.abs(a.cp - b.cp) <= 2

const capturedSquare = (m: Move): Square => (m.isEnPassant() ? ((m.to[0] + m.from[1]) as Square) : m.to)

/** Score from the mover's point of view: `value` in cp (mates count as ±10000), `mate` > 0 = mover mates. */
function subjective(s: Score, color: 'w' | 'b'): { value: number; mate?: number } {
  const sign = color === 'w' ? 1 : -1
  if ('mated' in s) return s.mated === color ? { value: -10000, mate: -0.5 } : { value: 10000, mate: 0.5 }
  if ('draw' in s) return { value: 0 }
  if ('mate' in s) return { value: Math.sign(s.mate * sign) * 10000, mate: s.mate * sign }
  return { value: s.cp * sign }
}

/** chess.com's expected-points table, with mate transitions handled the way the open-source clones do. */
function pointLossClass(
  prev: { value: number; mate?: number },
  cur: { value: number; mate?: number },
  loss: number,
  epBefore: number,
): Classification {
  if (prev.mate !== undefined && cur.mate !== undefined) {
    if (prev.mate > 0 && cur.mate < 0) return cur.mate < -3 ? 'mistake' : 'blunder'
    const mateLoss = cur.mate - prev.mate // > 0: the winner's mate got longer / the loser's got shorter
    if (mateLoss < 0 || (mateLoss === 0 && cur.mate < 0)) return 'best'
    if (mateLoss < 2) return 'excellent'
    if (mateLoss < 7) return 'good'
    return 'inaccuracy'
  }
  if (prev.mate !== undefined && prev.mate > 0) {
    if (cur.value >= 800) return 'excellent'
    if (cur.value >= 400) return 'good'
    if (cur.value >= 200) return 'inaccuracy'
    if (cur.value >= 0) return 'mistake'
    return 'blunder'
  }
  if (prev.mate === undefined && cur.mate !== undefined && epBefore > 0.05) {
    if (cur.mate > 0) return 'best'
    if (cur.mate >= -2) return 'blunder'
    if (cur.mate >= -5) return 'mistake'
    return 'inaccuracy'
  }
  if (loss < 0.02) return 'excellent'
  if (loss < 0.05) return 'good'
  if (loss < 0.1) return 'inaccuracy'
  if (loss < 0.2) return 'mistake'
  return 'blunder'
}

/** How much worse the next-best move must be for "only move" (Great); lower for newer players. */
function greatThreshold(lichessRating: number) {
  const t = (lichessRating - 1200) / 600
  return 0.08 + 0.02 * Math.max(0, Math.min(1, t))
}

interface ExplainCtx {
  sacrificed: Piece[]
  res?: EngineResult
  replyPv: string[]
  secondSan?: string
  after: Chess
}

function explain(r: MoveReview, ctx: ExplainCtx): string {
  const { san, bestSan, scoreBefore, scoreAfter } = r
  const mover = r.color
  const sign = mover === 'w' ? 1 : -1
  const mateFor = (s: Score) => ('mate' in s ? s.mate * sign : 0) // >0: mover mates, <0: mover gets mated
  const line = (xs: string[], n = 5) => xs.slice(0, n).join(' ')

  if (ctx.after.isCheckmate()) return `${san} is checkmate. Game over!`

  switch (r.cls) {
    case 'book':
      return `${san} is a book move${r.opening ? ` (${r.opening.replace(/^[A-E]\d\d /, '')})` : ''}.`
    case 'forced':
      return `${san} was the only legal move.`
    case 'brilliant': {
      const p = ctx.sacrificed.reduce((a, b) => (VALUE[b.type] > VALUE[a.type] ? b : a))
      return `A brilliant sacrifice! ${san} offers your ${NAME[p.type]} on ${p.square}, but grabbing it doesn't work out for your opponent: ${line(r.replyLineSan)}.`
    }
    case 'great':
      return `${san} is a great find — the only move that keeps your position${ctx.secondSan ? `. The next best try, ${ctx.secondSan}, is much worse` : ''}.`
    case 'best':
      if (mateFor(scoreAfter) > 0) return `${san} is the best move and leads to a forced mate in ${mateFor(scoreAfter)}.`
      return `${san} is the best move.`
    case 'excellent':
    case 'good':
      return `${san} is ${r.cls === 'excellent' ? 'excellent' : 'a good move'}. The engine's top choice was ${bestSan}.`
  }

  // Inaccuracy, mistake, miss, blunder: say *why* using the engine lines.
  const parts: string[] = []
  const matedIn = -mateFor(scoreAfter)
  const hadMate = mateFor(scoreBefore)
  if (r.cls === 'miss') parts.push(`You missed a chance to punish your opponent's mistake.`)
  if (matedIn > 0 && !(mateFor(scoreBefore) < 0)) {
    parts.push(`${san} allows a forced checkmate in ${matedIn}: ${line(r.replyLineSan, matedIn * 2)}.`)
  } else if (hadMate > 0 && mateFor(scoreAfter) <= 0) {
    parts.push(`You had a forced mate in ${hadMate} starting with ${bestSan}: ${line(r.bestLineSan, hadMate * 2 - 1)}.`)
  } else {
    const reply = lineMaterialSwing(r.fenAfter, ctx.replyPv, mover)
    const lost = reply.captured.find(c => c.by !== mover && VALUE[c.piece] >= 3)
    if (reply.swing <= -2 && lost) {
      parts.push(`${san} loses ${lost.piece === 'q' ? 'your queen' : `your ${NAME[lost.piece]}`} on ${lost.square} after ${line(r.replyLineSan, 4)}.`)
    } else if (reply.swing <= -1) {
      parts.push(`${san} drops ${describeLoss(-reply.swing)} after ${line(r.replyLineSan, 4)}.`)
    }
    const best = ctx.res?.lines[0]
    if (best && bestSan) {
      const gain = lineMaterialSwing(r.fenBefore, best.pv, mover)
      if (gain.swing >= 1 && r.cls !== 'inaccuracy') parts.push(`${bestSan} was stronger, winning ${describeLoss(gain.swing)}: ${line(r.bestLineSan)}.`)
      else parts.push(`Better was ${bestSan} (${line(r.bestLineSan, 4)}).`)
    }
  }
  const evalNote = `Eval ${formatScore(scoreBefore)} → ${formatScore(scoreAfter)}; your expected score went from ${pct(r.winBefore)}% to ${pct(r.winAfter)}%.`
  return [...parts, evalNote].join(' ')
}
