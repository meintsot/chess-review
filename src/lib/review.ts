import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js'
import { EnginePool, type EngineResult, type RawScore } from './engine'
import { estimateRating, gameAccuracy, moveAccuracy, speedOf } from './accuracy'
import { accuracySlope, expectedPoints, fromChessComScale, labelSlope, toChessComScale, type RatingSource } from './expectedPoints'
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
  bestLineUci: string[]
  replyLineSan: string[] // opponent's best continuation after the move
  replyLineUci: string[]
  winBefore: number // mover's expected score %, rating-aware
  winAfter: number
  loss: number // expected points lost, 0..1
  accuracy: number
  cls: Classification
  opening?: string
  comment: string
  /** Raw signals behind the label, used to calibrate against chess.com (scripts/calibrate.ts). */
  features?: Record<string, number | boolean | string>
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

function parseGame(pgn: string) {
  const game = new Chess()
  game.loadPgn(pgn)
  const headers = game.getHeaders()
  const history = game.history({ verbose: true })
  if (!history.length) throw new Error('This game has no moves.')
  const startFen = history[0].before
  const fens = [startFen, ...history.map(m => m.after)]
  const terminal = fens.map(f => {
    const c = new Chess(f)
    if (c.isCheckmate()) return { mated: c.turn() } as Score
    if (c.isStalemate() || c.isInsufficientMaterial()) return { draw: true } as Score
    return null
  })
  return { headers, history, startFen, fens, terminal }
}

export async function reviewGame(
  pgn: string,
  depth: number,
  onProgress: (done: number, total: number) => void,
): Promise<GameReview> {
  const { history, startFen, fens, terminal } = parseGame(pgn)
  const book = await loadBook()

  // Engine: every position from the start through the final one.
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
  return buildReview(pgn, results, book, depth)
}

/** Classify every move from engine results (one per position, terminal positions left empty). */
export function buildReview(pgn: string, results: EngineResult[], book: Record<string, string>, depth: number): GameReview {
  const { headers, history, startFen, fens, terminal } = parseGame(pgn)
  const site = (headers.Site ?? '').toLowerCase()
  const source: RatingSource = site.includes('chess.com') ? 'chess.com' : site.includes('lichess') ? 'lichess' : 'other'
  const rating = {
    w: toChessComScale(Number(headers.WhiteElo), source),
    b: toChessComScale(Number(headers.BlackElo), source),
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
    const ep = (s: Score) => expectedPoints(s, mover, labelSlope(R))
    const epAcc = (s: Score) => expectedPoints(s, mover, accuracySlope(R))
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
    const accLoss = played === bestUci ? 0 : Math.max(0, epAcc(scoreTop) - epAcc(scorePlayed))

    const opening = book[bookKey(m.after)]
    inBook = inBook && opening !== undefined

    let cls: Classification
    if (before.moves().length === 1) cls = 'forced'
    else if (inBook) cls = 'book'
    else if (after.isCheckmate() || isBest || loss <= BEST_EPSILON) cls = 'best'
    else cls = pointLossClass(subjective(scoreTop, mover), subjective(scorePlayed, mover), loss)

    // Shared gate for Great and Brilliant (chess.com: not when completely winning anyway, not when
    // losing afterwards; the open-source clones also skip check evasions and promotions).
    const curSubj = subjective(scorePlayed, mover)
    const secondSubj = scoreSecond && subjective(scoreSecond, mover)
    const winningAnyway = secondSubj ? secondSubj.value >= 700 : curSubj.value >= 700
    const candidate = !inBook && cls !== 'forced' && !after.isCheckmate() && !winningAnyway && curSubj.value >= 0 && !before.inCheck()

    // Brilliant (fitted on scraped chess.com reviews): a real sacrifice that stands out from the next-best
    // option (≥ 0.05 lost) and leaves you clearly better (≥ +1.00). Sacrifices in level positions or that
    // are one of several good moves get Best/Great on chess.com.
    let sacrificed: Piece[] = []
    const standsOut = !!scoreSecond && epBefore - ep(scoreSecond) >= 0.05
    if (candidate && isBest && standsOut && curSubj.value >= 100 && !m.promotion) sacrificed = sacrificedPieces(before, after, m)
    if (sacrificed.length) {
      cls = 'brilliant'
    } else if (!inBook && cls === 'best' && isBest && !after.isCheckmate() && scoreSecond && epBefore > 0.35) {
      // Great, as chess.com labels it (fitted on scraped reviews): the engine move when the next-best
      // option loses ≥ 0.10. Check evasions and winning positions qualify; recaptures and grabbing
      // material that was simply hanging do not.
      const prev = history[i - 1]
      const recapture = !!(prev?.captured && m.captured && prev.to === m.to)
      const freeCapture = !!m.captured && !isSafe(before, { square: capturedSquare(m), type: m.captured, color: other(mover) })
      if (epBefore - ep(scoreSecond) > greatThreshold(R) && !recapture && !freeCapture) cls = 'great'
    }

    // Miss: the opponent just erred and this move let the chance slip (without losing more than that).
    const prevReview = moves[i - 1]
    // Judged on expected points rather than the label, so the opponent's error counts from ~0.08 lost and
    // missing a forced mate counts even when the move played still wins.
    // chess.com: a Miss is failing to take a *winning* chance the opponent offered.
    // Fitted (cross-validated on two independent sets of scraped chess.com reviews): the opponent's last
    // move lost > 0.08, this one loses > 0.08 (or throws away a forced mate) but the position doesn't
    // collapse (> 15% expected score left).
    if (prevReview && prevReview.loss > 0.08 && !['best', 'brilliant', 'great', 'forced', 'book'].includes(cls)) {
      const missedMate = (subjective(scoreTop, mover).mate ?? 0) > 0 && !((curSubj.mate ?? 0) > 0)
      if ((loss > 0.08 && epAfter > 0.15) || missedMate) cls = 'miss'
    }

    const prevMove = history[i - 1]
    const sacAny = !sacrificed.length && (isBest || loss < 0.03) && !m.promotion && !after.isCheckmate() ? sacrificedPieces(before, after, m) : sacrificed
    const features = {
      base: pointLossClass(subjective(scoreTop, mover), subjective(scorePlayed, mover), loss),
      isBest, loss, epBefore, epAfter, R, ply: i + 1,
      cur: curSubj.value, curMate: curSubj.mate ?? 0, topMate: subjective(scoreTop, mover).mate ?? 0,
      second: secondSubj ? secondSubj.value : NaN, secondGap: scoreSecond ? epBefore - ep(scoreSecond) : NaN,
      inCheck: before.inCheck(), promo: m.promotion ?? '', capture: m.captured ?? '',
      recapture: !!(prevMove?.captured && m.captured && prevMove.to === m.to),
      freeCapture: !!m.captured && !isSafe(before, { square: capturedSquare(m), type: m.captured, color: other(mover) }),
      sacValue: sacAny.reduce((a, p) => Math.max(a, VALUE[p.type]), 0),
      prevLoss: moves[i - 1]?.loss ?? 0, prevCls: moves[i - 1]?.cls ?? '',
      epBeforeTheirError: i > 0 ? ep(scores[i - 1]) : NaN,
      inBook,
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
      bestLineUci: (res?.lines[0]?.pv ?? []).slice(0, 10),
      replyLineSan,
      replyLineUci: replyPv.slice(0, 10),
      winBefore: epBefore * 100,
      winAfter: epAfter * 100,
      loss,
      accuracy: moveAccuracy(accLoss),
      cls,
      opening: opening || undefined,
      comment: '',
      features,
    }
    review.comment = explain(review, { sacrificed, res, replyPv, secondSan: second ? sanLine(m.before, second.pv, 1)[0] : undefined, after })
    moves.push(review)
  }

  const accuracy = { w: gameAccuracy(moves, 'w'), b: gameAccuracy(moves, 'b') }
  const speed = speedOf(headers.TimeControl)
  const est = (c: 'w' | 'b', elo?: string) =>
    Math.round(fromChessComScale(estimateRating(accuracy[c], speed, elo ? rating[c] : undefined), source) / 50) * 50
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
    accuracy,
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
  // Walking into a mate is judged by expected points like anything else: chess.com calls it only a
  // mistake when the position was already lost.
  return lossClass(loss)
}

function lossClass(loss: number): Classification {
  if (loss < 0.02) return 'excellent'
  if (loss < 0.05) return 'good'
  if (loss < 0.1) return 'inaccuracy'
  if (loss < 0.2) return 'mistake'
  return 'blunder'
}

// chess.com's table says Best is 0.00 loss; in its reviews moves that lose ~nothing also get Best.
const BEST_EPSILON = 0

/** How much worse the next-best move must be for "only move" (Great). */
function greatThreshold(_rating: number) {
  return 0.1
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
