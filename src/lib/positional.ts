/*
 * Positional understanding for the coach: Stockfish's classical evaluation, term by term.
 *
 * The evaluation code is a port of the Stockfish Evaluation Guide by hxim
 * (https://github.com/hxim/Stockfish-Evaluation-Guide), which re-implements the hand-crafted
 * ("classical") evaluation of Stockfish (Copyright (C) the Stockfish developers) in JavaScript.
 * Both are licensed under the GNU General Public License v3.0; this port is distributed as part of
 * this project under the GNU Affero General Public License v3.0 (see GPL-3.0 section 13).
 * Formulas and tables follow the guide literally (including its quirks); only the data layout and
 * caching differ: attack maps are computed once per position instead of re-scanning the board for
 * every query, which takes a full evaluation from ~100 ms to ~1 ms.
 *
 * Board convention inside the port (as in the guide): x = file 0..7 (a..h), y = 0..7 from the top,
 * uppercase = "us". The black side is evaluated on a colour-flipped copy of the board.
 */

const FILES = 'abcdefgh'
const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

// ───────────────────────── board representation ─────────────────────────

interface Side {
  b: string[] // 64 squares, index y * 8 + x; '-' empty
  c: boolean[] // castling [our K, our Q, their K, their Q]
  w: boolean // side to move is the real White
  rule50: number
  flipped: boolean // true: uppercase pieces are the real Black
  other: Side
  // attack maps of our (uppercase) pieces, as the guide's attack functions define them
  pin: Int8Array
  pA: Uint8Array
  kA: Uint8Array
  nA: Uint8Array
  bA: Uint8Array
  rA: Uint8Array
  qA: Uint8Array
  qdA: Uint8Array
  att: Uint8Array
  targets: number[][]
  ma: Uint8Array // mobility area
  ring: Uint8Array // king ring of the enemy king
  ringFull: Uint8Array
  K: [number, number] | null // our king
  k: [number, number] | null // enemy king
  cnt: Record<string, number> // piece counts
  // memo
  cache: Float64Array
  m: Map<string, number>
}

function swapCase(p: string) {
  if (p === '-') return p
  const u = p.toUpperCase()
  return u === p ? p.toLowerCase() : u
}

function newSide(b: string[], c: boolean[], w: boolean, rule50: number, flipped: boolean): Side {
  return {
    b, c, w, rule50, flipped, other: null as unknown as Side,
    pin: new Int8Array(64), pA: new Uint8Array(64), kA: new Uint8Array(64), nA: new Uint8Array(64),
    bA: new Uint8Array(64), rA: new Uint8Array(64), qA: new Uint8Array(64), qdA: new Uint8Array(64),
    att: new Uint8Array(64), targets: [], ma: new Uint8Array(64), ring: new Uint8Array(64),
    ringFull: new Uint8Array(64), K: null, k: null, cnt: {}, cache: new Float64Array(64 * 9).fill(NaN), m: new Map(),
  }
}

function parseFen(fen: string): { w: Side; b: Side } {
  const parts = fen.trim().split(/\s+/)
  const board: string[] = new Array(64).fill('-')
  let x = 0, y = 0
  for (const ch of parts[0]) {
    if (ch === '/') { x = 0; y++; continue }
    if (ch >= '1' && ch <= '8') { x += Number(ch); continue }
    if ('KQRBNPkqrbnp'.includes(ch) && x < 8 && y < 8) board[y * 8 + x] = ch
    x++
  }
  const cs = parts[2] ?? 'KQkq'
  const c = [cs.includes('K'), cs.includes('Q'), cs.includes('k'), cs.includes('q')]
  const toMove = parts[1] !== 'b'
  const rule50 = Number(parts[4]) || 0
  const flippedBoard: string[] = new Array(64)
  for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) flippedBoard[yy * 8 + xx] = swapCase(board[(7 - yy) * 8 + xx])
  const w = newSide(board, c, toMove, rule50, false)
  const b = newSide(flippedBoard, [c[2], c[3], c[0], c[1]], !toMove, rule50, true)
  w.other = b
  b.other = w
  prepare(w)
  prepare(b)
  return { w, b }
}

const B = (o: Side, x: number, y: number) => (x >= 0 && x <= 7 && y >= 0 && y <= 7 ? o.b[y * 8 + x] : 'x')
const inb = (x: number, y: number) => x >= 0 && x <= 7 && y >= 0 && y <= 7
const isOurs = (p: string) => p.length === 1 && 'PNBRQK'.includes(p)
const isTheirs = (p: string) => p.length === 1 && 'pnbrqk'.includes(p)
const rankOf = (y: number) => 8 - y

const SLOT = { bw: 0, span: 1, osq: 2, kac: 3, cp: 4, sc: 5 } as const
function memoSq(o: Side, slot: number, x: number, y: number, f: () => number): number {
  const i = slot * 64 + y * 8 + x
  const v = o.cache[i]
  if (v === v) return v // cached unless NaN
  return (o.cache[i] = f())
}
function memo(o: Side, key: string, f: () => number): number {
  const v = o.m.get(key)
  if (v !== undefined) return v
  const r = f()
  o.m.set(key, r)
  return r
}

const DIR8: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
const DIAG: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
const ORTH: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const KNIGHT: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]

/** Guide: "Pinned direction". */
function pinnedDirection(o: Side, x: number, y: number): number {
  const p = B(o, x, y)
  if (!'PNBRQK'.includes(p.toUpperCase())) return 0
  const color = isOurs(p) ? 1 : -1
  for (const [ix, iy] of DIR8) {
    let king = false
    for (let d = 1; d < 8; d++) {
      const b = B(o, x + d * ix, y + d * iy)
      if (b === 'K') king = true
      if (b !== '-') break
    }
    if (king) {
      for (let d = 1; d < 8; d++) {
        const b = B(o, x - d * ix, y - d * iy)
        if (b === 'q' || (b === 'b' && ix * iy !== 0) || (b === 'r' && ix * iy === 0)) return Math.abs(ix + iy * 3) * color
        if (b !== '-') break
      }
    }
  }
  return 0
}

/** Guide: "King ring" (ring around the enemy king 'k'). */
function kingRingLit(o: Side, x: number, y: number, full: boolean): number {
  if (!full && B(o, x + 1, y - 1) === 'p' && B(o, x - 1, y - 1) === 'p') return 0
  for (let ix = -2; ix <= 2; ix++) {
    for (let iy = -2; iy <= 2; iy++) {
      if (B(o, x + ix, y + iy) === 'k'
        && ((ix >= -1 && ix <= 1) || x + ix === 0 || x + ix === 7)
        && ((iy >= -1 && iy <= 1) || y + iy === 0 || y + iy === 7)) return 1
    }
  }
  return 0
}
const kingRing = (o: Side, x: number, y: number, full = false) =>
  inb(x, y) ? (full ? o.ringFull : o.ring)[y * 8 + x] : kingRingLit(o, x, y, full)

function prepare(o: Side) {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const p = o.b[y * 8 + x]
    if (p === '-') continue
    o.cnt[p] = (o.cnt[p] ?? 0) + 1
    if (p === 'K') o.K = [x, y]
    if (p === 'k') o.k = [x, y]
  }
  for (let s = 0; s < 64; s++) if (o.b[s] !== '-') o.pin[s] = pinnedDirection(o, s & 7, s >> 3)
  const ray = (s: number, dirs: [number, number][], pass: string, arr: Uint8Array, t: number[], diagArr?: Uint8Array) => {
    const x = s & 7, y = s >> 3, dir = o.pin[s]
    for (const [dx, dy] of dirs) {
      if (dir !== 0 && Math.abs(dx + dy * 3) !== dir) continue
      for (let d = 1; d < 8; d++) {
        const tx = x + d * dx, ty = y + d * dy
        if (!inb(tx, ty)) break
        const ts = ty * 8 + tx
        arr[ts]++
        if (diagArr && dx !== 0 && dy !== 0) diagArr[ts]++
        t.push(ts)
        if (!pass.includes(o.b[ts])) break
      }
    }
  }
  for (let s = 0; s < 64; s++) {
    const p = o.b[s], x = s & 7, y = s >> 3
    const t: number[] = []
    if (p === 'P') {
      for (const dx of [-1, 1]) if (inb(x + dx, y - 1)) o.pA[(y - 1) * 8 + x + dx]++
    } else if (p === 'K') {
      for (const [dx, dy] of DIR8) if (inb(x + dx, y + dy)) o.kA[(y + dy) * 8 + x + dx] = 1
    } else if (p === 'N') {
      if (!(o.pin[s] > 0)) {
        for (const [dx, dy] of KNIGHT) if (inb(x + dx, y + dy)) { o.nA[(y + dy) * 8 + x + dx]++; t.push((y + dy) * 8 + x + dx) }
      }
    } else if (p === 'B') ray(s, DIAG, '-Qq', o.bA, t)
    else if (p === 'R') ray(s, ORTH, '-RQq', o.rA, t)
    else if (p === 'Q') ray(s, DIR8, '-', o.qA, t, o.qdA)
    o.targets[s] = t
  }
  for (let s = 0; s < 64; s++) {
    o.att[s] = o.pA[s] + o.kA[s] + o.nA[s] + o.bA[s] + o.rA[s] + o.qA[s]
    const x = s & 7, y = s >> 3, b = o.b[s]
    o.ma[s] = b === 'K' || b === 'Q' || B(o, x - 1, y - 1) === 'p' || B(o, x + 1, y - 1) === 'p'
      || (b === 'P' && (rankOf(y) < 4 || B(o, x, y - 1) !== '-')) || o.pin[s] !== 0 ? 0 : 1
  }
  // king ring: same squares as the guide's "King ring" scan, enumerated from the enemy king outwards
  for (let s = 0; s < 64; s++) {
    if (o.b[s] !== 'k') continue
    const kx = s & 7, ky = s >> 3
    for (let x = kx - 2; x <= kx + 2; x++) for (let y = ky - 2; y <= ky + 2; y++) {
      if (!inb(x, y)) continue
      const dx = kx - x, dy = ky - y
      if ((Math.abs(dx) <= 1 || kx === 0 || kx === 7) && (Math.abs(dy) <= 1 || ky === 0 || ky === 7)) {
        o.ringFull[y * 8 + x] = 1
        if (!(B(o, x + 1, y - 1) === 'p' && B(o, x - 1, y - 1) === 'p')) o.ring[y * 8 + x] = 1
      }
    }
  }
}

// Literal (target-side) attack functions; only needed for off-board squares, which the guide's
// "Passed block" queries on the a/h files.
function attackLit(o: Side, x: number, y: number): number {
  let v = 0
  if (B(o, x - 1, y + 1) === 'P') v++
  if (B(o, x + 1, y + 1) === 'P') v++
  for (const [ix, iy] of DIR8) if (B(o, x + ix, y + iy) === 'K') { v++; break }
  for (const [ix, iy] of KNIGHT) if (B(o, x + ix, y + iy) === 'N' && !(o.pin[(y + iy) * 8 + x + ix] > 0)) v++
  const slide = (dirs: [number, number][], piece: string, pass: string) => {
    for (const [ix, iy] of dirs) {
      for (let d = 1; d < 8; d++) {
        const b = B(o, x + d * ix, y + d * iy)
        if (b === piece) {
          const dir = o.pin[(y + d * iy) * 8 + x + d * ix]
          if (dir === 0 || Math.abs(ix + iy * 3) === dir) v++
        }
        if (!pass.includes(b)) break
      }
    }
  }
  slide(DIAG, 'B', '-Qq')
  slide(ORTH, 'R', '-RQq')
  slide(DIR8, 'Q', '-')
  return v
}
const attack = (o: Side, x: number, y: number) => (inb(x, y) ? o.att[y * 8 + x] : attackLit(o, x, y))
/** Attack count of the enemy on our square (x, y), i.e. guide's attack(colorflip(pos), {x, 7 - y}). */
const enemyAttack = (o: Side, x: number, y: number) => attack(o.other, x, 7 - y)

const count = (o: Side, p: string) => o.cnt[p] ?? 0

// ───────────────────────── material ─────────────────────────

const PIECE_MG = [124, 781, 825, 1276, 2538]
const PIECE_EG = [206, 854, 915, 1380, 2682]

function nonPawnMaterial(o: Side): number {
  return memo(o, 'npm', () => {
    let v = 0
    for (let s = 0; s < 64; s++) { const i = 'NBRQ'.indexOf(o.b[s]); if (i >= 0) v += PIECE_MG[i + 1] }
    return v
  })
}

const PSQT_MG = [
  [[-175, -92, -74, -73], [-77, -41, -27, -15], [-61, -17, 6, 12], [-35, 8, 40, 49], [-34, 13, 44, 51], [-9, 22, 58, 53], [-67, -27, 4, 37], [-201, -83, -56, -26]],
  [[-53, -5, -8, -23], [-15, 8, 19, 4], [-7, 21, -5, 17], [-5, 11, 25, 39], [-12, 29, 22, 31], [-16, 6, 1, 11], [-17, -14, 5, 0], [-48, 1, -14, -23]],
  [[-31, -20, -14, -5], [-21, -13, -8, 6], [-25, -11, -1, 3], [-13, -5, -4, -6], [-27, -15, -4, 3], [-22, -2, 6, 12], [-2, 12, 16, 18], [-17, -19, -1, 9]],
  [[3, -5, -5, 4], [-3, 5, 8, 12], [-3, 6, 13, 7], [4, 5, 9, 8], [0, 14, 12, 5], [-4, 10, 6, 8], [-5, 6, 10, 8], [-2, -2, 1, -2]],
  [[271, 327, 271, 198], [278, 303, 234, 179], [195, 258, 169, 120], [164, 190, 138, 98], [154, 179, 105, 70], [123, 145, 81, 31], [88, 120, 65, 33], [59, 89, 45, -1]],
]
const PSQT_EG = [
  [[-96, -65, -49, -21], [-67, -54, -18, 8], [-40, -27, -8, 29], [-35, -2, 13, 28], [-45, -16, 9, 39], [-51, -44, -16, 17], [-69, -50, -51, 12], [-100, -88, -56, -17]],
  [[-57, -30, -37, -12], [-37, -13, -17, 1], [-16, -1, -2, 10], [-20, -6, 0, 17], [-17, -1, -14, 15], [-30, 6, 4, 6], [-31, -20, -1, 1], [-46, -42, -37, -24]],
  [[-9, -13, -10, -9], [-12, -9, -1, -2], [6, -8, -2, -6], [-6, 1, -9, 7], [-5, 8, 7, -6], [6, 1, -7, 10], [4, 5, 20, -5], [18, 0, 19, 13]],
  [[-69, -57, -47, -26], [-55, -31, -22, -4], [-39, -18, -9, 3], [-23, -3, 13, 24], [-29, -6, 9, 21], [-38, -18, -12, 1], [-50, -27, -24, -8], [-75, -52, -43, -36]],
  [[1, 45, 85, 76], [53, 100, 133, 135], [88, 130, 169, 175], [103, 156, 172, 172], [96, 166, 199, 199], [92, 172, 184, 191], [47, 121, 116, 131], [11, 59, 73, 78]],
]
const PAWN_PSQT_MG = [[0, 0, 0, 0, 0, 0, 0, 0], [3, 3, 10, 19, 16, 19, 7, -5], [-9, -15, 11, 15, 32, 22, 5, -22], [-4, -23, 6, 20, 40, 17, 4, -8], [13, 0, -13, 1, 11, -2, -13, 5],
  [5, -12, -7, 22, -8, -5, -15, -8], [-7, 7, -3, -13, 5, -16, 10, -8], [0, 0, 0, 0, 0, 0, 0, 0]]
const PAWN_PSQT_EG = [[0, 0, 0, 0, 0, 0, 0, 0], [-10, -6, 10, 0, 14, 7, -5, -19], [-10, -10, -10, 4, 4, 3, -6, -4], [6, -2, -8, -4, -13, -12, -10, -9], [10, 5, 4, -5, -5, -5, 14, 9],
  [28, 20, 21, 28, 30, 7, 6, 13], [0, -11, 12, 21, 25, 19, 4, 7], [0, 0, 0, 0, 0, 0, 0, 0]]

function psqt(o: Side, x: number, y: number, mg: boolean): number {
  const i = 'PNBRQK'.indexOf(B(o, x, y))
  if (i < 0) return 0
  if (i === 0) return (mg ? PAWN_PSQT_MG : PAWN_PSQT_EG)[7 - y][x]
  return (mg ? PSQT_MG : PSQT_EG)[i - 1][7 - y][Math.min(x, 7 - x)]
}

const QO = [[0], [40, 38], [32, 255, -62], [0, 104, 4, 0], [-26, -2, 47, 105, -208], [-189, 24, 117, 133, -134, -6]]
const QT = [[0], [36, 0], [9, 63, 0], [59, 65, 42, 0], [46, 39, 24, -24, 0], [97, 100, -42, 137, 268, 0]]

/** Guide: "Imbalance" summed over our pieces (same arithmetic, counted by piece type). */
function imbalance(o: Side): number {
  const ours = [0, 0, 0, 0, 0, 0], theirs = [0, 0, 0, 0, 0, 0]
  for (let s = 0; s < 64; s++) {
    const i = 'XPNBRQ'.indexOf(o.b[s]); if (i > 0) ours[i]++
    const j = 'xpnbrq'.indexOf(o.b[s]); if (j > 0) theirs[j]++
  }
  let v = 0
  for (let j = 1; j <= 5; j++) {
    if (!ours[j]) continue
    let per = 0
    for (let i = 1; i <= j; i++) per += QO[j][i] * ours[i] + QT[j][i] * theirs[i]
    if (theirs[3] > 1) per += QT[j][0]
    if (ours[3] > 1) per += QO[j][0]
    v += per * ours[j]
  }
  return v
}
const bishopPair = (o: Side) => (count(o, 'B') >= 2 ? 1438 : 0)

// ───────────────────────── pawns ─────────────────────────

function isolated(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  for (let yy = 0; yy < 8; yy++) if (B(o, x - 1, yy) === 'P' || B(o, x + 1, yy) === 'P') return 0
  return 1
}
function opposed(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  for (let yy = 0; yy < y; yy++) if (B(o, x, yy) === 'p') return 1
  return 0
}
function phalanx(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  return B(o, x - 1, y) === 'P' || B(o, x + 1, y) === 'P' ? 1 : 0
}
function supported(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  return (B(o, x - 1, y + 1) === 'P' ? 1 : 0) + (B(o, x + 1, y + 1) === 'P' ? 1 : 0)
}
function backward(o: Side, x: number, y: number): number {
  return memoSq(o, SLOT.bw, x, y, () => {
    if (B(o, x, y) !== 'P') return 0
    for (let yy = y; yy < 8; yy++) if (B(o, x - 1, yy) === 'P' || B(o, x + 1, yy) === 'P') return 0
    if (B(o, x - 1, y - 2) === 'p' || B(o, x + 1, y - 2) === 'p' || B(o, x, y - 1) === 'p') return 1
    return 0
  })
}
function doubled(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  if (B(o, x, y + 1) !== 'P') return 0
  if (B(o, x - 1, y + 1) === 'P') return 0
  if (B(o, x + 1, y + 1) === 'P') return 0
  return 1
}
const connected = (o: Side, x: number, y: number) => (supported(o, x, y) || phalanx(o, x, y) ? 1 : 0)
function connectedBonus(o: Side, x: number, y: number): number {
  if (!connected(o, x, y)) return 0
  const seed = [0, 7, 8, 12, 29, 48, 86]
  const op = opposed(o, x, y), ph = phalanx(o, x, y), su = supported(o, x, y)
  const r = rankOf(y)
  if (r < 2 || r > 7) return 0
  return seed[r - 1] * (2 + ph - op) + 21 * su
}
function weakUnopposedPawn(o: Side, x: number, y: number): number {
  if (opposed(o, x, y)) return 0
  if (isolated(o, x, y)) return 1
  return backward(o, x, y) ? 1 : 0
}
function weakLever(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  if (B(o, x - 1, y - 1) !== 'p' || B(o, x + 1, y - 1) !== 'p') return 0
  if (B(o, x - 1, y + 1) === 'P' || B(o, x + 1, y + 1) === 'P') return 0
  return 1
}
function blocked(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  if (y !== 2 && y !== 3) return 0
  if (B(o, x, y - 1) !== 'p') return 0
  return 4 - y
}
function doubledIsolated(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  if (!isolated(o, x, y)) return 0
  let obe = 0, eop = 0, ene = 0
  for (let yy = 0; yy < 8; yy++) {
    if (yy > y && B(o, x, yy) === 'P') obe++
    if (yy < y && B(o, x, yy) === 'p') eop++
    if (B(o, x - 1, yy) === 'p' || B(o, x + 1, yy) === 'p') ene++
  }
  return obe > 0 && ene === 0 && eop > 0 ? 1 : 0
}
function pawnAttacksSpan(o: Side, x: number, y: number): number {
  return memoSq(o, SLOT.span, x, y, () => {
    const o2 = o.other
    for (let yy = 0; yy < y; yy++) {
      if (B(o, x - 1, yy) === 'p' && (yy === y - 1 || (B(o, x - 1, yy + 1) !== 'P' && !backward(o2, x - 1, 7 - yy)))) return 1
      if (B(o, x + 1, yy) === 'p' && (yy === y - 1 || (B(o, x + 1, yy + 1) !== 'P' && !backward(o2, x + 1, 7 - yy)))) return 1
    }
    return 0
  })
}

// ───────────────────────── mobility ─────────────────────────

const MOB_MG = [
  [-62, -53, -12, -4, 3, 13, 22, 28, 33],
  [-48, -20, 16, 26, 38, 51, 55, 63, 63, 68, 81, 81, 91, 98],
  [-60, -20, 2, 3, 3, 11, 22, 31, 40, 40, 41, 48, 57, 57, 62],
  [-30, -12, -8, -9, 20, 23, 23, 35, 38, 53, 64, 65, 65, 66, 67, 67, 72, 72, 77, 79, 93, 108, 108, 108, 110, 114, 114, 116],
]
const MOB_EG = [
  [-81, -56, -31, -16, 5, 11, 17, 20, 25],
  [-59, -23, -3, 13, 24, 42, 54, 57, 65, 73, 78, 86, 88, 97],
  [-78, -17, 23, 39, 70, 99, 103, 121, 134, 139, 158, 164, 168, 169, 172],
  [-48, -30, -7, 19, 40, 55, 59, 75, 78, 96, 96, 100, 121, 127, 131, 133, 136, 141, 147, 150, 151, 168, 168, 171, 182, 182, 192, 219],
]

function mobility(o: Side, x: number, y: number): number {
  const s = y * 8 + x, p = o.b[s]
  if (!'NBRQ'.includes(p)) return 0
  let v = 0
  for (const t of o.targets[s]) if (o.ma[t] && (p === 'R' || p === 'Q' || o.b[t] !== 'Q')) v++
  return v
}
function mobilityMg(o: Side): number {
  return memo(o, 'mobmg', () => {
    let v = 0
    for (let s = 0; s < 64; s++) { const i = 'NBRQ'.indexOf(o.b[s]); if (i >= 0) v += MOB_MG[i][mobility(o, s & 7, s >> 3)] }
    return v
  })
}

// ───────────────────────── pieces ─────────────────────────

function outpostSquare(o: Side, x: number, y: number): number {
  return memoSq(o, SLOT.osq, x, y, () => {
    const r = rankOf(y)
    if (r < 4 || r > 6) return 0
    if (B(o, x - 1, y + 1) !== 'P' && B(o, x + 1, y + 1) !== 'P') return 0
    if (pawnAttacksSpan(o, x, y)) return 0
    return 1
  })
}
function outpost(o: Side, x: number, y: number): number {
  const p = B(o, x, y)
  if (p !== 'N' && p !== 'B') return 0
  return outpostSquare(o, x, y)
}
/** Guide: "Reachable outpost"; also returns the first reachable square found. */
function reachableOutpost(o: Side, x: number, y: number): { v: number; sq: number } {
  const p = B(o, x, y)
  if (p !== 'B' && p !== 'N') return { v: 0, sq: -1 }
  let v = 0, sq = -1
  const ts = [...o.targets[y * 8 + x]].sort((a, b) => (a & 7) - (b & 7) || (a >> 3) - (b >> 3))
  for (const t of ts) {
    const tx = t & 7, ty = t >> 3
    if (ty < 2 || ty > 4 || isOurs(o.b[t])) continue
    if (!outpostSquare(o, tx, ty)) continue
    const support = B(o, tx - 1, ty + 1) === 'P' || B(o, tx + 1, ty + 1) === 'P' ? 2 : 1
    if (support > v) { v = support; sq = t }
  }
  return { v, sq }
}
function outpostTotal(o: Side, x: number, y: number): number {
  const p = B(o, x, y)
  if (p !== 'N' && p !== 'B') return 0
  const knight = p === 'N'
  if (!outpost(o, x, y)) {
    if (!knight) return 0
    return reachableOutpost(o, x, y).v ? 1 : 0
  }
  if (knight && (x < 2 || x > 5)) {
    let ea = 0, cnt = 0
    for (let xx = 0; xx < 8; xx++) {
      for (let yy = 0; yy < 8; yy++) {
        const b = B(o, xx, yy)
        if (((Math.abs(x - xx) === 2 && Math.abs(y - yy) === 1) || (Math.abs(x - xx) === 1 && Math.abs(y - yy) === 2))
          && 'nbrqk'.includes(b)) ea = 1
        if (((xx < 4 && x < 4) || (xx >= 4 && x >= 4)) && 'nbrqk'.includes(b)) cnt++
      }
    }
    if (!ea && cnt <= 1) return 2
  }
  return knight ? 4 : 3
}
function minorBehindPawn(o: Side, x: number, y: number): number {
  const p = B(o, x, y)
  if (p !== 'B' && p !== 'N') return 0
  return B(o, x, y - 1).toUpperCase() === 'P' ? 1 : 0
}
function bishopPawns(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'B') return 0
  const c = (x + y) % 2
  let v = 0, blockedCount = 0
  for (let xx = 0; xx < 8; xx++) {
    for (let yy = 0; yy < 8; yy++) {
      if (B(o, xx, yy) === 'P' && c === (xx + yy) % 2) v++
      if (B(o, xx, yy) === 'P' && xx > 1 && xx < 6 && B(o, xx, yy - 1) !== '-') blockedCount++
    }
  }
  return v * (blockedCount + (o.pA[y * 8 + x] > 0 ? 0 : 1))
}
function bishopXrayPawns(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'B') return 0
  let n = 0
  for (let s = 0; s < 64; s++) if (o.b[s] === 'p' && Math.abs(x - (s & 7)) === Math.abs(y - (s >> 3))) n++
  return n
}
function rookOnQueenFile(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'R') return 0
  for (let yy = 0; yy < 8; yy++) if (B(o, x, yy).toUpperCase() === 'Q') return 1
  return 0
}
function rookOnKingRing(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'R') return 0
  if (kingAttackersCount(o, x, y) > 0) return 0
  for (let yy = 0; yy < 8; yy++) if (kingRing(o, x, yy)) return 1
  return 0
}
function bishopOnKingRing(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'B') return 0
  if (kingAttackersCount(o, x, y) > 0) return 0
  for (const [ix, iy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    for (let d = 1; d < 8; d++) {
      const xx = x + d * ix, yy = y + d * iy
      if (B(o, xx, yy) === 'x') break
      if (kingRing(o, xx, yy)) return 1
      if (B(o, xx, yy).toUpperCase() === 'P') break
    }
  }
  return 0
}
function rookOnFile(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'R') return 0
  let open = 1
  for (let yy = 0; yy < 8; yy++) {
    if (B(o, x, yy) === 'P') return 0
    if (B(o, x, yy) === 'p') open = 0
  }
  return open + 1
}
function trappedRook(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'R') return 0
  if (rookOnFile(o, x, y)) return 0
  if (mobility(o, x, y) > 3) return 0
  const k = o.K
  const kx = k ? k[0] : 0
  if ((kx < 4) !== (x < kx)) return 0
  return 1
}
function weakQueen(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'Q') return 0
  for (const [ix, iy] of DIR8) {
    let n = 0
    for (let d = 1; d < 8; d++) {
      const b = B(o, x + d * ix, y + d * iy)
      if (b === 'r' && (ix === 0 || iy === 0) && n === 1) return 1
      if (b === 'b' && ix !== 0 && iy !== 0 && n === 1) return 1
      if (b !== '-') n++
    }
  }
  return 0
}
function queenInfiltration(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'Q') return 0
  if (y > 3) return 0
  if (B(o, x + 1, y - 1) === 'p' || B(o, x - 1, y - 1) === 'p') return 0
  if (pawnAttacksSpan(o, x, y)) return 0
  return 1
}
function kingProtector(o: Side, x: number, y: number): number {
  const p = B(o, x, y)
  if (p !== 'N' && p !== 'B') return 0
  const k = o.K
  return k ? Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) : 0
}
function longDiagonalBishop(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'B') return 0
  if (x - y !== 0 && x - (7 - y) !== 0) return 0
  let x1 = x, y1 = y
  if (Math.min(x1, 7 - x1) > 2) return 0
  for (let i = Math.min(x1, 7 - x1); i < 4; i++) {
    if (B(o, x1, y1) === 'p' || B(o, x1, y1) === 'P') return 0
    if (x1 < 4) x1++; else x1--
    if (y1 < 4) y1++; else y1--
  }
  return 1
}

// ───────────────────────── king ─────────────────────────

function kingAttackersCount(o: Side, x: number, y: number): number {
  return memoSq(o, SLOT.kac, x, y, () => {
    const p = B(o, x, y)
    if (!'PNBRQ'.includes(p) || p === 'x') return 0
    if (p === 'P') {
      let v = 0
      for (const dir of [-1, 1]) {
        const fr = B(o, x + dir * 2, y) === 'P'
        if (x + dir >= 0 && x + dir <= 7 && kingRing(o, x + dir, y - 1, true)) v += fr ? 0.5 : 1
      }
      return v
    }
    for (const t of o.targets[y * 8 + x]) if (o.ring[t]) return 1
    return 0
  })
}
function kingAttacks(o: Side, x: number, y: number): number {
  if (!'NBRQ'.includes(B(o, x, y)) || B(o, x, y) === 'x') return 0
  if (kingAttackersCount(o, x, y) === 0) return 0
  const k = o.k
  const kx = k ? k[0] : 0, ky = k ? k[1] : 0
  let v = 0
  for (const t of o.targets[y * 8 + x]) {
    const tx = t & 7, ty = t >> 3
    if (Math.abs(tx - kx) <= 1 && Math.abs(ty - ky) <= 1 && (tx !== kx || ty !== ky)) v++
  }
  return v
}
function weakSquares(o: Side, x: number, y: number): number {
  if (attack(o, x, y)) {
    const a2 = enemyAttack(o, x, y)
    if (a2 >= 2) return 0
    if (a2 === 0) return 1
    const fs = (7 - y) * 8 + x
    if (o.other.kA[fs] || o.other.qA[fs]) return 1
  }
  return 0
}
function check(o: Side, x: number, y: number, type: number | null): number {
  const s = y * 8 + x
  const ray = (dirs: [number, number][]) => {
    for (const [ix, iy] of dirs) {
      for (let d = 1; d < 8; d++) {
        const b = B(o, x + d * ix, y + d * iy)
        if (b === 'k') return true
        if (b !== '-' && b !== 'q') break
      }
    }
    return false
  }
  if ((o.rA[s] && (type === null || type === 2 || type === 4)) || (o.qA[s] && (type === null || type === 3))) {
    if (ray(ORTH)) return 1
  }
  if ((o.bA[s] && (type === null || type === 1 || type === 4)) || (o.qA[s] && (type === null || type === 3))) {
    if (ray(DIAG)) return 1
  }
  if (o.nA[s] && (type === null || type === 0 || type === 4)) {
    for (const [ix, iy] of KNIGHT) if (B(o, x + ix, y + iy) === 'k') return 1
  }
  return 0
}
function safeCheck(o: Side, x: number, y: number, type: number): number {
  return memoSq(o, SLOT.sc + type, x, y, () => {
    if (isOurs(B(o, x, y))) return 0
    if (!check(o, x, y, type)) return 0
    if (type === 3 && safeCheck(o, x, y, 2)) return 0
    if (type === 1 && safeCheck(o, x, y, 3)) return 0
    if ((!enemyAttack(o, x, y) || (weakSquares(o, x, y) && attack(o, x, y) > 1))
      && (type !== 3 || !o.other.qA[(7 - y) * 8 + x])) return 1
    return 0
  })
}
const safeCheckSum = (o: Side, type: number) =>
  memo(o, `scs${type}`, () => { let v = 0; for (let s = 0; s < 64; s++) v += safeCheck(o, s & 7, s >> 3, type); return v })

function flankZone(o: Side, x: number, y: number): boolean {
  if (y > 4) return false
  const k = o.k
  if (k) {
    const kx = k[0]
    if (kx === 0 && x > 2) return false
    if (kx < 3 && x > 3) return false
    if (kx >= 3 && kx < 5 && (x < 2 || x > 5)) return false
    if (kx >= 5 && x < 4) return false
    if (kx === 7 && x < 5) return false
  }
  return true
}
function flankAttack(o: Side): number {
  return memo(o, 'fa', () => {
    let v = 0
    for (let s = 0; s < 64; s++) {
      const x = s & 7, y = s >> 3
      if (!flankZone(o, x, y)) continue
      const a = o.att[s]
      if (a) v += a > 1 ? 2 : 1
    }
    return v
  })
}
function flankDefense(o: Side): number {
  let v = 0
  for (let s = 0; s < 64; s++) {
    const x = s & 7, y = s >> 3
    if (flankZone(o, x, y) && enemyAttack(o, x, y) > 0) v++
  }
  return v
}
function pawnlessFlank(o: Side): number {
  const pawns = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let s = 0; s < 64; s++) if (o.b[s].toUpperCase() === 'P') pawns[s & 7]++
  const k = o.k
  const kx = k ? k[0] : 0
  let sum: number
  if (kx === 0) sum = pawns[0] + pawns[1] + pawns[2]
  else if (kx < 3) sum = pawns[0] + pawns[1] + pawns[2] + pawns[3]
  else if (kx < 5) sum = pawns[2] + pawns[3] + pawns[4] + pawns[5]
  else if (kx < 7) sum = pawns[4] + pawns[5] + pawns[6] + pawns[7]
  else sum = pawns[5] + pawns[6] + pawns[7]
  return sum === 0 ? 1 : 0
}

const WEAKNESS = [[-6, 81, 93, 58, 39, 18, 25], [-43, 61, 35, -49, -29, -11, -63], [-10, 75, 23, -2, 32, 3, -45], [-39, -13, -29, -52, -48, -67, -166]]
const UNBLOCKED_STORM = [[85, -289, -166, 97, 50, 45, 50], [46, -25, 122, 45, 37, -10, 20], [-6, 51, 168, 34, -2, -22, -14], [-15, -11, 101, 4, 11, -15, -29]]
const BLOCKED_STORM = [[0, 0, 76, -10, -7, -4, -1], [0, 0, 78, 15, 10, 6, 2]]

function strengthSquare(o: Side, x: number, y: number): number {
  let v = 5
  const kx = Math.min(6, Math.max(1, x))
  for (let xx = kx - 1; xx <= kx + 1; xx++) {
    let us = 0
    for (let yy = 7; yy >= y; yy--) {
      if (B(o, xx, yy) === 'p' && B(o, xx - 1, yy + 1) !== 'P' && B(o, xx + 1, yy + 1) !== 'P') us = yy
    }
    const f = Math.min(xx, 7 - xx)
    v += WEAKNESS[f][us] || 0
  }
  return v
}
function stormSquare(o: Side, x: number, y: number, eg: boolean): number {
  let v = 0, ev = 5
  const kx = Math.min(6, Math.max(1, x))
  for (let xx = kx - 1; xx <= kx + 1; xx++) {
    let us = 0, them = 0
    for (let yy = 7; yy >= y; yy--) {
      if (B(o, xx, yy) === 'p' && B(o, xx - 1, yy + 1) !== 'P' && B(o, xx + 1, yy + 1) !== 'P') us = yy
      if (B(o, xx, yy) === 'P') them = yy
    }
    const f = Math.min(xx, 7 - xx)
    if (us > 0 && them === us + 1) {
      v += BLOCKED_STORM[0][them]
      ev += BLOCKED_STORM[1][them]
    } else v += UNBLOCKED_STORM[f][them]
  }
  return eg ? ev : v
}
/** Guide: "Shelter strength", "Shelter storm", "Endgame shelter" of the enemy king ('k'). */
function shelter(o: Side): { w: number; s: number; e: number } {
  const key = 'shelter'
  const cached = o.m.get(key + 'w')
  if (cached !== undefined) return { w: cached, s: o.m.get(key + 's')!, e: o.m.get(key + 'e')! }
  let w = 0, s = 1024, e = 0
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      if (B(o, x, y) === 'k' || (o.c[2] && x === 6 && y === 0) || (o.c[3] && x === 2 && y === 0)) {
        const w1 = strengthSquare(o, x, y), s1 = stormSquare(o, x, y, false), e1 = stormSquare(o, x, y, true)
        if (s1 - w1 < s - w) { w = w1; s = s1; e = e1 }
      }
    }
  }
  o.m.set(key + 'w', w); o.m.set(key + 's', s); o.m.set(key + 'e', e)
  return { w, s, e }
}
function kingPawnDistance(o: Side): number {
  const k = o.K
  const kx = k ? k[0] : 0, ky = k ? k[1] : 0
  let v = 6
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const dist = Math.max(Math.abs(x - kx), Math.abs(y - ky))
    if (B(o, x, y) === 'P' && dist < v) v = dist
  }
  return v
}

function kingDanger(o: Side): number {
  return memo(o, 'kd', () => {
    let cnt = 0, weight = 0, kingAtt = 0, weak = 0, unsafe = 0, kd = 0
    const sc = [0, 1, 2, 3].map(t => safeCheckSum(o, t))
    for (let s = 0; s < 64; s++) {
      const x = s & 7, y = s >> 3
      const kac = kingAttackersCount(o, x, y)
      cnt += kac
      if (kac) weight += [0, 81, 52, 44, 10]['PNBRQ'.indexOf(o.b[s])]
      kingAtt += kingAttacks(o, x, y)
      if (weakSquares(o, x, y) && o.ring[s]) weak++
      if ((check(o, x, y, 0) && sc[0] === 0) || (check(o, x, y, 1) && sc[1] === 0) || (check(o, x, y, 2) && sc[2] === 0)) unsafe++
      if (o.other.nA[s] && o.other.kA[s]) kd++
    }
    let blockers = 0
    for (let s = 0; s < 64; s++) if (o.other.pin[s] !== 0) blockers++
    const fa = flankAttack(o), fd = flankDefense(o)
    const noQueen = count(o, 'Q') > 0 ? 0 : 1
    const sh = shelter(o)
    const v = cnt * weight
      + 69 * kingAtt
      + 185 * weak
      - 100 * (kd > 0 ? 1 : 0)
      + 148 * unsafe
      + 98 * blockers
      - 4 * fd
      + ((3 * fa * fa / 8) | 0)
      - 873 * noQueen
      - ((6 * (sh.w - sh.s) / 8) | 0)
      + mobilityMg(o) - mobilityMg(o.other)
      + 37
      + ((772 * Math.min(sc[3], 1.45)) | 0)
      + ((1084 * Math.min(sc[2], 1.75)) | 0)
      + ((645 * Math.min(sc[1], 1.5)) | 0)
      + ((792 * Math.min(sc[0], 1.62)) | 0)
    return v > 100 ? v : 0
  })
}

// ───────────────────────── threats ─────────────────────────

function weakEnemies(o: Side, x: number, y: number): number {
  if (!isTheirs(B(o, x, y))) return 0
  if (B(o, x - 1, y - 1) === 'p' || B(o, x + 1, y - 1) === 'p') return 0
  const a = attack(o, x, y)
  if (!a) return 0
  if (a <= 1 && enemyAttack(o, x, y) > 1) return 0
  return 1
}
function safePawn(o: Side, x: number, y: number): number {
  if (B(o, x, y) !== 'P') return 0
  if (attack(o, x, y)) return 1
  if (!enemyAttack(o, x, y)) return 1
  return 0
}
function threatSafePawn(o: Side, x: number, y: number): number {
  if (!'nbrq'.includes(B(o, x, y)) || B(o, x, y) === 'x') return 0
  if (!o.pA[y * 8 + x]) return 0
  return safePawn(o, x - 1, y + 1) || safePawn(o, x + 1, y + 1) ? 1 : 0
}
function minorThreat(o: Side, x: number, y: number): number {
  const b = B(o, x, y), type = 'pnbrqk'.indexOf(b)
  if (type < 0 || b === 'x') return 0
  const s = y * 8 + x
  if (!o.nA[s] && !o.bA[s]) return 0
  if ((b === 'p' || !(B(o, x - 1, y - 1) === 'p' || B(o, x + 1, y - 1) === 'p'
    || (attack(o, x, y) <= 1 && enemyAttack(o, x, y) > 1))) && !weakEnemies(o, x, y)) return 0
  return type + 1
}
function rookThreat(o: Side, x: number, y: number): number {
  const b = B(o, x, y), type = 'pnbrqk'.indexOf(b)
  if (type < 0 || b === 'x') return 0
  if (!weakEnemies(o, x, y)) return 0
  if (!o.rA[y * 8 + x]) return 0
  return type + 1
}
function hanging(o: Side, x: number, y: number): number {
  if (!weakEnemies(o, x, y)) return 0
  if (B(o, x, y) !== 'p' && attack(o, x, y) > 1) return 1
  if (!enemyAttack(o, x, y)) return 1
  return 0
}
function kingThreat(o: Side, x: number, y: number): number {
  if (!'pnbrq'.includes(B(o, x, y)) || B(o, x, y) === 'x') return 0
  if (!weakEnemies(o, x, y)) return 0
  return o.kA[y * 8 + x] ? 1 : 0
}
function pawnPushThreat(o: Side, x: number, y: number): number {
  if (!isTheirs(B(o, x, y))) return 0
  for (const ix of [-1, 1]) {
    if (B(o, x + ix, y + 2) === 'P' && B(o, x + ix, y + 1) === '-'
      && B(o, x + ix - 1, y) !== 'p' && B(o, x + ix + 1, y) !== 'p'
      && (attack(o, x + ix, y + 1) || !attack(o.other, x + ix, 6 - y))) return 1
    if (y === 3 && B(o, x + ix, y + 3) === 'P' && B(o, x + ix, y + 2) === '-' && B(o, x + ix, y + 1) === '-'
      && B(o, x + ix - 1, y) !== 'p' && B(o, x + ix + 1, y) !== 'p'
      && (attack(o, x + ix, y + 1) || !attack(o.other, x + ix, 6 - y))) return 1
  }
  return 0
}
function sliderOnQueen(o: Side, x: number, y: number): number {
  if (count(o, 'q') !== 1) return 0
  if (B(o, x, y) === 'P') return 0
  if (B(o, x - 1, y - 1) === 'p' || B(o, x + 1, y - 1) === 'p') return 0
  const s = y * 8 + x
  if (o.att[s] <= 1) return 0
  if (!o.ma[s]) return 0
  const fs = (7 - y) * 8 + x
  const diagonal = o.other.qdA[fs]
  const v = count(o, 'Q') === 0 ? 2 : 1
  if (diagonal && o.bA[s]) return v
  if (!diagonal && o.rA[s] && o.other.qA[fs]) return v
  return 0
}
function knightOnQueen(o: Side, x: number, y: number): number {
  const s = y * 8 + x
  if (!o.nA[s]) return 0 // (checked first for speed; every guard below only returns 0)
  if (count(o, 'q') !== 1) return 0
  const q = o.b.indexOf('q'), qx = q & 7, qy = q >> 3
  if (B(o, x, y) === 'P') return 0
  if (B(o, x - 1, y - 1) === 'p' || B(o, x + 1, y - 1) === 'p') return 0
  if (o.att[s] <= 1 && enemyAttack(o, x, y) > 1) return 0
  if (!o.ma[s]) return 0
  const v = count(o, 'Q') === 0 ? 2 : 1
  if (Math.abs(qx - x) === 2 && Math.abs(qy - y) === 1) return v
  if (Math.abs(qx - x) === 1 && Math.abs(qy - y) === 2) return v
  return 0
}
function restricted(o: Side, x: number, y: number): number {
  const s = y * 8 + x
  if (o.att[s] === 0) return 0
  const fs = (7 - y) * 8 + x
  if (!o.other.att[fs]) return 0
  if (o.other.pA[fs] > 0) return 0
  if (o.other.att[fs] > 1 && o.att[s] === 1) return 0
  return 1
}
function weakQueenProtection(o: Side, x: number, y: number): number {
  if (!weakEnemies(o, x, y)) return 0
  return o.other.qA[(7 - y) * 8 + x] ? 1 : 0
}

// ───────────────────────── passed pawns ─────────────────────────

function candidatePassed(o: Side, x: number, y: number): number {
  return memoSq(o, SLOT.cp, x, y, () => {
    if (B(o, x, y) !== 'P') return 0
    let ty1 = 8, ty2 = 8
    for (let yy = y - 1; yy >= 0; yy--) {
      if (B(o, x, yy) === 'P') return 0
      if (B(o, x, yy) === 'p') ty1 = yy
      if (B(o, x - 1, yy) === 'p' || B(o, x + 1, yy) === 'p') ty2 = yy
    }
    if (ty1 === 8 && ty2 >= y - 1) return 1
    if (ty2 < y - 2 || ty1 < y - 1) return 0
    if (ty2 >= y && ty1 === y - 1 && y < 4) {
      if (B(o, x - 1, y + 1) === 'P' && B(o, x - 1, y) !== 'p' && B(o, x - 2, y - 1) !== 'p') return 1
      if (B(o, x + 1, y + 1) === 'P' && B(o, x + 1, y) !== 'p' && B(o, x + 2, y - 1) !== 'p') return 1
    }
    if (B(o, x, y - 1) === 'p') return 0
    const lever = (B(o, x - 1, y - 1) === 'p' ? 1 : 0) + (B(o, x + 1, y - 1) === 'p' ? 1 : 0)
    const leverpush = (B(o, x - 1, y - 2) === 'p' ? 1 : 0) + (B(o, x + 1, y - 2) === 'p' ? 1 : 0)
    const ph = (B(o, x - 1, y) === 'P' ? 1 : 0) + (B(o, x + 1, y) === 'P' ? 1 : 0)
    if (lever - supported(o, x, y) > 1) return 0
    if (leverpush - ph > 0) return 0
    if (lever > 0 && leverpush > 0) return 0
    return 1
  })
}
const candidatePassedSum = (o: Side) =>
  memo(o, 'cps', () => { let v = 0; for (let s = 0; s < 64; s++) v += candidatePassed(o, s & 7, s >> 3); return v })

function passedLeverable(o: Side, x: number, y: number): number {
  if (!candidatePassed(o, x, y)) return 0
  if (B(o, x, y - 1) !== 'p') return 1
  for (const i of [-1, 1]) {
    if (B(o, x + i, y + 1) === 'P' && !isTheirs(B(o, x + i, y))
      && (attack(o, x + i, y) > 0 || attack(o.other, x + i, 7 - y) <= 1)) return 1
  }
  return 0
}
function kingProximity(o: Side, x: number, y: number): number {
  if (!passedLeverable(o, x, y)) return 0
  const r = rankOf(y) - 1
  const w = r > 2 ? 5 * r - 13 : 0
  let v = 0
  if (w <= 0) return 0
  for (let xx = 0; xx < 8; xx++) for (let yy = 0; yy < 8; yy++) {
    if (B(o, xx, yy) === 'k') v += ((Math.min(Math.max(Math.abs(yy - y + 1), Math.abs(xx - x)), 5) * 19 / 4) | 0) * w
    if (B(o, xx, yy) === 'K') {
      v -= Math.min(Math.max(Math.abs(yy - y + 1), Math.abs(xx - x)), 5) * 2 * w
      if (y > 1) v -= Math.min(Math.max(Math.abs(yy - y + 2), Math.abs(xx - x)), 5) * w
    }
  }
  return v
}
function passedBlock(o: Side, x: number, y: number): number {
  if (!passedLeverable(o, x, y)) return 0
  if (rankOf(y) < 4) return 0
  if (B(o, x, y - 1) !== '-') return 0
  const r = rankOf(y) - 1
  const w = r > 2 ? 5 * r - 13 : 0
  const o2 = o.other
  let defended = 0, unsafe = 0, wunsafe = 0, defended1 = 0, unsafe1 = 0
  for (let yy = y - 1; yy >= 0; yy--) {
    if (attack(o, x, yy)) defended++
    if (attack(o2, x, 7 - yy)) unsafe++
    if (attack(o2, x - 1, 7 - yy)) wunsafe++
    if (attack(o2, x + 1, 7 - yy)) wunsafe++
    if (yy === y - 1) { defended1 = defended; unsafe1 = unsafe }
  }
  for (let yy = y + 1; yy < 8; yy++) {
    if (B(o, x, yy) === 'R' || B(o, x, yy) === 'Q') defended1 = defended = y
    if (B(o, x, yy) === 'r' || B(o, x, yy) === 'q') unsafe1 = unsafe = y
  }
  const k = (unsafe === 0 && wunsafe === 0 ? 35 : unsafe === 0 ? 20 : unsafe1 === 0 ? 9 : 0) + (defended1 !== 0 ? 5 : 0)
  return k * w
}
const passedFile = (x: number) => Math.min(x, 7 - x)

// ───────────────────────── space ─────────────────────────

function spaceArea(o: Side, x: number, y: number): number {
  let v = 0
  const rank = rankOf(y), file = x + 1
  if (rank >= 2 && rank <= 4 && file >= 3 && file <= 6
    && B(o, x, y) !== 'P' && B(o, x - 1, y - 1) !== 'p' && B(o, x + 1, y - 1) !== 'p') {
    v++
    if ((B(o, x, y - 1) === 'P' || B(o, x, y - 2) === 'P' || B(o, x, y - 3) === 'P') && !enemyAttack(o, x, y)) v++
  }
  return v
}
function spaceAreaSum(o: Side): number {
  let v = 0
  for (let s = 0; s < 64; s++) v += spaceArea(o, s & 7, s >> 3)
  return v
}
function space(o: Side): number {
  if (nonPawnMaterial(o) + nonPawnMaterial(o.other) < 12222) return 0
  let pieceCount = 0, blockedCount = 0
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const b = B(o, x, y)
    if (isOurs(b)) pieceCount++
    if (b === 'P' && (B(o, x, y - 1) === 'p' || (B(o, x - 1, y - 2) === 'p' && B(o, x + 1, y - 2) === 'p'))) blockedCount++
    if (b === 'p' && (B(o, x, y + 1) === 'P' || (B(o, x - 1, y + 2) === 'P' && B(o, x + 1, y + 2) === 'P'))) blockedCount++
  }
  const weight = pieceCount - 3 + Math.min(blockedCount, 9)
  return (spaceAreaSum(o) * weight * weight / 16) | 0
}

// ───────────────────────── per-side term accumulation ─────────────────────────

const TERM_KEYS = [
  'material', 'psqt', 'imbalance', 'imbalance.bishopPair',
  'pawns.isolated', 'pawns.backward', 'pawns.doubled', 'pawns.connected', 'pawns.weakUnopposed', 'pawns.weakLever', 'pawns.blocked',
  'pieces.outpost', 'pieces.minorBehindPawn', 'pieces.bishopPawns', 'pieces.bishopXrayPawns', 'pieces.rookOnQueenFile',
  'pieces.rookOnKingRing', 'pieces.bishopOnKingRing', 'pieces.rookOnFile', 'pieces.trappedRook', 'pieces.weakQueen',
  'pieces.queenInfiltration', 'pieces.kingProtector', 'pieces.longDiagonalBishop',
  'mobility',
  'threats.hanging', 'threats.kingThreat', 'threats.pawnPush', 'threats.safePawn', 'threats.sliderOnQueen', 'threats.knightOnQueen',
  'threats.restricted', 'threats.weakQueenProtection', 'threats.minor', 'threats.rook',
  'passed', 'space',
  'king.shelter', 'king.danger', 'king.flankAttack', 'king.pawnlessFlank', 'king.pawnDistance',
]
const KEY_INDEX = new Map(TERM_KEYS.map((k, i) => [k, i]))
const GROUP_INDEX = new Map<string, number[]>()
const GROUPS = ['material', 'psqt', 'pawns', 'pieces', 'mobility', 'threats', 'passed', 'space', 'king']

/** Evaluation terms of one side, mg/eg, with per-square contributions (index in that side's orientation). */
class Terms {
  mg = new Float64Array(TERM_KEYS.length)
  eg = new Float64Array(TERM_KEYS.length)
  sq: (Float64Array | undefined)[] = []
  add(key: string, s: number, mg: number, eg: number) {
    if (!mg && !eg) return
    const i = KEY_INDEX.get(key)!
    this.mg[i] += mg
    this.eg[i] += eg
    if (s >= 0) {
      const a = this.sq[i] ??= new Float64Array(128)
      a[s] += mg
      a[64 + s] += eg
    }
  }
  get(key: string, mg: boolean): number {
    return (mg ? this.mg : this.eg)[KEY_INDEX.get(key)!]
  }
  /** Per-square contributions (mg at s, eg at 64 + s), if any. */
  squares(key: string): Float64Array | undefined {
    return this.sq[KEY_INDEX.get(key)!]
  }
  group(g: string, mg: boolean): number {
    let idx = GROUP_INDEX.get(g)
    if (!idx) GROUP_INDEX.set(g, idx = TERM_KEYS.flatMap((k, i) => (k === g || k.startsWith(g + '.') ? [i] : [])))
    const t = mg ? this.mg : this.eg
    let v = 0
    for (const i of idx) v += t[i]
    return v
  }
}

function evalSide(o: Side): Terms {
  const t = new Terms()
  const castle = o.c[0] || o.c[1] ? 1 : 2
  let kingThreats = 0
  for (let s = 0; s < 64; s++) {
    const x = s & 7, y = s >> 3, p = o.b[s]
    // material
    const pi = 'PNBRQ'.indexOf(p)
    if (pi >= 0) t.add('material', s, PIECE_MG[pi], PIECE_EG[pi])
    if (isOurs(p)) t.add('psqt', s, psqt(o, x, y, true), psqt(o, x, y, false))
    // pawns
    if (p === 'P') {
      if (doubledIsolated(o, x, y)) t.add('pawns.isolated', s, -11, -56)
      else if (isolated(o, x, y)) t.add('pawns.isolated', s, -5, -15)
      else if (backward(o, x, y)) t.add('pawns.backward', s, -9, -24)
      const d = doubled(o, x, y)
      t.add('pawns.doubled', s, -11 * d, -56 * d)
      if (connected(o, x, y)) {
        const cb = connectedBonus(o, x, y)
        t.add('pawns.connected', s, cb, (cb * (rankOf(y) - 3) / 4) | 0)
      }
      const wu = weakUnopposedPawn(o, x, y)
      t.add('pawns.weakUnopposed', s, -13 * wu, -27 * wu)
      t.add('pawns.weakLever', s, 0, -56 * weakLever(o, x, y))
      const bl = blocked(o, x, y)
      t.add('pawns.blocked', s, [0, -11, -3][bl], [0, -4, 4][bl])
      // passed
      if (passedLeverable(o, x, y)) {
        const r = rankOf(y) - 1, f = passedFile(x), pb = passedBlock(o, x, y)
        t.add('passed', s, [0, 10, 17, 15, 62, 168, 276][r] + pb - 11 * f, kingProximity(o, x, y) + [0, 28, 33, 41, 72, 177, 260][r] + pb - 8 * f)
      }
    }
    // pieces + mobility
    const mi = 'NBRQ'.indexOf(p)
    if (mi >= 0) {
      const ot = outpostTotal(o, x, y)
      t.add('pieces.outpost', s, [0, 31, -7, 30, 56][ot], [0, 22, 36, 23, 36][ot])
      const mbp = minorBehindPawn(o, x, y)
      t.add('pieces.minorBehindPawn', s, 18 * mbp, 3 * mbp)
      const bp = bishopPawns(o, x, y)
      t.add('pieces.bishopPawns', s, -3 * bp, -7 * bp)
      const bxp = bishopXrayPawns(o, x, y)
      t.add('pieces.bishopXrayPawns', s, -4 * bxp, -5 * bxp)
      const rqf = rookOnQueenFile(o, x, y)
      t.add('pieces.rookOnQueenFile', s, 6 * rqf, 11 * rqf)
      t.add('pieces.rookOnKingRing', s, 16 * rookOnKingRing(o, x, y), 0)
      t.add('pieces.bishopOnKingRing', s, 24 * bishopOnKingRing(o, x, y), 0)
      const rof = rookOnFile(o, x, y)
      t.add('pieces.rookOnFile', s, [0, 19, 48][rof], [0, 7, 29][rof])
      const tr = trappedRook(o, x, y)
      t.add('pieces.trappedRook', s, -tr * 55 * castle, -tr * 13 * castle)
      const wq = weakQueen(o, x, y)
      t.add('pieces.weakQueen', s, -56 * wq, -15 * wq)
      const qi = queenInfiltration(o, x, y)
      t.add('pieces.queenInfiltration', s, -2 * qi, 14 * qi)
      const kp = kingProtector(o, x, y)
      t.add('pieces.kingProtector', s, -(p === 'N' ? 8 : 6) * kp, -9 * kp)
      t.add('pieces.longDiagonalBishop', s, 45 * longDiagonalBishop(o, x, y), 0)
      const mob = mobility(o, x, y)
      t.add('mobility', s, MOB_MG[mi][mob], MOB_EG[mi][mob])
    }
    // threats (per target / attacking square)
    const h = hanging(o, x, y)
    t.add('threats.hanging', s, 69 * h, 36 * h)
    kingThreats += kingThreat(o, x, y)
    const pp = pawnPushThreat(o, x, y)
    t.add('threats.pawnPush', s, 48 * pp, 39 * pp)
    const tsp = threatSafePawn(o, x, y)
    t.add('threats.safePawn', s, 173 * tsp, 94 * tsp)
    const soq = sliderOnQueen(o, x, y)
    t.add('threats.sliderOnQueen', s, 60 * soq, 18 * soq)
    const koq = knightOnQueen(o, x, y)
    t.add('threats.knightOnQueen', s, 16 * koq, 11 * koq)
    const re = restricted(o, x, y)
    t.add('threats.restricted', s, 7 * re, 7 * re)
    t.add('threats.weakQueenProtection', s, 14 * weakQueenProtection(o, x, y), 0)
    const mt = minorThreat(o, x, y), rt = rookThreat(o, x, y)
    t.add('threats.minor', s, [0, 5, 57, 77, 88, 79, 0][mt], [0, 32, 41, 56, 119, 161, 0][mt])
    t.add('threats.rook', s, [0, 3, 37, 42, 0, 58, 0][rt], [0, 46, 68, 60, 38, 41, 0][rt])
  }
  t.add('threats.kingThreat', -1, kingThreats > 0 ? 24 : 0, kingThreats > 0 ? 89 : 0)
  t.add('space', -1, space(o), 0)
  // king (pressure on the enemy king, plus our king's distance to our pawns)
  const kd = kingDanger(o), sh = shelter(o), pf = pawnlessFlank(o)
  t.add('king.shelter', -1, -sh.w + sh.s, sh.e)
  t.add('king.danger', -1, (kd * kd / 4096) | 0, (kd / 16) | 0)
  t.add('king.flankAttack', -1, 8 * flankAttack(o), 0)
  t.add('king.pawnlessFlank', -1, 17 * pf, 95 * pf)
  t.add('king.pawnDistance', -1, 0, -16 * kingPawnDistance(o))
  // bishop pair bonus (informational; it is part of the guide's "Imbalance total" used for the score)
  t.add('imbalance.bishopPair', -1, bishopPair(o) / 16, bishopPair(o) / 16)
  return t
}

// ───────────────────────── main evaluation ─────────────────────────

function phase(o: Side): number {
  const npm = Math.max(3915, Math.min(nonPawnMaterial(o) + nonPawnMaterial(o.other), 15258))
  return (((npm - 3915) * 128) / (15258 - 3915)) | 0
}
function oppositeBishops(o: Side): number {
  if (count(o, 'B') !== 1 || count(o, 'b') !== 1) return 0
  const color = [0, 0]
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    if (B(o, x, y) === 'B') color[0] = (x + y) % 2
    if (B(o, x, y) === 'b') color[1] = (x + y) % 2
  }
  return color[0] === color[1] ? 0 : 1
}
function winnable(o: Side): number {
  let pawns = 0
  const kx = [0, 0], ky = [0, 0], flanks = [0, 0]
  for (let x = 0; x < 8; x++) {
    const open = [0, 0]
    for (let y = 0; y < 8; y++) {
      const b = B(o, x, y)
      if (b.toUpperCase() === 'P') { open[b === 'P' ? 0 : 1] = 1; pawns++ }
      if (b.toUpperCase() === 'K') { kx[b === 'K' ? 0 : 1] = x; ky[b === 'K' ? 0 : 1] = y }
    }
    if (open[0] + open[1] > 0) flanks[x < 4 ? 0 : 1] = 1
  }
  const passedCount = candidatePassedSum(o) + candidatePassedSum(o.other)
  const bothFlanks = flanks[0] && flanks[1] ? 1 : 0
  const outflanking = Math.abs(kx[0] - kx[1]) - Math.abs(ky[0] - ky[1])
  const purePawn = nonPawnMaterial(o) + nonPawnMaterial(o.other) === 0 ? 1 : 0
  const almostUnwinnable = outflanking < 0 && bothFlanks === 0 ? 1 : 0
  const infiltration = ky[0] < 4 || ky[1] > 3 ? 1 : 0
  return 9 * passedCount + 12 * pawns + 9 * outflanking + 21 * bothFlanks + 24 * infiltration + 51 * purePawn - 43 * almostUnwinnable - 110
}
function scaleFactor(o: Side, eg: number): number {
  const o2 = o.other
  const pw = eg > 0 ? o : o2, pb = eg > 0 ? o2 : o
  let sf = 64
  const pcw = count(pw, 'P'), pcb = count(pb, 'P')
  const qcw = count(pw, 'Q'), qcb = count(pb, 'Q')
  const bcw = count(pw, 'B'), bcb = count(pb, 'B')
  const ncw = count(pw, 'N'), ncb = count(pb, 'N')
  const npmw = nonPawnMaterial(pw), npmb = nonPawnMaterial(pb)
  if (pcw === 0 && npmw - npmb <= 825) sf = npmw < 1276 ? 0 : npmb <= 825 ? 4 : 14
  if (sf === 64) {
    const ob = oppositeBishops(o)
    if (ob && npmw === 825 && npmb === 825) sf = 22 + 4 * candidatePassedSum(pw)
    else if (ob) {
      let pc = 0
      for (let s = 0; s < 64; s++) if (isOurs(pw.b[s])) pc++
      sf = 22 + 3 * pc
    } else {
      if (npmw === 1276 && npmb === 1276 && pcw - pcb <= 1) {
        let pawnkingB = 0
        const flank = [0, 0]
        for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
          if (B(pw, x, y) === 'P') flank[x < 4 ? 1 : 0] = 1
          if (B(pb, x, y) === 'K') {
            for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) if (B(pb, x + ix, y + iy) === 'P') pawnkingB = 1
          }
        }
        if (flank[0] !== flank[1] && pawnkingB) return 36
      }
      if (qcw + qcb === 1) sf = 37 + 3 * (qcw === 1 ? bcb + ncb : bcw + ncw)
      else sf = Math.min(sf, 36 + 7 * pcw)
    }
  }
  return sf
}

interface Classical { tw: Terms; tb: Terms; phase: number; mg: number; eg: number; v: number; imbalance: number }

function classical(w: Side, b: Side): Classical {
  const tw = evalSide(w), tb = evalSide(b)
  const imbTotal = ((imbalance(w) - imbalance(b) + bishopPair(w) - bishopPair(b)) / 16) | 0
  let mg = imbTotal, eg = imbTotal
  for (const g of GROUPS) {
    mg += tw.group(g, true) - tb.group(g, true)
    eg += tw.group(g, false) - tb.group(g, false)
  }
  const win = winnable(w)
  mg += (mg > 0 ? 1 : mg < 0 ? -1 : 0) * Math.max(Math.min(win + 50, 0), -Math.abs(mg))
  eg += (eg > 0 ? 1 : eg < 0 ? -1 : 0) * Math.max(win, -Math.abs(eg))
  const p = phase(w)
  const egScaled = eg * scaleFactor(w, eg) / 64
  let v = ((mg * p + ((egScaled * (128 - p)) | 0)) / 128) | 0
  v = ((v / 16) | 0) * 16
  v += 28 * (w.w ? 1 : -1)
  v = (v * (100 - w.rule50) / 100) | 0
  return { tw, tb, phase: p, mg, eg, v, imbalance: imbTotal }
}

/** Internal units → centipawns (the guide's PawnValueEg = 206). */
const toCp = (v: number) => (v * 100) / 206
const taper = (mg: number, eg: number, p: number) => (mg * p + eg * (128 - p)) / 128

/** Raw classical evaluation (internal units, white POV) with mg/eg parts and per-side group sums; for verification. */
export function classicalEval(fen: string): {
  v: number; mg: number; eg: number; phase: number; groups: Record<'w' | 'b', Record<string, [number, number]>>
} {
  const { w, b } = parseFen(fen)
  const c = classical(w, b)
  const groups = { w: {} as Record<string, [number, number]>, b: {} as Record<string, [number, number]> }
  for (const g of GROUPS) {
    groups.w[g] = [c.tw.group(g, true), c.tw.group(g, false)]
    groups.b[g] = [c.tb.group(g, true), c.tb.group(g, false)]
  }
  return { v: c.v, mg: c.mg, eg: c.eg, phase: c.phase, groups }
}

// ───────────────────────── teaching report ─────────────────────────

export interface SideReport {
  isolated: string[]; doubled: string[]; backward: string[]; passed: string[]; connected: string[]; weakUnopposed: string[]
  /** Two adjacent pawns side by side on c/d or d/e, with no own pawns on the neighbouring files and no enemy pawns on their files. */
  hangingPawns: string[]
  /** Occupied outposts (piece set) and empty outpost squares one of our minors can reach (piece null, reachableBy). */
  outposts: { square: string; piece: 'n' | 'b' | null; reachableBy?: string }[]
  /** Squares on relative ranks 3–6, files c–f, not occupied by an own pawn, that no own pawn can ever defend. */
  holes: string[]
  rooksOpenFile: string[]; rooksSemiOpenFile: string[]
  /** Rooks on the relative 7th rank while the enemy king is on the 8th or enemy pawns remain on the 7th. */
  rooksOn7th: string[]
  bishopPair: boolean
  /** Bishops behind two or more own central (c–f) pawns on their colour that are fixed by enemy pawns. */
  badBishops: string[]
  /** Safe central squares behind/around own pawns (guide "Space area" count). */
  space: number
  /** Squares available to knights, bishops, rooks and queens in the mobility area (guide "Mobility"). */
  mobility: number
  /** shield: shelter strength of the pawns in front of this king (guide "Shelter strength", higher = safer);
   *  openFilesNear: files around the king without own pawns; attackers: enemy king attackers count;
   *  danger: enemy "King danger" score (0 = no real attack). */
  king: { square: string; shield: number; openFilesNear: number; attackers: number; danger: number }
  /** Own pieces (not the king) that are attacked and insufficiently defended, or attacked by a cheaper piece. */
  hanging: string[]
}
export interface PositionReport { w: SideReport; b: SideReport; terms: Record<string, { w: number; b: number }>; score: number /* classical eval, white POV, cp */ }

const nameOf = (o: Side, s: number) => FILES[s & 7] + ((o.flipped ? (s >> 3) + 1 : 8 - (s >> 3)))
const idxOf = (o: Side, sq: string) => {
  const x = FILES.indexOf(sq[0]), r = Number(sq[1])
  return (o.flipped ? r - 1 : 8 - r) * 8 + x
}

function strictPassed(o: Side, x: number, y: number): boolean {
  if (B(o, x, y) !== 'P') return false
  for (let yy = y - 1; yy >= 0; yy--) {
    for (let dx = -1; dx <= 1; dx++) if (B(o, x + dx, yy) === 'p') return false
    if (B(o, x, yy) === 'P') return false // the rear pawn of a doubled pair is not passed
  }
  return true
}

function sideReport(o: Side): SideReport {
  const e = o.other
  const r: SideReport = {
    isolated: [], doubled: [], backward: [], passed: [], connected: [], weakUnopposed: [], hangingPawns: [], outposts: [], holes: [],
    rooksOpenFile: [], rooksSemiOpenFile: [], rooksOn7th: [], bishopPair: false, badBishops: [], space: 0, mobility: 0,
    king: { square: '', shield: 0, openFilesNear: 0, attackers: 0, danger: 0 }, hanging: [],
  }
  const fileCount = [0, 0, 0, 0, 0, 0, 0, 0], enemyFile = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let s = 0; s < 64; s++) {
    if (o.b[s] === 'P') fileCount[s & 7]++
    if (o.b[s] === 'p') enemyFile[s & 7]++
  }
  const enemyKing = o.k
  let enemyPawnsOn7 = false
  for (let x = 0; x < 8; x++) if (B(o, x, 1) === 'p') enemyPawnsOn7 = true
  const bishops: number[] = []
  const reach = new Map<number, string>()
  for (let s = 0; s < 64; s++) {
    const x = s & 7, y = s >> 3, p = o.b[s], n = nameOf(o, s)
    if (p === 'P') {
      if (isolated(o, x, y)) r.isolated.push(n)
      else if (backward(o, x, y)) r.backward.push(n)
      if (fileCount[x] > 1) r.doubled.push(n)
      if (strictPassed(o, x, y)) r.passed.push(n)
      if (connected(o, x, y)) r.connected.push(n)
      if (weakUnopposedPawn(o, x, y)) r.weakUnopposed.push(n)
    }
    if ((p === 'N' || p === 'B') && outpost(o, x, y)) r.outposts.push({ square: n, piece: p === 'N' ? 'n' : 'b' })
    if (p === 'R') {
      const f = rookOnFile(o, x, y)
      if (f === 2) r.rooksOpenFile.push(n)
      if (f === 1) r.rooksSemiOpenFile.push(n)
      if (y === 1 && ((enemyKing && enemyKing[1] === 0) || enemyPawnsOn7)) r.rooksOn7th.push(n)
    }
    if (p === 'B') bishops.push(s)
    if ('NBRQ'.includes(p)) r.mobility += mobility(o, x, y)
    r.space += spaceArea(o, x, y)
    // holes: relative ranks 3..6 (y 5..2), files c..f
    if (y >= 2 && y <= 5 && x >= 2 && x <= 5 && p !== 'P') {
      let defendable = false
      for (let yy = y + 1; yy < 8 && !defendable; yy++) if (B(o, x - 1, yy) === 'P' || B(o, x + 1, yy) === 'P') defendable = true
      if (!defendable) r.holes.push(n)
    }
  }
  // empty outposts a minor can reach (knights first)
  for (const piece of ['N', 'B']) {
    for (let s = 0; s < 64; s++) {
      if (o.b[s] !== piece) continue
      for (const t of o.targets[s]) {
        const tx = t & 7, ty = t >> 3
        if (ty < 2 || ty > 4 || isOurs(o.b[t]) || !outpostSquare(o, tx, ty) || reach.has(t)) continue
        reach.set(t, nameOf(o, s))
      }
    }
  }
  for (const [t, by] of [...reach].sort((a, b) => a[0] - b[0])) r.outposts.push({ square: nameOf(o, t), piece: null, reachableBy: by })
  // hanging pawns
  for (let y = 0; y < 8; y++) {
    for (const x of [2, 3]) {
      if (B(o, x, y) !== 'P' || B(o, x + 1, y) !== 'P') continue
      if (fileCount[x - 1] || fileCount[x + 2] || enemyFile[x] || enemyFile[x + 1]) continue
      r.hangingPawns.push(nameOf(o, y * 8 + x), nameOf(o, y * 8 + x + 1))
    }
  }
  // bishops
  r.bishopPair = bishops.length >= 2 && new Set(bishops.map(s => ((s & 7) + (s >> 3)) % 2)).size === 2
  for (const s of bishops) {
    const c = ((s & 7) + (s >> 3)) % 2
    // two or more central (c–f) pawns on the bishop's colour fixed by enemy pawns, bishop behind them
    let fixed = 0, fixedFront = 8
    for (let t = 0; t < 64; t++) {
      const tx = t & 7, ty = t >> 3
      if (o.b[t] !== 'P' || tx < 2 || tx > 5 || (tx + ty) % 2 !== c || B(o, tx, ty - 1) !== 'p') continue
      fixed++
      fixedFront = Math.min(fixedFront, ty)
    }
    if (fixed >= 2 && (s >> 3) > fixedFront) r.badBishops.push(nameOf(o, s))
  }
  // king (evaluated from the enemy's orientation, where our king is 'k')
  const k = o.K
  if (k) {
    r.king.square = nameOf(o, k[1] * 8 + k[0])
    const kx = k[0]
    for (let f = Math.max(0, kx - 1); f <= Math.min(7, kx + 1); f++) if (!fileCount[f]) r.king.openFilesNear++
  }
  r.king.shield = shelter(e).w
  let attackers = 0
  for (let s = 0; s < 64; s++) attackers += kingAttackersCount(e, s & 7, s >> 3)
  r.king.attackers = attackers
  r.king.danger = kingDanger(e)
  // hanging: SF "Hanging" seen from the enemy, plus pieces attacked by a cheaper piece
  for (let s = 0; s < 64; s++) {
    const p = o.b[s]
    if (!'PNBRQ'.includes(p)) continue
    const fs = (7 - (s >> 3)) * 8 + (s & 7)
    const ex = fs & 7, ey = fs >> 3
    let h = hanging(e, ex, ey) > 0
    if (!h && p !== 'P') {
      const byPawn = e.pA[fs] > 0, byMinor = e.nA[fs] > 0 || e.bA[fs] > 0, byRook = e.rA[fs] > 0
      h = byPawn || ((p === 'R' || p === 'Q') && byMinor) || (p === 'Q' && byRook)
    }
    if (h) r.hanging.push(nameOf(o, s))
  }
  return r
}

interface Full { w: Side; b: Side; c: Classical; report: PositionReport }

function analyseFull(fen: string): Full {
  const { w, b } = parseFen(fen)
  const c = classical(w, b)
  const terms: Record<string, { w: number; b: number }> = {}
  const tv = (t: Terms, k: string, group: boolean) =>
    group ? taper(t.group(k, true), t.group(k, false), c.phase) : taper(t.get(k, true), t.get(k, false), c.phase)
  const round = (v: number) => Math.round(toCp(v) * 10) / 10 || 0 // no -0
  for (const g of GROUPS) terms[g] = { w: round(tv(c.tw, g, true)), b: round(tv(c.tb, g, true)) }
  // "Imbalance total" is only meaningful as a difference: split it so that w - b equals the guide's value
  terms.imbalance = { w: round(c.imbalance / 2), b: round(-c.imbalance / 2) }
  for (const k of TERM_KEYS) if (k.includes('.')) terms[k] = { w: round(tv(c.tw, k, false)), b: round(tv(c.tb, k, false)) }
  const report: PositionReport = { w: sideReport(w), b: sideReport(b), terms, score: Math.round(toCp(c.v)) }
  return { w, b, c, report }
}

/** Positional report for both sides plus Stockfish-classical term values (tapered, cp) and the overall score. */
export function analysePosition(fen: string): PositionReport {
  return analyseFull(fen).report
}

// ───────────────────────── concept deltas ─────────────────────────

export interface ConceptDelta { concept: string; side: 'w' | 'b'; delta: number; text: string }

const COLOR_NAME = { w: 'White', b: 'Black' } as const
/** Minimum change (cp) for continuous terms (king safety, threats, mobility, space, passed-pawn advance).
 *  Qualitative structure events (a pawn becoming isolated, a rook reaching an open file, ...) are always reported. */
const THRESHOLD = 8

type Color = 'w' | 'b'
interface Moved { from: string; to: string }

/**
 * What a move changed positionally, most significant first (cp-like units from the eval terms).
 * `side` is the side the change concerns and `delta` its effect for that side (positive = good for `side`).
 * Structural features are attributed to their owner; a new attack on a piece is attributed to the attacker
 * when the mover created it, and to the owner when the mover left its own piece en prise.
 * `text` is a short verb phrase that reads after the move, e.g. "Nd5 gains a knight outpost on d5".
 */
export function conceptDeltas(fenBefore: string, fenAfter: string): ConceptDelta[] {
  const A = analyseFull(fenBefore), Z = analyseFull(fenAfter)
  const mover: Color = fenBefore.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'
  const pieceAt = (f: Full, sq: string) => {
    const p = f.w.b[idxOf(f.w, sq)]
    return p === '-' ? null : { type: p.toLowerCase(), color: (p === p.toUpperCase() ? 'w' : 'b') as Color }
  }
  const allSquares: string[] = []
  for (let r = 1; r <= 8; r++) for (const f of FILES) allSquares.push(f + r)
  const pieceCount = (f: Full) => allSquares.filter(q => pieceAt(f, q)).length

  // Which of the mover's pieces went where (handles castling and promotion).
  const froms: string[] = [], tos: string[] = []
  for (const sq of allSquares) {
    const a = pieceAt(A, sq), z = pieceAt(Z, sq)
    if (a && a.color === mover && !(z && z.color === mover && z.type === a.type)) froms.push(sq)
    if (z && z.color === mover && !(a && a.color === mover && a.type === z.type)) tos.push(sq)
  }
  const moves: Moved[] = []
  if (froms.length === 1 && tos.length === 1) moves.push({ from: froms[0], to: tos[0] })
  else for (const from of froms) {
    const to = tos.find(t => pieceAt(Z, t)!.type === pieceAt(A, from)!.type)
    if (to) moves.push({ from, to })
  }
  const destOf = (sq: string) => moves.find(m => m.from === sq)?.to ?? sq
  const originOf = (sq: string) => moves.find(m => m.to === sq)?.from ?? sq
  const arrived = (sq: string) => moves.some(m => m.to === sq)
  /** The piece on `sq` before the move is still on the board afterwards (following the moved piece). */
  const survives = (sq: string, color: Color) => {
    const a = pieceAt(A, sq), z = pieceAt(Z, destOf(sq))
    return !!a && !!z && a.color === color && z.color === color && (a.type === z.type || destOf(sq) !== sq)
  }

  const out: ConceptDelta[] = []
  const push = (concept: string, side: Color, delta: number, text: string) =>
    out.push({ concept, side, delta: Math.round(delta * 10) / 10 || 0, text })

  const sideOf = (f: Full, s: Color) => (s === 'w' ? f.w : f.b)
  const termsOf = (f: Full, s: Color) => (s === 'w' ? f.c.tw : f.c.tb)
  /** Tapered cp value of `keys` at real square `sq`, from side `s`'s own terms. */
  const sqVal = (f: Full, s: Color, keys: string[], sq: string) => {
    const t = termsOf(f, s), i = idxOf(sideOf(f, s), sq)
    let mg = 0, eg = 0
    for (const k of keys) { const a = t.squares(k); if (a) { mg += a[i]; eg += a[64 + i] } }
    return toCp(taper(mg, eg, f.c.phase))
  }
  const termVal = (f: Full, s: Color, g: string) => {
    const t = termsOf(f, s)
    return toCp(taper(t.group(g, true), t.group(g, false), f.c.phase))
  }
  const nameAt = (f: Full, sq: string) => PIECE_NAME[pieceAt(f, sq)?.type ?? 'p']
  const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }
  /** Squares of moved pieces that captured something at least as valuable (a trade, not a positional event). */
  const captured = moves.some(m => pieceAt(A, m.to)?.color === (mover === 'w' ? 'b' : 'w')) || pieceCount(A) > pieceCount(Z)
  const traded = new Set(moves.filter(m => {
    const victim = pieceAt(A, m.to)
    return victim && victim.color !== mover && VALUE[victim.type] >= VALUE[pieceAt(A, m.from)!.type]
  }).map(m => m.to))
  const pieceKeys = [...TERM_KEYS.filter(k => k.startsWith('pieces.')), 'mobility']
  const pawnKeys = TERM_KEYS.filter(k => k.startsWith('pawns.'))

  for (const s of ['w', 'b'] as const) {
    const opp: Color = s === 'w' ? 'b' : 'w'
    const ra = A.report[s], rz = Z.report[s]
    const own = COLOR_NAME[s]
    const pawns = (f: Full) => allSquares.filter(q => { const p = pieceAt(f, q); return p?.color === s && p.type === 'p' }).length
    // Don't credit "repairs" that only happened because a pawn was captured.
    const noPawnLost = pawns(Z) >= pawns(A) || mover === s

    // ── pawn weaknesses, matched through the move
    const pawnFeature = (concept: string, before: string[], after: string[], keys: string[],
      gained: (sq: string) => string, repaired: (sq: string) => string) => {
      const mapped = new Set(before.filter(q => survives(q, s)).map(destOf))
      for (const sq of after) if (!mapped.has(sq)) push(concept, s, Math.min(sqVal(Z, s, keys, sq), -1), gained(sq))
      if (!noPawnLost) return
      for (const q of before) {
        const sq = destOf(q)
        if (survives(q, s) && !after.includes(sq) && pieceAt(Z, sq)?.type === 'p') push(concept, s, Math.max(-sqVal(A, s, keys, q), 1), repaired(sq))
      }
    }
    pawnFeature('isolated-pawn', ra.isolated, rz.isolated, ['pawns.isolated', 'pawns.weakUnopposed'],
      q => (q[0] === 'd' ? `creates an isolated queen's pawn on ${q}` : `creates an isolated pawn on ${q}`),
      q => `repairs the isolated pawn on ${q}`)
    pawnFeature('backward-pawn', ra.backward, rz.backward, ['pawns.backward', 'pawns.weakUnopposed'],
      q => `leaves a backward pawn on ${q}`, q => `frees the backward pawn on ${q}`)

    const files = (xs: string[]) => new Set(xs.map(q => q[0]))
    const fa = files(ra.doubled), fz = files(rz.doubled)
    const fileVal = (f: Full, file: string) =>
      f.report[s].doubled.filter(q => q[0] === file).reduce((v, q) => v + sqVal(f, s, ['pawns.doubled'], q), 0)
    for (const file of fz) if (!fa.has(file)) push('doubled-pawns', s, Math.min(fileVal(Z, file), -1), `creates doubled pawns on the ${file}-file`)
    if (noPawnLost) for (const file of fa) if (!fz.has(file)) push('doubled-pawns', s, Math.max(-fileVal(A, file), 1), `undoubles the ${file}-pawns`)

    if (rz.hangingPawns.length && rz.hangingPawns.join() !== ra.hangingPawns.join()) {
      const pair = rz.hangingPawns.slice(0, 2)
      const v = pair.reduce((t, q) => t + sqVal(Z, s, pawnKeys, q), 0)
      push('hanging-pawns', s, Math.min(v, -1), `creates hanging pawns on ${pair.join(' and ')}`)
    }

    // ── passed pawns
    const passedBefore = new Map(ra.passed.filter(q => survives(q, s)).map(q => [destOf(q), q]))
    for (const sq of rz.passed) {
      const from = passedBefore.get(sq)
      const v = sqVal(Z, s, ['passed'], sq)
      if (from === undefined) push('passed-pawn', s, Math.max(v, 1), `creates a passed pawn on ${sq}`)
      else if (from !== sq && v - sqVal(A, s, ['passed'], from) >= THRESHOLD) push('passed-pawn', s, v - sqVal(A, s, ['passed'], from), `advances the passed pawn to ${sq}`)
    }
    for (const [sq, from] of passedBefore) {
      if (!rz.passed.includes(sq) && pieceAt(Z, sq)?.type === 'p') push('passed-pawn', s, -Math.max(sqVal(A, s, ['passed'], from), 1), `stops the ${sq} pawn from being passed`)
    }
    if (mover === opp) {
      for (const sq of rz.passed) {
        const front = sq[0] + (Number(sq[1]) + (s === 'w' ? 1 : -1))
        if (arrived(front) && pieceAt(Z, front)?.color === opp && pieceAt(Z, front)?.type !== 'p') {
          const d = sqVal(A, s, ['passed'], sq) - sqVal(Z, s, ['passed'], sq)
          push('passed-pawn-blockade', opp, Math.max(d, 1), `blockades the passed pawn on ${sq} with the ${nameAt(Z, front)}`)
        }
      }
    }

    // ── outposts
    const occA = new Map(ra.outposts.filter(x => x.piece).map(x => [x.square, x]))
    const occZ = new Map(rz.outposts.filter(x => x.piece).map(x => [x.square, x]))
    const reachA = new Set(ra.outposts.filter(x => !x.piece).map(x => x.square))
    for (const [sq, x] of occZ) {
      const before = originOf(sq)
      if (occA.has(before) && survives(before, s)) continue
      const name = x.piece === 'n' ? 'knight' : 'bishop'
      const d = sqVal(Z, s, ['pieces.outpost'], sq) - (pieceAt(A, before)?.color === s ? sqVal(A, s, ['pieces.outpost'], before) : 0)
      push('outpost', s, Math.max(d, 1), before !== sq ? `gains a ${name} outpost on ${sq}` : `turns ${sq} into an outpost for the ${name}`)
    }
    for (const [sq, x] of occA) {
      const to = destOf(sq)
      if (occZ.has(to) || !survives(sq, s)) continue
      const name = x.piece === 'n' ? 'knight' : 'bishop'
      const d = sqVal(Z, s, ['pieces.outpost'], to) - sqVal(A, s, ['pieces.outpost'], sq)
      push('outpost', s, Math.min(d, -1), to !== sq ? `gives up the ${name} outpost on ${sq}` : `undermines the ${name} outpost on ${sq}`)
    }
    for (const x of rz.outposts) {
      if (x.piece || reachA.has(x.square) || occA.has(x.square) || arrived(x.reachableBy!)) continue
      const d = termVal(Z, s, 'pieces.outpost') - termVal(A, s, 'pieces.outpost')
      push('outpost', s, Math.max(d, 1), `creates an outpost on ${x.square} for ${own}'s ${nameAt(Z, x.reachableBy!)}`)
    }

    // ── rooks: open / half-open files, 7th rank, trapped
    const fileStatus = (r: SideReport, sq: string) => (r.rooksOpenFile.includes(sq) ? 2 : r.rooksSemiOpenFile.includes(sq) ? 1 : 0)
    for (const sq of [...rz.rooksOpenFile, ...rz.rooksSemiOpenFile]) {
      const before = originOf(sq)
      const wasRook = pieceAt(A, before)?.type === 'r' && pieceAt(A, before)?.color === s
      const sb = wasRook ? fileStatus(ra, before) : 0, sz = fileStatus(rz, sq)
      if (sz <= sb) continue
      const d = sqVal(Z, s, ['pieces.rookOnFile'], sq) - (sb ? sqVal(A, s, ['pieces.rookOnFile'], before) : 0)
      const kind = sz === 2 ? 'open' : 'half-open'
      if (before !== sq) push('rook-open-file', s, d, `puts the rook on the ${kind} ${sq[0]}-file`)
      else push('rook-open-file', s, d, `${sz === 2 ? 'opens' : 'half-opens'} the ${sq[0]}-file for the rook on ${sq}`)
    }
    for (const sq of rz.rooksOn7th) {
      const before = originOf(sq)
      if (ra.rooksOn7th.includes(before)) continue
      push('rook-7th', s, Math.max(sqVal(Z, s, pieceKeys, sq) - (before !== sq ? sqVal(A, s, pieceKeys, before) : 0), 1), `puts the rook on the 7th rank (${sq})`)
    }
    for (let i = 0; i < 64; i++) {
      const sq = nameOf(sideOf(Z, s), i)
      const vz = sqVal(Z, s, ['pieces.trappedRook'], sq)
      if (vz && !sqVal(A, s, ['pieces.trappedRook'], originOf(sq))) push('trapped-rook', s, vz, `leaves the rook on ${sq} trapped by its own king`)
    }

    // ── bishops
    // a side loses the pair on the opponent's (capturing) move, which is credited to the capturer
    if (ra.bishopPair && !rz.bishopPair && mover === opp) {
      push('bishop-pair', opp, toCp(1438 / 16), Z.report[opp].bishopPair ? `secures the bishop pair for ${COLOR_NAME[opp]}` : `takes away ${own}'s bishop pair`)
    }
    for (const sq of rz.badBishops) {
      const before = originOf(sq)
      if (ra.badBishops.includes(before)) continue
      const d = sqVal(Z, s, ['pieces.bishopPawns'], sq) - sqVal(A, s, ['pieces.bishopPawns'], before)
      push('bad-bishop', s, Math.min(d, -1), `turns the bishop on ${sq} into a bad bishop (own pawns fixed on its colour)`)
    }
    for (let i = 0; i < 64; i++) {
      const sq = nameOf(sideOf(Z, s), i)
      const vz = sqVal(Z, s, ['pieces.longDiagonalBishop'], sq)
      if (vz && !sqVal(A, s, ['pieces.longDiagonalBishop'], originOf(sq))) push('bishop-long-diagonal', s, vz, `puts the bishop on the open long diagonal (${sq})`)
    }

    // ── threats against this side's pieces (attacker's per-square threat terms on the target)
    const threatKeys = ['threats.hanging', 'threats.safePawn', 'threats.minor', 'threats.rook', 'threats.pawnPush']
    for (const sq of allSquares) {
      const pz = pieceAt(Z, sq)
      if (!pz || pz.color !== s || pz.type === 'k' || traded.has(sq)) continue
      const before = originOf(sq)
      const vz = sqVal(Z, opp, threatKeys, sq)
      const va = pieceAt(A, before)?.color === s ? sqVal(A, opp, threatKeys, before) : 0
      const isH = rz.hanging.includes(sq), wasH = ra.hanging.includes(before)
      const name = PIECE_NAME[pz.type], d = vz - va
      const att = sideOf(Z, opp), ai = idxOf(att, sq)
      const loose = sqVal(Z, opp, ['threats.hanging'], sq) > 0 // SF "Hanging": undefended or attacked twice
      const pushThreat = !isH && sqVal(Z, opp, ['threats.pawnPush'], sq) > 0 && !(pieceAt(A, before)?.color === s && sqVal(A, opp, ['threats.pawnPush'], before) > 0)
      if (isH && !wasH) {
        const v = Math.max(d, 1)
        const by = att.pA[ai] ? 'a pawn' : 'a cheaper piece'
        if (mover === s) push('threat', s, -v, loose ? `leaves the ${name} on ${sq} hanging` : `puts the ${name} on ${sq} where ${by} attacks it`)
        else push('threat', opp, v, loose ? `attacks the ${name} on ${sq}, which is insufficiently defended` : `attacks the ${name} on ${sq} with ${by}`)
      } else if (pushThreat && pz.type !== 'p' && mover === opp) {
        push('threat', opp, Math.max(d, 1), `threatens to attack the ${name} on ${sq} with a pawn advance`)
      } else if (wasH && !isH) {
        const v = Math.max(-d, 1)
        if (mover === s) push('threat', s, v, before !== sq ? `moves the ${name} out of attack` : captured ? `removes the threat to the ${name} on ${sq}` : `defends the ${name} on ${sq}`)
        else push('threat', opp, -v, `releases the pressure on the ${name} on ${sq}`)
      }
    }

    // ── safety of this side's king: own pawn shield ("Shelter strength"), enemy pawn storm ("Shelter storm")
    // and the enemy's "King danger" (all evaluated from the enemy's side, where this king is 'k')
    const shA = shelter(sideOf(A, opp)), shZ = shelter(sideOf(Z, opp))
    const mgCp = (f: Full, v: number) => toCp(v * f.c.phase / 128)
    const dShield = mgCp(Z, shZ.w) - mgCp(A, shA.w), dStorm = -(mgCp(Z, shZ.s) - mgCp(A, shA.s))
    const kingMoved = moves.some(m => pieceAt(Z, m.to)?.type === 'k' && pieceAt(Z, m.to)?.color === s)
    const opened = rz.king.openFilesNear > ra.king.openFilesNear
    if (kingMoved && Math.abs(dShield) >= THRESHOLD) {
      push('king-shelter', s, dShield, `puts ${own}'s king behind a ${dShield > 0 ? 'stronger' : 'weaker'} pawn shield`)
    } else if (dShield <= -THRESHOLD) {
      push('king-shelter', s, dShield, `weakens ${own}'s king pawn shield${opened ? ' and opens a file next to the king' : ''}`)
    } else if (dShield >= THRESHOLD) push('king-shelter', s, dShield, `strengthens ${own}'s king pawn shield`)
    if (!kingMoved && dStorm <= -THRESHOLD) push('king-storm', s, dStorm, `advances the pawn storm against ${own}'s king`)
    const dDanger = -(termVal(Z, opp, 'king.danger') - termVal(A, opp, 'king.danger'))
    const dAttackers = rz.king.attackers - ra.king.attackers
    // King danger also moves with general mobility; only report it when the attack itself changed.
    const real = Math.abs(dDanger) >= 3 * THRESHOLD || (dAttackers !== 0 && Math.sign(dAttackers) === -Math.sign(dDanger))
    if (real && dDanger <= -THRESHOLD) push('king-danger', s, dDanger, `increases the pressure on ${own}'s king`)
    else if (real && dDanger >= THRESHOLD) push('king-danger', s, dDanger, `eases the pressure on ${own}'s king`)

    // ── continuous terms
    const dMob = termVal(Z, s, 'mobility') - termVal(A, s, 'mobility'), nMob = rz.mobility - ra.mobility
    const squares = Math.sign(nMob) === Math.sign(dMob) ? ` (${nMob > 0 ? '+' : ''}${nMob} square${Math.abs(nMob) === 1 ? '' : 's'})` : ''
    if (Math.abs(dMob) >= THRESHOLD) push('mobility', s, dMob, `${dMob > 0 ? 'increases' : 'reduces'} ${own}'s piece mobility${squares}`)
    const dSpace = termVal(Z, s, 'space') - termVal(A, s, 'space')
    if (Math.abs(dSpace) >= THRESHOLD) push('space', s, dSpace, dSpace > 0 ? `gains space for ${own}` : `reduces ${own}'s space`)
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}
