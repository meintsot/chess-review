// Board helpers for the tactical-motif detectors in motifs.ts.
//
// Ported from the Lichess puzzle tagger: ornicar/lichess-puzzler, tagger/util.py (AGPL-3.0),
// https://github.com/ornicar/lichess-puzzler/tree/master/tagger
// The python-chess primitives it relies on (attacks, attackers, pin masks, between/ray masks) are
// re-implemented here on a small mailbox board; chess.js is only used for legal moves and mate.
//
// Squares are numbered like python-chess: a1 = 0, b1 = 1, ..., h8 = 63.
import { Chess, type Square } from 'chess.js'

export type Color = 'w' | 'b'
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export interface Piece {
  type: PieceType
  color: Color
}

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
export const fileOf = (s: number): number => s & 7
export const rankOf = (s: number): number => s >> 3
export const squareAt = (file: number, rank: number): number => rank * 8 + file
export const distance = (a: number, b: number): number =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)))

export function parseSquare(name: string): number {
  const f = name.charCodeAt(0) - 97
  const r = name.charCodeAt(1) - 49
  if (f < 0 || f > 7 || r < 0 || r > 7 || name.length !== 2) throw new Error(`bad square ${name}`)
  return squareAt(f, r)
}
export const squareName = (s: number): string =>
  String.fromCharCode(97 + fileOf(s)) + String.fromCharCode(49 + rankOf(s))

/** util.values: material values (no king). */
export const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
/** util.king_values: material values with the king worth 99. */
export const KING_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 }
/** python-chess PieceType integers (PAWN = 1 ... KING = 6); used where upstream compares against them. */
export const PIECE_TYPE_INDEX: Record<PieceType, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 }
export const isRayType = (t: PieceType): boolean => t === 'q' || t === 'r' || t === 'b'

const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const KNIGHT_JUMPS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
const KING_STEPS: [number, number][] = [...ROOK_DIRS, ...BISHOP_DIRS]

const onBoard = (f: number, r: number): boolean => f >= 0 && f < 8 && r >= 0 && r < 8

/** Unit direction from a to b if they share a rank, file or diagonal; null otherwise (or if a == b). */
export function direction(a: number, b: number): [number, number] | null {
  if (a === b) return null
  const df = fileOf(b) - fileOf(a)
  const dr = rankOf(b) - rankOf(a)
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return null
  return [Math.sign(df), Math.sign(dr)]
}

/** SquareSet.between(a, b): squares strictly between two aligned squares (empty if not aligned). */
export function between(a: number, b: number): number[] {
  const d = direction(a, b)
  if (!d) return []
  const out: number[] = []
  let f = fileOf(a) + d[0]
  let r = rankOf(a) + d[1]
  while (squareAt(f, r) !== b) {
    out.push(squareAt(f, r))
    f += d[0]
    r += d[1]
  }
  return out
}

/** BB_RAYS[a][b]: the whole line (edge to edge) through two aligned squares; empty if not aligned. */
export function ray(a: number, b: number): Set<number> {
  const out = new Set<number>()
  const d = direction(a, b)
  if (!d) return out
  out.add(a)
  for (const s of [1, -1]) {
    let f = fileOf(a) + d[0] * s
    let r = rankOf(a) + d[1] * s
    while (onBoard(f, r)) {
      out.add(squareAt(f, r))
      f += d[0] * s
      r += d[1] * s
    }
  }
  return out
}

/** Can a piece of this type slide along direction d? */
export function slidesAlong(t: PieceType, d: [number, number]): boolean {
  const diagonal = d[0] !== 0 && d[1] !== 0
  return t === 'q' || (diagonal ? t === 'b' : t === 'r')
}

export interface PinInfo {
  /** Full line through the king (or shielded piece) and the pinner (python-chess pin mask). */
  ray: Set<number>
  pinner: number
  /** The piece the pinned piece is shielding (the king for absolute pins). */
  behind: number
}

export class Board {
  readonly squares: (Piece | null)[]
  readonly turn: Color

  constructor(squares: (Piece | null)[], turn: Color) {
    this.squares = squares
    this.turn = turn
  }

  static fromFen(fen: string): Board {
    const [placement, turn] = fen.split(' ')
    const squares: (Piece | null)[] = new Array<Piece | null>(64).fill(null)
    const rows = placement.split('/')
    for (let i = 0; i < 8; i++) {
      let f = 0
      for (const ch of rows[i] ?? '') {
        if (ch >= '1' && ch <= '8') {
          f += Number(ch)
        } else {
          const lower = ch.toLowerCase() as PieceType
          squares[squareAt(f, 7 - i)] = { type: lower, color: ch === lower ? 'b' : 'w' }
          f++
        }
      }
    }
    return new Board(squares, turn === 'b' ? 'b' : 'w')
  }

  pieceAt(s: number): Piece | null {
    return this.squares[s] ?? null
  }

  /** Occupied squares with their pieces, ascending square order. */
  pieces(): [number, Piece][] {
    const out: [number, Piece][] = []
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s]
      if (p) out.push([s, p])
    }
    return out
  }

  piecesOf(type: PieceType, color: Color): number[] {
    const out: number[] = []
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s]
      if (p && p.type === type && p.color === color) out.push(s)
    }
    return out
  }

  king(color: Color): number | null {
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s]
      if (p && p.type === 'k' && p.color === color) return s
    }
    return null
  }

  /** board.attacks(square): squares attacked by the piece on `from` (empty if none). */
  attacks(from: number): number[] {
    const p = this.squares[from]
    if (!p) return []
    const f0 = fileOf(from)
    const r0 = rankOf(from)
    const out: number[] = []
    const steps = (list: [number, number][]) => {
      for (const [df, dr] of list) if (onBoard(f0 + df, r0 + dr)) out.push(squareAt(f0 + df, r0 + dr))
    }
    const slide = (list: [number, number][]) => {
      for (const [df, dr] of list) {
        let f = f0 + df
        let r = r0 + dr
        while (onBoard(f, r)) {
          const s = squareAt(f, r)
          out.push(s)
          if (this.squares[s]) break
          f += df
          r += dr
        }
      }
    }
    switch (p.type) {
      case 'p': {
        const dr = p.color === 'w' ? 1 : -1
        steps([[-1, dr], [1, dr]])
        break
      }
      case 'n':
        steps(KNIGHT_JUMPS)
        break
      case 'k':
        steps(KING_STEPS)
        break
      case 'b':
        slide(BISHOP_DIRS)
        break
      case 'r':
        slide(ROOK_DIRS)
        break
      case 'q':
        slide(KING_STEPS)
        break
    }
    return out.sort((a, b) => a - b)
  }

  /** Does the piece on `from` attack `to`? */
  attacksSquare(from: number, to: number): boolean {
    const p = this.squares[from]
    if (!p || from === to) return false
    const df = fileOf(to) - fileOf(from)
    const dr = rankOf(to) - rankOf(from)
    switch (p.type) {
      case 'p':
        return Math.abs(df) === 1 && dr === (p.color === 'w' ? 1 : -1)
      case 'n':
        return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)
      case 'k':
        return Math.abs(df) <= 1 && Math.abs(dr) <= 1
      default: {
        const d = direction(from, to)
        if (!d || !slidesAlong(p.type, d)) return false
        return between(from, to).every(s => !this.squares[s])
      }
    }
  }

  /** board.attackers(color, square), ascending square order. */
  attackers(color: Color, square: number): number[] {
    const out: number[] = []
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s]
      if (p && p.color === color && this.attacksSquare(s, square)) out.push(s)
    }
    return out
  }

  checkers(): number[] {
    const k = this.king(this.turn)
    return k === null ? [] : this.attackers(other(this.turn), k)
  }

  isCheck(): boolean {
    return this.checkers().length > 0
  }

  /** board.pin(color, square): absolute pin to the king of `color`, or null if not pinned. */
  pin(color: Color, square: number): PinInfo | null {
    const king = this.king(color)
    if (king === null) return null
    const d = direction(king, square)
    if (!d) return null
    let f = fileOf(king) + d[0]
    let r = rankOf(king) + d[1]
    let passed = false
    while (onBoard(f, r)) {
      const s = squareAt(f, r)
      if (s === square) {
        passed = true
      } else {
        const p = this.squares[s]
        if (p) {
          if (!passed) return null
          if (p.color !== color && slidesAlong(p.type, d)) return { ray: ray(king, s), pinner: s, behind: king }
          return null
        }
      }
      f += d[0]
      r += d[1]
    }
    return null
  }

  /** Copy of the board with the piece on `s` removed. */
  without(s: number): Board {
    const sq = this.squares.slice()
    sq[s] = null
    return new Board(sq, this.turn)
  }
}

/** Pseudo-legal destination squares of the piece on `from` (no castling; pins and checks ignored). */
export function pseudoLegalTargets(board: Board, from: number, epSquare: number | null): number[] {
  const p = board.pieceAt(from)
  if (!p) return []
  if (p.type !== 'p') return board.attacks(from).filter(s => board.pieceAt(s)?.color !== p.color)
  const out: number[] = []
  const dr = p.color === 'w' ? 1 : -1
  const f = fileOf(from)
  const r = rankOf(from)
  if (onBoard(f, r + dr) && !board.pieceAt(squareAt(f, r + dr))) {
    out.push(squareAt(f, r + dr))
    const startRank = p.color === 'w' ? 1 : 6
    if (r === startRank && !board.pieceAt(squareAt(f, r + 2 * dr))) out.push(squareAt(f, r + 2 * dr))
  }
  for (const s of board.attacks(from)) {
    const t = board.pieceAt(s)
    if ((t && t.color !== p.color) || s === epSquare) out.push(s)
  }
  return out
}

/** Board after a pseudo-legal non-castling move (handles en passant; the promoted piece is a queen unless given). */
function applyPseudo(board: Board, m: UciMove, epSquare: number | null): Board {
  const sq = board.squares.slice()
  const p = sq[m.from] ?? null
  if (p && p.type === 'p' && m.to === epSquare && fileOf(m.from) !== fileOf(m.to) && !sq[m.to])
    sq[squareAt(fileOf(m.to), rankOf(m.from))] = null
  const lastRank = p && p.type === 'p' && (rankOf(m.to) === 0 || rankOf(m.to) === 7)
  sq[m.to] = p && lastRank ? { type: m.promotion ?? 'q', color: p.color } : p
  sq[m.from] = null
  return new Board(sq, other(board.turn))
}

const leavesKingSafe = (board: Board, m: UciMove, epSquare: number | null): boolean => {
  const after = applyPseudo(board, m, epSquare)
  const k = after.king(board.turn)
  return k === null || after.attackers(other(board.turn), k).length === 0
}

/** Is a non-castling move legal for the side to move? */
export function isLegalNonCastling(board: Board, m: UciMove, epSquare: number | null): boolean {
  const p = board.pieceAt(m.from)
  if (!p || p.color !== board.turn) return false
  const lastRank = p.type === 'p' && (rankOf(m.to) === 0 || rankOf(m.to) === 7)
  if (lastRank ? !m.promotion || m.promotion === 'p' || m.promotion === 'k' : m.promotion) return false
  if (!pseudoLegalTargets(board, m.from, epSquare).includes(m.to)) return false
  return leavesKingSafe(board, m, epSquare)
}

/** Number of legal non-castling moves (promotions count 4 times, as in python-chess), stopping at `limit`. */
export function countLegalNonCastling(board: Board, epSquare: number | null, limit: number): number {
  let n = 0
  for (const [from, p] of board.pieces()) {
    if (p.color !== board.turn) continue
    for (const to of pseudoLegalTargets(board, from, epSquare)) {
      if (!leavesKingSafe(board, { from, to, promotion: null }, epSquare)) continue
      n += p.type === 'p' && (rankOf(to) === 0 || rankOf(to) === 7) ? 4 : 1
      if (n >= limit) return n
    }
  }
  return n
}

export interface UciMove {
  from: number
  to: number
  promotion: PieceType | null
}

export function parseUci(uci: string): UciMove | null {
  if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(uci)) return null
  return {
    from: parseSquare(uci.slice(0, 2)),
    to: parseSquare(uci.slice(2, 4)),
    promotion: uci.length > 4 ? (uci[4] as PieceType) : null,
  }
}

/** A position: mailbox board for the static helpers plus a lazily built chess.js instance. */
export class Pos {
  readonly fen: string
  readonly board: Board
  private chessCache: Chess | null = null
  private legalCache: UciMove[] | null = null
  private mateCache: boolean | null

  constructor(fen: string, isCheckmate: boolean | null = null) {
    this.fen = fen
    this.board = Board.fromFen(fen)
    this.mateCache = isCheckmate
  }

  get chess(): Chess {
    this.chessCache ??= new Chess(this.fen)
    return this.chessCache
  }

  get epSquare(): number | null {
    const ep = this.fen.split(' ')[3]
    return ep && ep !== '-' ? parseSquare(ep) : null
  }

  isCheck(): boolean {
    return this.board.isCheck()
  }

  isCheckmate(): boolean {
    this.mateCache ??= this.isCheck() && this.chess.isCheckmate()
    return this.mateCache
  }

  legalMoves(): UciMove[] {
    this.legalCache ??= this.chess.moves({ verbose: true }).map(m => ({
      from: parseSquare(m.from),
      to: parseSquare(m.to),
      promotion: (m.promotion as PieceType | undefined) ?? null,
    }))
    return this.legalCache
  }

  /** legal_moves.count() >= n, using chess.js only when the cheap count (no castling) falls short. */
  legalMoveCountAtLeast(n: number): boolean {
    return countLegalNonCastling(this.board, this.epSquare, n) >= n || this.legalMoves().length >= n
  }

  hasLegalMove(m: UciMove): boolean {
    const p = this.board.pieceAt(m.from)
    if (p?.type === 'k' && distance(m.from, m.to) > 1)
      return this.legalMoves().some(x => x.from === m.from && x.to === m.to && x.promotion === m.promotion)
    return isLegalNonCastling(this.board, m, this.epSquare)
  }

  /** Legal moves of the piece on `square`. */
  legalMovesFrom(square: number): UciMove[] {
    if (this.legalCache) return this.legalCache.filter(m => m.from === square)
    return this.chess.moves({ square: squareName(square) as Square, verbose: true }).map(m => ({
      from: parseSquare(m.from),
      to: parseSquare(m.to),
      promotion: (m.promotion as PieceType | undefined) ?? null,
    }))
  }
}

/** Board after a simple move of a non-pawn, non-king piece (no castling, en passant or promotion). */
export function playSimple(board: Board, m: UciMove): Board {
  const sq = board.squares.slice()
  sq[m.to] = sq[m.from] ?? null
  sq[m.from] = null
  return new Board(sq, other(board.turn))
}

// ---- util.py ----

export function materialCount(board: Board, side: Color): number {
  let n = 0
  for (const p of board.squares) if (p && p.color === side) n += VALUES[p.type]
  return n
}

export const materialDiff = (board: Board, side: Color): number =>
  materialCount(board, side) - materialCount(board, other(side))

/** attacked_opponent_squares: opponent pieces attacked from `from` (pov = the attacker's side). */
export function attackedOpponentSquares(board: Board, from: number, pov: Color): [Piece, number][] {
  const out: [Piece, number][] = []
  for (const s of board.attacks(from)) {
    const p = board.pieceAt(s)
    if (p && p.color !== pov) out.push([p, s])
  }
  return out
}

export function isDefended(board: Board, piece: Piece, square: number): boolean {
  if (board.attackers(piece.color, square).length) return true
  // ray defense: a defender standing behind an enemy slider
  for (const attacker of board.attackers(other(piece.color), square)) {
    const ap = board.pieceAt(attacker)
    if (ap && isRayType(ap.type) && board.without(attacker).attackers(piece.color, square).length) return true
  }
  return false
}

export const isHanging = (board: Board, piece: Piece, square: number): boolean => !isDefended(board, piece, square)

export function canBeTakenByLowerPiece(board: Board, piece: Piece, square: number): boolean {
  for (const s of board.attackers(other(piece.color), square)) {
    const a = board.pieceAt(s)
    if (a && a.type !== 'k' && VALUES[a.type] < VALUES[piece.type]) return true
  }
  return false
}

/** Hanging or takeable by a lower piece. */
export function isInBadSpot(board: Board, square: number): boolean {
  const piece = board.pieceAt(square)
  if (!piece) return false
  return (
    board.attackers(other(piece.color), square).length > 0 &&
    (isHanging(board, piece, square) || canBeTakenByLowerPiece(board, piece, square))
  )
}

export function isTrapped(pos: Pos, square: number): boolean {
  const board = pos.board
  if (board.isCheck() || board.pin(board.turn, square)) return false
  const piece = board.pieceAt(square)
  if (!piece || piece.type === 'p' || piece.type === 'k') return false
  if (!isInBadSpot(board, square)) return false
  for (const escape of pos.legalMovesFrom(square)) {
    const capturing = board.pieceAt(escape.to)
    if (capturing && VALUES[capturing.type] >= VALUES[piece.type]) return false
    if (!isInBadSpot(playSimple(board, escape), escape.to)) return false
  }
  return true
}

export function attackerPieces(board: Board, color: Color, square: number): Piece[] {
  const out: Piece[] = []
  for (const s of board.attackers(color, square)) {
    const p = board.pieceAt(s)
    if (p) out.push(p)
  }
  return out
}
