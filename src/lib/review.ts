import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js'
import { EnginePool, type EngineResult } from './engine'
import { gameAccuracy, moveAccuracy } from './accuracy'
import { formatScore, toWhitePov, winPercent, type Score } from './score'

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
  winBefore: number // mover POV
  winAfter: number // mover POV
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
  depth: number
}

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }
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

/** Material change (for `color`) after playing up to `plies` of a line, measured at its lowest point
 *  once the line settles (we only look at positions after the opponent has moved). */
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

/** Biggest net material the side to move can grab right now (captures of non-pawns). */
function hangingLoss(c: Chess): { loss: number; square?: Square; piece?: PieceSymbol } {
  let best: { loss: number; square?: Square; piece?: PieceSymbol } = { loss: 0 }
  for (const m of c.moves({ verbose: true })) {
    if (!m.captured || m.captured === 'p') continue
    c.move(m)
    const canRecapture = c.moves({ verbose: true }).some(r => r.to === m.to)
    c.undo()
    const loss = VALUE[m.captured] - (canRecapture ? VALUE[m.piece] : 0)
    if (loss > best.loss) best = { loss, square: m.to, piece: m.captured }
  }
  return best
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
  const whiteWins = scores.map(winPercent)

  const moves: MoveReview[] = []
  let inBook = true
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    const mover = m.color
    const pov = (w: number) => (mover === 'w' ? w : 100 - w)
    const before = new Chess(m.before)
    const after = new Chess(m.after)
    const res = results[i]
    const bestUci = res?.lines[0]?.pv[0]
    const played = uciOf(m)
    const isBest = played === bestUci

    const winBefore = pov(whiteWins[i])
    const winAfter = isBest ? winBefore : pov(whiteWins[i + 1])
    const loss = Math.max(0, (winBefore - winAfter) / 100)
    const second = res?.lines[1]
    const winSecond = second ? pov(winPercent(toWhitePov(second.score, mover))) : undefined

    const opening = book[bookKey(m.after)]
    inBook = inBook && opening !== undefined

    let cls: Classification
    if (inBook) cls = 'book'
    else if (before.moves().length === 1) cls = 'forced'
    else if (isBest) cls = 'best'
    else if (loss < 0.02) cls = 'excellent'
    else if (loss < 0.05) cls = 'good'
    else if (loss < 0.1) cls = 'inaccuracy'
    else if (loss < 0.2) cls = 'mistake'
    else cls = 'blunder'

    // Brilliant: a (near-)best move that leaves real material en prise, without spoiling the position.
    const hang = hangingLoss(after)
    const gained = m.captured ? VALUE[m.captured] : 0
    const sacrifice = hang.loss - gained >= 2 && !after.isCheckmate()
    if ((cls === 'best' || (cls === 'excellent' && loss <= 0.01)) && sacrifice && winAfter >= 50 && m.piece !== 'k') {
      cls = 'brilliant'
    } else if (cls === 'best' && !after.isCheckmate() && winSecond !== undefined && (winBefore - winSecond) / 100 >= 0.15) {
      // Great: the only move that keeps the result; ignore obvious recaptures.
      const prev = history[i - 1]
      const recapture = prev?.captured && m.captured && prev.to === m.to
      if (!recapture) cls = 'great'
    }

    // Miss: the opponent just erred and this move let the chance slip (without losing more than that).
    const prevReview = moves[i - 1]
    if (prevReview && ['mistake', 'blunder', 'miss'].includes(prevReview.cls) && ['inaccuracy', 'mistake', 'blunder'].includes(cls)) {
      const beforeTheirError = 100 - prevReview.winBefore
      if (winBefore - beforeTheirError >= 10 && winAfter >= beforeTheirError - 5) cls = 'miss'
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
      scoreBefore: scores[i],
      scoreAfter: scores[i + 1],
      bestUci,
      bestSan: bestLineSan[0],
      bestLineSan,
      replyLineSan,
      winBefore,
      winAfter,
      loss,
      accuracy: moveAccuracy(winBefore, winAfter),
      cls,
      opening: opening || undefined,
      comment: '',
    }
    review.comment = explain(review, { hang, res, replyPv, winSecond, secondSan: second ? sanLine(m.before, second.pv, 1)[0] : undefined, after })
    moves.push(review)
  }

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
    accuracy: gameAccuracy(whiteWins, startFen.split(' ')[1] === 'w'),
    depth,
  }
}

interface ExplainCtx {
  hang: ReturnType<typeof hangingLoss>
  res?: EngineResult
  replyPv: string[]
  winSecond?: number
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
      const piece = ctx.hang.piece ? NAME[ctx.hang.piece] : 'material'
      return `A brilliant sacrifice! ${san} offers your ${piece}${ctx.hang.square ? ` on ${ctx.hang.square}` : ''}, but grabbing it doesn't work out for your opponent: ${line(r.replyLineSan)}.`
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
  const evalNote = `Eval ${formatScore(scoreBefore)} → ${formatScore(scoreAfter)}; your winning chances went from ${pct(r.winBefore)}% to ${pct(r.winAfter)}%.`
  return [...parts, evalNote].join(' ')
}
