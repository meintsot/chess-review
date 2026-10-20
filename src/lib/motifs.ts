// Tactical-motif detection for engine lines.
//
// Port of the Lichess puzzle tagger: ornicar/lichess-puzzler, tagger/cook.py (+ util.py),
// https://github.com/ornicar/lichess-puzzler/tree/master/tagger
// Copyright (c) Thibault Duplessis and lichess-puzzler contributors. Licensed AGPL-3.0;
// this port is distributed under the same license.
//
// Upstream works on a puzzle = game node chain whose first node is the opponent's last move and
// whose solver ("pov") plays the 1st, 3rd, ... moves after it. Here the line starts with the solver's
// move, so upstream `mainline[k]` is `line[k - 1]`, and `mainline[0]` (the move that led to `fen`) is
// only known when the caller passes `prev`. Each detector keeps upstream's logic and returns the
// first occurrence (as upstream returns True), plus the squares/pieces it found along the way.
//
// Deviations from upstream (all deliberate):
//  - `pin` also recognises relative pins (to a more valuable piece) through the "pin prevents
//    escape" rule; upstream only knows pins to the king.
//  - discovered checks are reported as `discoveredCheck` (also when the moved piece checks too, i.e. a
//    double check, as the Lichess puzzle DB tags them); `discoveredAttack` is only reported for the
//    capture-based discovery (upstream folds discovered checks into discoveredAttack).
//  - `defensiveMove` looks at the last solver move of the line (upstream: last move of the puzzle).
//  - `mate` needs the line to end with the solver delivering mate; mateIn is not capped at 5.
//  - python truthiness bugs on square a1 (index 0) are not reproduced.
//  - overloading is a stub returning False upstream, so it is never reported; bodenMate and
//    dovetailMate have no MotifKind and are not reported.
import { Chess } from 'chess.js'
import {
  type Color,
  type PieceType,
  type PinInfo,
  Board,
  KING_VALUES,
  PIECE_TYPE_INDEX,
  Pos,
  VALUES,
  type UciMove,
  attackedOpponentSquares,
  attackerPieces,
  between,
  distance,
  fileOf,
  isDefended,
  isHanging,
  isInBadSpot,
  isRayType,
  isTrapped,
  materialDiff,
  other,
  parseUci,
  pseudoLegalTargets,
  rankOf,
  ray,
  slidesAlong,
  squareAt,
  squareName,
} from './motifUtil'

export type MotifKind = 'fork' | 'pin' | 'skewer' | 'discoveredAttack' | 'discoveredCheck' | 'doubleCheck' | 'hangingPiece'
  | 'trappedPiece' | 'sacrifice' | 'deflection' | 'attraction' | 'xRayAttack' | 'interference' | 'intermezzo'
  | 'capturingDefender' | 'clearance' | 'overloading' | 'backRankMate' | 'smotheredMate' | 'anastasiaMate' | 'hookMate'
  | 'arabianMate' | 'doubleBishopMate' | 'mate' | 'promotion' | 'underPromotion' | 'advancedPawn' | 'exposedKing'
  | 'kingsideAttack' | 'queensideAttack' | 'quietMove' | 'defensiveMove' | 'attackingF2F7' | 'enPassant' | 'castling'

/**
 * Field meaning per kind (`ply` is always a solver move index in `line`):
 * - fork: square/piece = forking piece after the move; targets = forked pieces.
 * - pin / skewer: square/piece = pinning (skewering) piece; targets = [front piece, piece behind it].
 *   For pin, `ply` is the solver move after which the pin bites; for skewer, the move before the
 *   capture through the line.
 * - discoveredAttack: ply = the unmasking move; square/piece = the unmasked piece; targets = [its victim].
 * - discoveredCheck: square/piece = the unmasked checking piece; targets = [king].
 * - doubleCheck, mate patterns, attackingF2F7, hangingPiece: square/piece = moved piece; targets = [king/victim].
 * - trappedPiece: ply/square/piece = the solver move after which the piece is trapped; targets = [trapped piece].
 * - sacrifice: the solver move that gives up material.
 * - deflection: ply/square/piece = deflecting move; targets = [deflected piece, square it guarded].
 * - attraction: square = square the piece is lured to; targets = [lured piece's original square].
 * - xRayAttack: ply = the x-ray capture; square/piece = capturing piece (from square); targets = [captured].
 * - interference: ply = the move that interferes or forces it; square = interference square;
 *   targets = [undefended piece, cut-off defender].
 * - intermezzo: the in-between capture; targets = [captured piece].
 * - capturingDefender: ply/square = capture of the defender; targets = [defender, square it defended].
 * - clearance: ply = clearing move; square = the vacated square; piece = clearing piece.
 * - promotion / underPromotion: piece = promoted-to piece.
 * - exposedKing, kingsideAttack, queensideAttack: square/targets = enemy king.
 */
export interface Motif {
  kind: MotifKind
  ply: number            // index in `line` of the solver move where the motif happens (0-based)
  square?: string        // key square (e.g. the forking piece's square, the pinned piece's square)
  piece?: 'p'|'n'|'b'|'r'|'q'|'k' // the acting piece
  targets?: string[]     // squares of attacked/pinned/skewered pieces etc. when meaningful
  mateIn?: number        // for 'mate'
}

/** The move that led to `fen` (upstream's mainline[0]): the position before it and the move in UCI. */
export interface PrevMove {
  fen: string
  uci: string
}

const ORDER: MotifKind[] = [
  'mate', 'smotheredMate', 'backRankMate', 'anastasiaMate', 'hookMate', 'arabianMate', 'doubleBishopMate',
  'fork', 'pin', 'skewer', 'discoveredCheck', 'doubleCheck', 'discoveredAttack',
  'hangingPiece', 'trappedPiece', 'sacrifice', 'deflection', 'overloading', 'attraction', 'xRayAttack',
  'interference', 'intermezzo', 'capturingDefender', 'clearance', 'promotion', 'underPromotion',
  'attackingF2F7', 'exposedKing', 'kingsideAttack', 'queensideAttack', 'advancedPawn', 'quietMove',
  'defensiveMove', 'enPassant', 'castling',
]

interface Node extends UciMove {
  /** Index in `line`; -1 for the move that led to the start position. */
  idx: number
  before: Pos
  after: Pos
}

interface Ctx {
  pov: Color
  /** nodes[i] = line[i] */
  nodes: Node[]
  prev: Node | null
}

const at = (c: Ctx, i: number): Node | null => (i === -1 ? c.prev : c.nodes[i] ?? null)
/** Solver nodes (upstream mainline[1::2]), optionally skipping the first `skip`. */
const solverNodes = (c: Ctx, skip = 0): Node[] => c.nodes.filter(n => n.idx % 2 === 0).slice(skip)
const movedType = (n: Node): PieceType => n.after.board.pieceAt(n.to)?.type ?? 'p'
const isCapture = (n: Node): boolean => {
  if (n.before.board.pieceAt(n.to)) return true
  const p = n.before.board.pieceAt(n.from)
  return p?.type === 'p' && fileOf(n.from) !== fileOf(n.to)
}
const isCastling = (n: Node): boolean => movedType(n) === 'k' && distance(n.from, n.to) > 1
const isAdvancedPawnMove = (n: Node): boolean => {
  if (n.promotion) return true
  if (movedType(n) !== 'p') return false
  const r = rankOf(n.to)
  return n.after.board.turn === 'w' ? r < 3 : r > 4
}
const isVeryAdvancedPawnMove = (n: Node): boolean => {
  if (!isAdvancedPawnMove(n)) return false
  const r = rankOf(n.to)
  return n.after.board.turn === 'w' ? r < 2 : r > 5
}

function mk(kind: MotifKind, n: Node, extra: Partial<Motif> = {}): Motif {
  return { kind, ply: n.idx, square: squareName(n.to), piece: movedType(n), ...extra }
}
const names = (squares: number[]): string[] => squares.map(squareName)
const kingTarget = (b: Board, color: Color): string[] => {
  const k = b.king(color)
  return k === null ? [] : [squareName(k)]
}

// ---------------------------------------------------------------------------------------------
// Detectors (same names and order as cook.py)

function advancedPawn(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) if (isVeryAdvancedPawnMove(n)) return mk('advancedPawn', n, { piece: 'p' })
  return null
}

function doubleCheck(c: Ctx): Motif | null {
  for (const n of solverNodes(c))
    if (n.after.board.checkers().length > 1) return mk('doubleCheck', n, { targets: kingTarget(n.after.board, other(c.pov)) })
  return null
}

function sacrifice(c: Ctx): Motif | null {
  // down in material compared to initial position, after moving
  const boards = [c.nodes[0].before, ...c.nodes.map(n => n.after)]
  const diffs = boards.map(b => materialDiff(b.board, c.pov))
  const initial = diffs[0]
  for (let k = 2; k < c.nodes.length; k += 2) {
    if (diffs[k + 1] - initial <= -2) {
      if (c.nodes.some(n => n.idx % 2 === 1 && n.promotion)) return null
      // attribute it to the first solver move after whose reply the material was down
      let j = 0
      while (j < k - 2 && diffs[j + 2] - initial > -2) j += 2
      return mk('sacrifice', c.nodes[j])
    }
  }
  return null
}

function xRay(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    if (!isCapture(n)) continue
    const prevOp = c.nodes[n.idx - 1]
    if (prevOp.to !== n.to || movedType(prevOp) === 'k') continue
    const prevPl = c.nodes[n.idx - 2]
    if (prevPl.to !== prevOp.to) continue
    if (between(n.from, n.to).includes(prevOp.from))
      return mk('xRayAttack', n, { square: squareName(n.from), targets: [squareName(n.to)] })
  }
  return null
}

function fork(c: Ctx): Motif | null {
  for (const n of solverNodes(c).slice(0, -1)) {
    const moved = movedType(n)
    if (moved === 'k') continue
    const board = n.after.board
    if (isInBadSpot(board, n.to)) continue
    const targets: number[] = []
    for (const [piece, square] of attackedOpponentSquares(board, n.to, c.pov)) {
      if (piece.type === 'p') continue
      if (
        KING_VALUES[piece.type] > KING_VALUES[moved] ||
        (isHanging(board, piece, square) && !board.attackers(other(c.pov), n.to).includes(square))
      )
        targets.push(square)
    }
    if (targets.length > 1) return mk('fork', n, { targets: names(targets) })
  }
  return null
}

function hangingPiece(c: Ctx): Motif | null {
  const first = c.nodes[0]
  const to = first.to
  const start = first.before.board
  const captured = start.pieceAt(to)
  if (start.isCheck() && (!captured || captured.type === 'p')) return null
  if (captured && captured.type !== 'p' && isHanging(start, captured, to)) {
    const op = c.prev
    if (op) {
      const opCapture = op.before.board.pieceAt(op.to)
      if (opCapture && VALUES[opCapture.type] >= VALUES[captured.type] && op.to === to) return null
    }
    const motif = mk('hangingPiece', first, { targets: [squareName(to)] })
    if (c.nodes.length < 3) return motif
    if (materialDiff(c.nodes[2].after.board, c.pov) >= materialDiff(first.after.board, c.pov)) return motif
  }
  return null
}

function trappedPiece(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    let square = n.to
    const captured = n.before.board.pieceAt(square)
    if (captured && captured.type !== 'p') {
      const prev = c.nodes[n.idx - 1]
      if (prev.to === square) square = prev.from
      if (isTrapped(prev.before, square)) return mk('trappedPiece', c.nodes[n.idx - 2], { targets: [squareName(square)] })
    }
  }
  return null
}

function discoveredCheck(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) {
    if (isCastling(n)) continue // the castled rook is not a discovered piece
    const discovered = n.after.board.checkers().find(s => s !== n.to)
    if (discovered !== undefined) {
      return mk('discoveredCheck', n, {
        square: squareName(discovered),
        piece: n.after.board.pieceAt(discovered)?.type,
        targets: kingTarget(n.after.board, other(c.pov)),
      })
    }
  }
  return null
}

/** The capture-based half of upstream discovered_attack (its discovered_check half is reported separately). */
function discoveredAttack(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    if (!isCapture(n)) continue
    const btw = between(n.from, n.to)
    if (c.nodes[n.idx - 1].to === n.to) return null
    const prev = c.nodes[n.idx - 2]
    if (btw.includes(prev.from) && n.to !== prev.to && n.from !== prev.to && !isCastling(prev)) {
      return mk('discoveredAttack', prev, {
        square: squareName(n.from),
        piece: n.before.board.pieceAt(n.from)?.type,
        targets: [squareName(n.to)],
      })
    }
  }
  return null
}

function quietMove(c: Ctx): Motif | null {
  const last = c.nodes.length - 1
  for (const n of solverNodes(c)) {
    if (
      n.idx !== last &&
      !n.after.isCheck() &&
      !n.before.isCheck() &&
      !isCapture(n) &&
      attackedOpponentSquares(n.after.board, n.to, c.pov).length === 0 &&
      !isAdvancedPawnMove(n) &&
      movedType(n) !== 'k'
    )
      return mk('quietMove', n)
  }
  return null
}

function defensiveMove(c: Ctx): Motif | null {
  // like quiet_move, but on the last (solver) move
  const solver = solverNodes(c)
  const n = solver[solver.length - 1]
  if (!n.before.legalMoveCountAtLeast(3)) return null
  if (n.after.isCheck() || isCapture(n)) return null
  if (attackedOpponentSquares(n.after.board, n.to, c.pov).length) return null
  return isAdvancedPawnMove(n) ? null : mk('defensiveMove', n)
}

function checkEscape(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) {
    if (n.after.isCheck() || isCapture(n)) return null
    if (!n.before.legalMoveCountAtLeast(3)) return null
    if (n.before.isCheck()) return mk('defensiveMove', n)
  }
  return null
}

function attraction(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) {
    // 1. player moves to a square
    const firstMoveTo = n.to
    const reply = at(c, n.idx + 1)
    // 2. opponent captures on that square
    if (reply && reply.to === firstMoveTo) {
      const attracted = movedType(reply)
      if (attracted === 'k' || attracted === 'q' || attracted === 'r') {
        const attractedTo = reply.to
        const next = at(c, n.idx + 2)
        // 3. player attacks that square
        if (next && next.after.board.attackers(c.pov, attractedTo).includes(next.to)) {
          const motif = mk('attraction', n, { targets: [squareName(reply.from)] })
          // 4. player checks on that square
          if (attracted === 'k') return motif
          // 4. or player later captures on that square
          const n3 = at(c, n.idx + 4)
          if (n3 && n3.to === attractedTo) return motif
        }
      }
    }
  }
  return null
}

function deflection(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    const captured = n.before.board.pieceAt(n.to)
    if (!captured && !n.promotion) continue
    const capturing = movedType(n)
    if (captured && KING_VALUES[captured.type] > KING_VALUES[capturing]) continue
    const square = n.to
    const prevOp = c.nodes[n.idx - 1]
    const grandpa = c.nodes[n.idx - 2]
    const prevPlayerCapture = grandpa.before.board.pieceAt(grandpa.to)
    const gb = grandpa.after.board
    if (
      // upstream compares a material value with python-chess's piece-type index; kept as is
      (!prevPlayerCapture || VALUES[prevPlayerCapture.type] < PIECE_TYPE_INDEX[movedType(grandpa)]) &&
      square !== prevOp.to &&
      square !== grandpa.to &&
      (prevOp.to === grandpa.to || gb.isCheck()) &&
      (gb.attacks(prevOp.from).includes(square) ||
        (n.promotion !== null && fileOf(n.to) === fileOf(prevOp.from) && gb.attacks(prevOp.from).includes(n.from))) &&
      !n.before.board.attacks(prevOp.to).includes(square)
    )
      return mk('deflection', grandpa, { targets: [squareName(prevOp.from), squareName(square)] })
  }
  return null
}

function exposedKing(c: Ctx): Motif | null {
  const board = c.nodes[0].before.board
  const opp = other(c.pov)
  const king = board.king(opp)
  if (king === null) return null
  // ranks seen from the solver's side (upstream mirrors the board for black)
  const rel = (r: number) => (c.pov === 'w' ? r : 7 - r)
  if (rel(rankOf(king)) < 5) return null
  const towardSolver = c.pov === 'w' ? -1 : 1
  const kf = fileOf(king)
  const kr = rankOf(king)
  const shield: number[] = [squareAt(kf, kr + towardSolver)]
  if (kf > 0) shield.push(squareAt(kf - 1, kr), squareAt(kf - 1, kr + towardSolver))
  if (kf < 7) shield.push(squareAt(kf + 1, kr), squareAt(kf + 1, kr + towardSolver))
  for (const s of shield) {
    const p = board.pieceAt(s)
    if (p && p.type === 'p' && p.color === opp) return null
  }
  for (const n of solverNodes(c, 1).slice(0, -1))
    if (n.after.isCheck()) return mk('exposedKing', n, { square: squareName(king), targets: [squareName(king)] })
  return null
}

function skewer(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    const prev = c.nodes[n.idx - 1]
    const capture = n.before.board.pieceAt(n.to)
    const moved = movedType(n)
    if (capture && isRayType(moved) && !n.after.isCheckmate()) {
      if (prev.to === n.to || !between(n.from, n.to).includes(prev.from)) continue
      if (KING_VALUES[movedType(prev)] > KING_VALUES[capture.type] && isInBadSpot(n.before.board, n.to)) {
        return mk('skewer', c.nodes[n.idx - 2], {
          square: squareName(n.from),
          piece: n.before.board.pieceAt(n.from)?.type,
          targets: [squareName(prev.from), squareName(n.to)],
        })
      }
    }
  }
  return null
}

function selfInterference(c: Ctx): Motif | null {
  // interference by opponent piece
  for (const n of solverNodes(c, 1)) {
    const prevBoard = n.before.board
    const square = n.to
    const capture = prevBoard.pieceAt(square)
    if (capture && isHanging(prevBoard, capture, square)) {
      const grandpa = c.nodes[n.idx - 2]
      const initBoard = grandpa.after.board
      const defender = initBoard.attackers(capture.color, square)[0]
      const defenderPiece = defender === undefined ? null : initBoard.pieceAt(defender)
      if (defender !== undefined && defenderPiece && isRayType(defenderPiece.type)) {
        const opMove = c.nodes[n.idx - 1]
        if (between(square, defender).includes(opMove.to))
          return mk('interference', grandpa, { square: squareName(opMove.to), targets: names([square, defender]) })
      }
    }
  }
  return null
}

function interference(c: Ctx): Motif | null {
  // interference by player piece
  for (const n of solverNodes(c, 1)) {
    const prevBoard = n.before.board
    const square = n.to
    const capture = prevBoard.pieceAt(square)
    if (capture && square !== c.nodes[n.idx - 1].to && isHanging(prevBoard, capture, square)) {
      const interfering = c.nodes[n.idx - 2]
      const initBoard = interfering.before.board
      const defender = initBoard.attackers(capture.color, square)[0]
      const defenderPiece = defender === undefined ? null : initBoard.pieceAt(defender)
      if (defender !== undefined && defenderPiece && isRayType(defenderPiece.type)) {
        if (between(square, defender).includes(interfering.to))
          return mk('interference', interfering, { targets: names([square, defender]) })
      }
    }
  }
  return null
}

function intermezzo(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    if (!isCapture(n)) continue
    const captureSquare = n.to
    const opNode = c.nodes[n.idx - 1]
    const prevPov = c.nodes[n.idx - 2]
    if (!prevPov.after.board.attackers(other(c.pov), captureSquare).includes(opNode.from)) {
      if (prevPov.to !== captureSquare) {
        const prevOp = at(c, n.idx - 3)
        if (!prevOp) return null // upstream needs the move that led to the start position
        const ok = prevOp.to === captureSquare && isCapture(prevOp) && prevOp.after.hasLegalMove(n)
        return ok ? mk('intermezzo', n, { targets: [squareName(captureSquare)] }) : null
      }
    }
  }
  return null
}

/** Absolute pin (python-chess board.pin) or, as an extension, a relative pin to a more valuable piece. */
function relativePin(board: Board, square: number): PinInfo | null {
  const pinned = board.pieceAt(square)
  // pawns "pinned" to a piece behind them are almost always just a skewer/capture threat
  if (!pinned || pinned.type === 'k' || pinned.type === 'p') return null
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  const firstPiece = (d: [number, number]): number | null => {
    let f = fileOf(square) + d[0]
    let r = rankOf(square) + d[1]
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      if (board.pieceAt(squareAt(f, r))) return squareAt(f, r)
      f += d[0]
      r += d[1]
    }
    return null
  }
  for (const d of dirs) {
    const pinner = firstPiece(d)
    const behind = firstPiece([-d[0], -d[1]])
    if (pinner === null || behind === null) continue
    const pp = board.pieceAt(pinner)
    const bp = board.pieceAt(behind)
    if (!pp || !bp || pp.color === pinned.color || bp.color !== pinned.color || bp.type === 'k') continue
    if (!slidesAlong(pp.type, d)) continue
    if (VALUES[bp.type] <= VALUES[pinned.type]) continue
    // the piece behind must actually be lost if the pinned piece steps aside
    if (VALUES[bp.type] > VALUES[pp.type] || !isDefended(board.without(square), bp, behind))
      return { ray: ray(square, pinner), pinner, behind }
  }
  return null
}

function pinMotif(n: Node, pin: PinInfo, pinnedSquare: number): Motif {
  return mk('pin', n, {
    square: squareName(pin.pinner),
    piece: n.after.board.pieceAt(pin.pinner)?.type,
    targets: names([pinnedSquare, pin.behind]),
  })
}

/** Opponent pieces in python-chess piece_map() order (descending squares). */
const opponentPieces = (board: Board, pov: Color) => board.pieces().filter(([, p]) => p.color !== pov).reverse()

// the pinned piece can't attack a player piece
function pinPreventsAttack(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) {
    const board = n.after.board
    for (const [square, piece] of opponentPieces(board, c.pov)) {
      const pin = board.pin(piece.color, square)
      if (!pin) continue
      for (const attack of board.attacks(square)) {
        const attacked = board.pieceAt(attack)
        if (
          attacked &&
          attacked.color === c.pov &&
          !pin.ray.has(attack) &&
          (KING_VALUES[attacked.type] > KING_VALUES[piece.type] || isHanging(board, attacked, attack))
        )
          return pinMotif(n, pin, square)
      }
    }
  }
  return null
}

// the pinned piece can't escape the attack
function pinPreventsEscape(c: Ctx, findPin: (b: Board, sq: number, color: Color) => PinInfo | null): Motif | null {
  for (const n of solverNodes(c)) {
    const board = n.after.board
    for (const [pinnedSquare, pinnedPiece] of opponentPieces(board, c.pov)) {
      const pin = findPin(board, pinnedSquare, pinnedPiece.color)
      if (!pin) continue
      for (const attackerSquare of board.attackers(c.pov, pinnedSquare)) {
        if (!pin.ray.has(attackerSquare)) continue
        const attacker = board.pieceAt(attackerSquare)
        if (!attacker) continue
        if (VALUES[pinnedPiece.type] > KING_VALUES[attacker.type]) return pinMotif(n, pin, pinnedSquare)
        if (
          isHanging(board, pinnedPiece, pinnedSquare) &&
          !board.attackers(other(c.pov), attackerSquare).includes(pinnedSquare) &&
          pseudoLegalTargets(board, pinnedSquare, n.after.epSquare).some(t => !pin.ray.has(t))
        )
          return pinMotif(n, pin, pinnedSquare)
      }
    }
  }
  return null
}

function pin(c: Ctx): Motif | null {
  return (
    pinPreventsAttack(c) ??
    pinPreventsEscape(c, (b, sq, color) => b.pin(color, sq)) ??
    pinPreventsEscape(c, (b, sq, color) => b.pin(color, sq) ?? relativePin(b, sq))
  )
}

function attackingF2F7(c: Ctx): Motif | null {
  const f2 = squareAt(5, 1)
  const f7 = squareAt(5, 6)
  for (const n of solverNodes(c)) {
    const square = n.to
    if (n.before.board.pieceAt(square) && (square === f2 || square === f7)) {
      const king = n.after.board.pieceAt(square === f7 ? squareAt(4, 7) : squareAt(4, 0))
      return king && king.type === 'k' && king.color !== c.pov ? mk('attackingF2F7', n, { targets: [squareName(square)] }) : null
    }
  }
  return null
}

function sideAttack(c: Ctx, kind: 'kingsideAttack' | 'queensideAttack', cornerFile: number, kingFiles: number[], nbPieces: number): Motif | null {
  const backRank = c.pov === 'w' ? 7 : 0
  const init = c.nodes[0].before.board
  const king = init.king(other(c.pov))
  const solver = solverNodes(c)
  if (
    king === null ||
    rankOf(king) !== backRank ||
    !kingFiles.includes(fileOf(king)) ||
    init.pieces().length < nbPieces || // no endgames
    !solver.some(n => n.after.isCheck())
  )
    return null
  let score = 0
  const corner = squareAt(cornerFile, backRank)
  for (const n of solver) {
    const cornerDist = distance(corner, n.to)
    if (n.after.isCheck()) score += 1
    if (isCapture(n) && cornerDist <= 3) score += 1
    else if (cornerDist >= 5) score -= 1
  }
  return score >= 2 ? mk(kind, solver[0], { square: squareName(king), targets: [squareName(king)] }) : null
}

function clearance(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    const board = n.after.board
    if (n.before.board.pieceAt(n.to)) continue
    const piece = board.pieceAt(n.to)
    if (!piece || !isRayType(piece.type)) continue
    const prev = c.nodes[n.idx - 2]
    const opNode = c.nodes[n.idx - 1]
    if (
      !prev.promotion &&
      prev.to !== n.from &&
      prev.to !== n.to &&
      !n.before.isCheck() &&
      (!board.isCheck() || movedType(opNode) !== 'k')
    ) {
      if (prev.from === n.to || between(n.from, n.to).includes(prev.from)) {
        if (!prev.before.board.pieceAt(prev.to) || isInBadSpot(prev.after.board, prev.to))
          return mk('clearance', prev, { square: squareName(prev.from) })
      }
    }
  }
  return null
}

function enPassant(c: Ctx): Motif | null {
  for (const n of solverNodes(c))
    if (movedType(n) === 'p' && fileOf(n.from) !== fileOf(n.to) && !n.before.board.pieceAt(n.to)) return mk('enPassant', n)
  return null
}

function castling(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) if (isCastling(n)) return mk('castling', n)
  return null
}

function promotion(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) if (n.promotion) return mk('promotion', n)
  return null
}

function underPromotion(c: Ctx): Motif | null {
  for (const n of solverNodes(c)) {
    if (n.after.isCheckmate()) return n.promotion === 'n' ? mk('underPromotion', n) : null
    if (n.promotion && n.promotion !== 'q') return mk('underPromotion', n)
  }
  return null
}

function capturingDefender(c: Ctx): Motif | null {
  for (const n of solverNodes(c, 1)) {
    const capture = n.before.board.pieceAt(n.to)
    const moved = movedType(n)
    if (
      n.after.isCheckmate() ||
      (capture &&
        moved !== 'k' &&
        VALUES[capture.type] <= VALUES[moved] &&
        isHanging(n.before.board, capture, n.to) &&
        c.nodes[n.idx - 1].to !== n.to)
    ) {
      const prev = c.nodes[n.idx - 2]
      if (!prev.after.isCheck() && prev.to !== n.from) {
        const init = prev.before.board
        const defenderSquare = prev.to
        const defender = init.pieceAt(defenderSquare)
        if (defender && init.attackers(defender.color, n.to).includes(defenderSquare) && !init.isCheck())
          return mk('capturingDefender', prev, { targets: names([defenderSquare, n.to]) })
      }
    }
  }
  return null
}

// ---- mate patterns (on the final, mated position) ----

interface MateCtx {
  pov: Color
  last: Node
  board: Board
  king: number
}

function backRankMate(m: MateCtx): boolean {
  const { board, king, pov } = m
  const backRank = pov === 'w' ? 7 : 0
  if (rankOf(king) !== backRank) return false
  const fwd = pov === 'w' ? -1 : 1
  const squares = [squareAt(fileOf(king), rankOf(king) + fwd)]
  if (fileOf(king) < 7) squares.push(squareAt(fileOf(king) + 1, rankOf(king) + fwd))
  if (fileOf(king) > 0) squares.push(squareAt(fileOf(king) - 1, rankOf(king) + fwd))
  for (const s of squares) {
    const p = board.pieceAt(s)
    if (!p || p.color === pov || board.attackers(pov, s).length) return false
  }
  return board.checkers().some(ch => rankOf(ch) === backRank)
}

function anastasiaMate(m: MateCtx): boolean {
  const { board, king, pov, last } = m
  const kf = fileOf(king)
  if ((kf !== 0 && kf !== 7) || rankOf(king) === 0 || rankOf(king) === 7) return false
  const t = movedType(last)
  if (fileOf(last.to) !== kf || (t !== 'q' && t !== 'r')) return false
  const dir = kf === 0 ? 1 : -1 // upstream flips the board so the king is on the a-file
  const blocker = board.pieceAt(squareAt(kf + dir, rankOf(king)))
  if (!blocker || blocker.color === pov) return false
  const knight = board.pieceAt(squareAt(kf + 3 * dir, rankOf(king)))
  return !!knight && knight.color === pov && knight.type === 'n'
}

function hookMate(m: MateCtx): boolean {
  const { board, king, pov, last } = m
  if (movedType(last) !== 'r' || distance(last.to, king) !== 1) return false
  for (const nSq of board.attackers(pov, last.to)) {
    const defender = board.pieceAt(nSq)
    if (defender && defender.type === 'n' && distance(nSq, king) === 1) {
      for (const pSq of board.attackers(pov, nSq)) if (board.pieceAt(pSq)?.type === 'p') return true
    }
  }
  return false
}

function arabianMate(m: MateCtx): boolean {
  const { board, king, pov, last } = m
  const corner = (fileOf(king) === 0 || fileOf(king) === 7) && (rankOf(king) === 0 || rankOf(king) === 7)
  if (!corner || movedType(last) !== 'r' || distance(last.to, king) !== 1) return false
  for (const nSq of board.attackers(pov, last.to)) {
    const knight = board.pieceAt(nSq)
    if (knight && knight.type === 'n' && Math.abs(rankOf(nSq) - rankOf(king)) === 2 && Math.abs(fileOf(nSq) - fileOf(king)) === 2)
      return true
  }
  return false
}

function bodenOrDoubleBishopMate(m: MateCtx): 'bodenMate' | 'doubleBishopMate' | null {
  const { board, king, pov } = m
  const bishops = board.piecesOf('b', pov)
  if (bishops.length < 2) return null
  for (let s = 0; s < 64; s++) {
    if (distance(s, king) >= 2) continue
    if (!attackerPieces(board, pov, s).every(p => p.type === 'b')) return null
  }
  return (fileOf(bishops[0]) < fileOf(king)) === (fileOf(bishops[1]) > fileOf(king)) ? 'bodenMate' : 'doubleBishopMate'
}

function smotheredMate(m: MateCtx): boolean {
  const { board, king, pov } = m
  for (const ch of board.checkers()) {
    if (board.pieceAt(ch)?.type !== 'n') continue
    for (let s = 0; s < 64; s++) {
      if (distance(s, king) !== 1) continue
      const blocker = board.pieceAt(s)
      if (!blocker || blocker.color === pov) return false
    }
    return true
  }
  return false
}

function mates(c: Ctx): Motif[] {
  const last = c.nodes[c.nodes.length - 1]
  if (last.idx % 2 !== 0 || !last.after.isCheckmate()) return []
  const board = last.after.board
  const king = board.king(other(c.pov))
  if (king === null) return []
  const m: MateCtx = { pov: c.pov, last, board, king }
  const extra = { targets: [squareName(king)] }
  const out: Motif[] = [mk('mate', last, { ...extra, mateIn: (c.nodes.length + 1) >> 1 })]
  let pattern: MotifKind | null = null
  if (smotheredMate(m)) pattern = 'smotheredMate'
  else if (backRankMate(m)) pattern = 'backRankMate'
  else if (anastasiaMate(m)) pattern = 'anastasiaMate'
  else if (hookMate(m)) pattern = 'hookMate'
  else if (arabianMate(m)) pattern = 'arabianMate'
  else if (bodenOrDoubleBishopMate(m) === 'doubleBishopMate') pattern = 'doubleBishopMate'
  if (pattern) out.push(mk(pattern, last, extra))
  return out
}

// ---------------------------------------------------------------------------------------------

function buildCtx(fen: string, line: string[], prev?: PrevMove): Ctx | null {
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return null
  }
  const pov = chess.turn()
  const nodes: Node[] = []
  let before = new Pos(chess.fen())
  for (const uci of line) {
    const m = parseUci(uci)
    if (!m) break
    let san: string
    try {
      san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: m.promotion ?? undefined }).san
    } catch {
      break // stop at the first illegal move
    }
    const after = new Pos(chess.fen(), san.endsWith('#'))
    nodes.push({ ...m, idx: nodes.length, before, after })
    before = after
  }
  if (!nodes.length) return null

  let prevNode: Node | null = null
  if (prev) {
    const m = parseUci(prev.uci)
    try {
      const c0 = new Chess(prev.fen)
      if (m && c0.turn() !== pov) {
        c0.move({ from: prev.uci.slice(0, 2), to: prev.uci.slice(2, 4), promotion: m.promotion ?? undefined })
        if (c0.fen().split(' ')[0] === fen.split(' ')[0])
          prevNode = { ...m, idx: -1, before: new Pos(prev.fen), after: nodes[0].before }
      }
    } catch {
      prevNode = null
    }
  }
  return { pov, nodes, prev: prevNode }
}

/**
 * fen: position where the solver is to move; line: UCI moves starting with the solver's move
 * (solver, reply, solver, ...). `prev` optionally gives the move that led to `fen` (used by
 * hangingPiece and intermezzo, like upstream's mainline[0]). Illegal moves truncate the line.
 */
export function detectMotifs(fen: string, line: string[], prev?: PrevMove): Motif[] {
  const c = buildCtx(fen, line, prev)
  if (!c) return []
  const found: Motif[] = [...mates(c)]
  const add = (m: Motif | null) => {
    if (m) found.push(m)
  }
  add(attraction(c))
  add(deflection(c)) // upstream: elif overloading (a stub that always returns False)
  add(advancedPawn(c))
  add(doubleCheck(c))
  add(quietMove(c))
  add(defensiveMove(c) ?? checkEscape(c))
  add(sacrifice(c))
  add(xRay(c))
  const forkMotif = fork(c)
  add(forkMotif)
  add(hangingPiece(c))
  add(trappedPiece(c))
  add(discoveredCheck(c))
  add(discoveredAttack(c))
  add(exposedKing(c))
  add(skewer(c))
  add(selfInterference(c) ?? interference(c))
  add(intermezzo(c))
  add(pin(c))
  add(attackingF2F7(c))
  add(clearance(c))
  add(enPassant(c))
  add(castling(c))
  add(promotion(c))
  add(underPromotion(c))
  add(capturingDefender(c))
  if (!forkMotif && !found.some(m => m.kind === 'backRankMate'))
    add(sideAttack(c, 'kingsideAttack', 7, [6, 7], 20) ?? sideAttack(c, 'queensideAttack', 0, [0, 1, 2], 18))
  return found.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}
