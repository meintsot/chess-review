// Static piece-safety analysis used to recognise real sacrifices (Brilliant) and free captures (not Great).
// Same ideas as the open-source chess.com-style classifiers: count attackers and defenders including
// x-ray batteries, treat cheaper attackers as decisive, and ignore pieces that were lost anyway.
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js'

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }

export interface Piece {
  square: Square
  type: PieceSymbol
  color: Color
}

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')

function withTurn(fen: string, color: Color) {
  const f = fen.split(' ')
  f[1] = color
  f[3] = '-'
  return f.join(' ')
}

/** Pieces of `by` that attack `sq`, including x-ray attackers lined up behind them. */
export function attackersOf(board: Chess, sq: Square, by: Color, xray = true): Piece[] {
  const b = new Chess(board.fen())
  const out: Piece[] = []
  for (;;) {
    const found = b.attackers(sq, by).filter(s => !out.some(p => p.square === s))
    if (!found.length) break
    for (const s of found) {
      const p = b.get(s)!
      out.push({ square: s, type: p.type, color: p.color })
    }
    if (!xray) break
    for (const s of found) if (b.get(s)?.type !== 'k') b.remove(s)
  }
  return out
}

export function isSafe(board: Chess, piece: Piece): boolean {
  const enemy = other(piece.color)
  const defenders = attackersOf(board, piece.square, piece.color)
  // A king can only take an undefended piece.
  const usable = (xs: Piece[]) => (defenders.length ? xs.filter(a => a.type !== 'k') : xs)
  const direct = usable(attackersOf(board, piece.square, enemy, false))
  if (!direct.length) return true
  if (direct.some(a => VALUE[a.type] < VALUE[piece.type])) return false
  const attackers = usable(attackersOf(board, piece.square, enemy))
  if (attackers.length <= defenders.length) return true
  const cheapest = Math.min(...direct.map(a => VALUE[a.type]))
  if (VALUE[piece.type] < cheapest && defenders.some(d => VALUE[d.type] < cheapest)) return true
  return defenders.some(d => d.type === 'p')
}

/** Non-pawn pieces of `color` that can be won, ignoring anything worth less than what was just captured. */
export function unsafePieces(board: Chess, color: Color, captured?: PieceSymbol): Piece[] {
  const floor = captured ? VALUE[captured] : 0
  const out: Piece[] = []
  for (const row of board.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'p' || p.type === 'k' || VALUE[p.type] <= floor) continue
      const piece = { square: p.square, type: p.type, color: p.color }
      if (!isSafe(board, piece)) out.push(piece)
    }
  }
  return out
}

/** Unsafe where it stands and on every square it can flee to. */
export function isTrapped(board: Chess, piece: Piece): boolean {
  if (isSafe(board, piece)) return false
  let b: Chess
  try {
    b = new Chess(withTurn(board.fen(), piece.color))
  } catch {
    return false
  }
  return b.moves({ square: piece.square, verbose: true }).every(m => {
    if (m.captured === 'k') return false
    b.move(m)
    const safe = isSafe(b, { ...piece, square: m.to })
    b.undo()
    return !safe
  })
}

/** Taking `piece` hands the mover something at least as good back (a bigger piece hangs, or mate in one). */
function captureBackfires(board: Chess, piece: Piece): boolean {
  const capturer = other(piece.color)
  let b: Chess
  try {
    b = new Chess(withTurn(board.fen(), capturer))
  } catch {
    return false
  }
  const captures = b.moves({ verbose: true }).filter(m => m.to === piece.square)
  if (!captures.length) return false
  return captures.every(m => {
    b.move(m)
    const exposed = unsafePieces(b, capturer).some(p => p.square !== piece.square && VALUE[p.type] >= VALUE[piece.type])
    const mateInOne = piece.type !== 'q' && b.moves({ verbose: true }).some(r => r.san.endsWith('#'))
    b.undo()
    return exposed || mateInOne
  })
}

/** The piece(s) a move genuinely sacrifices, or [] when it is not a sacrifice. */
export function sacrificedPieces(before: Chess, after: Chess, move: Move): Piece[] {
  const mover = move.color
  const prevUnsafe = unsafePieces(before, mover)
  const unsafe = unsafePieces(after, mover, move.captured)
  if (!unsafe.length) return []
  // Rescuing a hanging piece is not a sacrifice.
  if (!after.inCheck() && unsafe.length < prevUnsafe.length) return []
  // Pseudo-sacrifices: grabbing any of them loses at least as much straight back.
  if (unsafe.every(p => captureBackfires(after, p))) return []
  // Pieces that were going to be lost anyway (trapped, or the moved piece was already trapped).
  const prevTrapped = prevUnsafe.filter(p => isTrapped(before, p))
  const trapped = unsafe.filter(p => isTrapped(after, p))
  if (trapped.length === unsafe.length || prevTrapped.some(p => p.square === move.from) || trapped.length < prevTrapped.length) return []
  return unsafe
}
