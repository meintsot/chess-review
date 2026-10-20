import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { analysePosition, classicalEval, conceptDeltas, type ConceptDelta } from '../positional'

/** Every FEN used here must be a legal position. */
const valid = (fen: string) => {
  new Chess(fen) // throws on an invalid FEN
  return fen
}
const sorted = (xs: string[]) => [...xs].sort()
/** FEN before and after playing `moves` (SAN) from the start position. */
function line(moves: string[], last: string) {
  const c = new Chess()
  for (const m of moves) c.move(m)
  const before = c.fen()
  c.move(last)
  return { before, after: c.fen() }
}
function after(fen: string, san: string) {
  const c = new Chess(fen)
  c.move(san)
  return c.fen()
}
const find = (ds: ConceptDelta[], concept: string, side: 'w' | 'b') => ds.find(d => d.concept === concept && d.side === side)

const START = valid('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
// QGA / Panov-type isolated queen's pawn
const IQP = valid('r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10')
// Ruy Lopez Exchange after 4...dxc6
const RUY_EXCHANGE = valid('r1bqkbnr/1pp2ppp/p1p5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5')
// Najdorf 6.Nb3 e5
const NAJDORF_E5 = valid('rnbqkb1r/1p3ppp/p2p1n2/4p3/4P3/1NN5/PPP2PPP/R1BQKB1R w KQkq - 0 7')
const FRENCH_ADVANCE = valid('rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq c6 0 4')
const ITALIAN = valid('r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 0 6')

describe('classical evaluation (port of the Stockfish Evaluation Guide)', () => {
  // golden values computed with the guide's own JavaScript (main / middle game / end game evaluation)
  const golden: [string, number, number, number][] = [
    [START, 28, 0, 0],
    [IQP, 76, 61, -19],
    [FRENCH_ADVANCE, 108, 86, 133],
    ['6k1/1R3ppp/8/8/8/8/5PPP/6K1 w - - 0 1', 1356, 1360, 1505],
    ['8/5k2/8/3P4/8/8/5K2/8 b - - 0 1', 132, 217, 250],
    ['2r2rk1/1b2bppp/p2ppn2/1q6/3NP3/1BN1Q3/PPP2PPP/2RR2K1 w - - 0 1', 204, 179, 338],
  ]
  it.each(golden)('matches the guide on %s', (fen, v, mg, eg) => {
    const r = classicalEval(valid(fen))
    expect(r.v).toBe(v)
    expect(r.mg).toBe(mg)
    expect(r.eg).toBeCloseTo(eg, 9)
  })

  it('reports the score in centipawns from White\'s point of view', () => {
    expect(analysePosition(START).score).toBe(14) // tempo only: 28 / 206 pawns
    expect(analysePosition(valid('6k1/1R3ppp/8/8/8/8/5PPP/6K1 w - - 0 1')).score).toBeGreaterThan(500)
  })

  it('is colour-symmetric', () => {
    const mirror = (fen: string) => {
      const [board, turn, , , half, full] = fen.split(' ')
      const swap = (s: string) => s.replace(/[a-z]/gi, ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()))
      return `${swap(board.split('/').reverse().join('/'))} ${turn === 'w' ? 'b' : 'w'} - - ${half} ${full}`
    }
    for (const fen of [ITALIAN, NAJDORF_E5, IQP]) {
      const fenNoCastle = fen.split(' ').map((p, i) => (i === 2 || i === 3 ? '-' : p)).join(' ')
      const a = analysePosition(fenNoCastle), b = analysePosition(valid(mirror(fenNoCastle)))
      expect(b.score).toBe(-a.score)
      for (const k of Object.keys(a.terms)) expect([k, b.terms[k].w, b.terms[k].b]).toEqual([k, a.terms[k].b, a.terms[k].w])
      expect(b.b.mobility).toBe(a.w.mobility)
      expect(b.b.king.danger).toBe(a.w.king.danger)
    }
  })

  it('exposes symmetric terms in the start position', () => {
    const r = analysePosition(START)
    for (const [k, t] of Object.entries(r.terms)) expect([k, t.w]).toEqual([k, t.b])
    expect(r.w.mobility).toBe(r.b.mobility)
    expect(r.w.space).toBe(r.b.space)
  })
})

describe('pawn structure', () => {
  it('finds an isolated (and unopposed) queen\'s pawn', () => {
    const r = analysePosition(IQP)
    expect(r.w.isolated).toEqual(['d4'])
    expect(r.w.weakUnopposed).toEqual(['d4'])
    expect(r.b.isolated).toEqual([])
    expect(r.terms['pawns.isolated'].w).toBeLessThan(0)
    expect(r.w.holes).toContain('d5') // the blockade square in front of the isolani
  })

  it('finds doubled pawns', () => {
    const r = analysePosition(RUY_EXCHANGE)
    expect(sorted(r.b.doubled)).toEqual(['c6', 'c7'])
    expect(r.w.doubled).toEqual([])
  })

  it('finds a backward pawn', () => {
    const r = analysePosition(NAJDORF_E5)
    expect(r.b.backward).toEqual(['d6'])
    expect(r.w.backward).toEqual([])
    expect(r.b.holes).toContain('d5')
  })

  it('finds passed pawns', () => {
    const r = analysePosition(valid('r4rk1/pp3ppp/8/3P4/8/8/PP3PPP/R4RK1 w - - 0 1'))
    expect(r.w.passed).toEqual(['d5'])
    expect(r.b.passed).toEqual([])
    expect(r.terms.passed.w).toBeGreaterThan(0)
    const eg = analysePosition(valid('8/5k2/8/2p5/1P6/8/5K2/8 w - - 0 1'))
    expect(eg.w.passed).toEqual([])
    expect(eg.b.passed).toEqual([])
  })

  it('finds connected pawns', () => {
    expect(analysePosition(START).w.connected).toHaveLength(8)
    const r = analysePosition(IQP)
    expect(sorted(r.w.connected)).toEqual(['a2', 'b2', 'f2', 'g2', 'h2'])
  })

  it('finds hanging pawns', () => {
    const r = analysePosition(valid('r2q1rk1/pb2bppp/1pn1pn2/8/2PP4/P1N2N2/4BPPP/R1BQ1RK1 w - - 0 11'))
    expect(r.w.hangingPawns).toEqual(['c4', 'd4'])
    expect(analysePosition(IQP).w.hangingPawns).toEqual([])
  })
})

describe('pieces', () => {
  it('finds an occupied knight outpost', () => {
    const r = analysePosition(valid('rnbqkb1r/1p3ppp/p2p1n2/3Np3/4P3/1N6/PPP2PPP/R1BQKB1R b KQkq - 1 7'))
    expect(r.w.outposts).toContainEqual({ square: 'd5', piece: 'n' })
    expect(r.terms['pieces.outpost'].w).toBeGreaterThan(0)
  })

  it('finds an empty outpost a knight can reach', () => {
    const r = analysePosition(NAJDORF_E5)
    expect(r.w.outposts).toContainEqual({ square: 'd5', piece: null, reachableBy: 'c3' })
    expect(r.b.outposts).toEqual([])
  })

  it('finds rooks on open and half-open files', () => {
    const r = analysePosition(valid('2r2rk1/pp3ppp/3p4/8/8/8/PP3PPP/2RR2K1 w - - 0 1'))
    expect(r.w.rooksOpenFile).toEqual(['c1'])
    expect(r.w.rooksSemiOpenFile).toEqual(['d1'])
    expect(r.b.rooksOpenFile).toEqual(['c8'])
    expect(r.b.rooksSemiOpenFile).toEqual([])
  })

  it('finds a rook on the 7th rank', () => {
    const r = analysePosition(valid('6k1/1R3ppp/8/8/8/8/5PPP/6K1 w - - 0 1'))
    expect(r.w.rooksOn7th).toEqual(['b7'])
    expect(r.w.rooksOpenFile).toEqual(['b7'])
  })

  it('tracks the bishop pair', () => {
    expect(analysePosition(START).w.bishopPair).toBe(true)
    const r = analysePosition(RUY_EXCHANGE)
    expect(r.w.bishopPair).toBe(false)
    expect(r.b.bishopPair).toBe(true)
  })

  it('finds bad bishops behind fixed pawns', () => {
    const r = analysePosition(FRENCH_ADVANCE)
    expect(r.b.badBishops).toEqual(['c8'])
    expect(r.w.badBishops).toEqual(['c1'])
    const italian = analysePosition(ITALIAN)
    expect(italian.w.badBishops).toEqual([]) // Bc4 stands in front of its pawns
    expect(italian.b.badBishops).toEqual([])
  })

  it('finds a bishop on the long diagonal', () => {
    const fen = valid('rnbqk2r/ppppppbp/5np1/8/8/5NP1/PPPPPPBP/RNBQK2R w KQkq - 2 4')
    expect(analysePosition(fen).terms['pieces.longDiagonalBishop'].w).toBeGreaterThan(0)
  })
})

describe('threats and king safety', () => {
  it('finds undefended attacked pawns', () => {
    const r = analysePosition(valid('rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'))
    expect(r.w.hanging).toEqual(['e4'])
    expect(r.b.hanging).toEqual(['e5'])
    expect(analysePosition(START).w.hanging).toEqual([])
  })

  it('counts a piece attacked by a pawn as hanging', () => {
    const r = analysePosition(valid('rnbqkb1r/pppppppp/5n2/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'))
    expect(r.b.hanging).toContain('f6')
  })

  it('measures the king pawn shield', () => {
    const before = analysePosition(ITALIAN)
    const weak = analysePosition(after(ITALIAN, 'g4'))
    expect(before.w.king.square).toBe('g1')
    expect(weak.w.king.shield).toBeLessThan(before.w.king.shield)
    expect(weak.w.king.danger).toBeGreaterThan(before.w.king.danger)
    const open = analysePosition(valid('r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2P1P/RNBQ1RK1 w - - 0 6'))
    expect(open.w.king.openFilesNear).toBe(1) // g-file without a white pawn
    expect(before.w.king.openFilesNear).toBe(0)
  })

  it('counts king attackers', () => {
    expect(analysePosition(START).b.king.attackers).toBe(0)
    expect(analysePosition(FRENCH_ADVANCE).b.king.attackers).toBeGreaterThan(0)
  })
})

describe('conceptDeltas', () => {
  it('exd5 creates an isolated queen\'s pawn', () => {
    const { before, after: fen } = line(['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'cxd4', 'Qxd4'], 'exd5')
    const d = find(conceptDeltas(before, fen), 'isolated-pawn', 'b')
    expect(d?.text).toBe("creates an isolated queen's pawn on d5")
    expect(d!.delta).toBeLessThan(0)
  })

  it('Nd5 occupies an outpost', () => {
    const ds = conceptDeltas(NAJDORF_E5, after(NAJDORF_E5, 'Nd5'))
    const d = find(ds, 'outpost', 'w')
    expect(d?.text).toBe('gains a knight outpost on d5')
    expect(d!.delta).toBeGreaterThan(0)
  })

  it('g4 weakens the king\'s pawn shield', () => {
    const ds = conceptDeltas(ITALIAN, after(ITALIAN, 'g4'))
    const d = find(ds, 'king-shelter', 'w')
    expect(d?.text).toMatch(/^weakens White's king pawn shield/)
    expect(d!.delta).toBeLessThan(-8)
  })

  it('...dxc6 in the Ruy Exchange wins the bishop pair and doubles the c-pawns', () => {
    const { after: fen } = line(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], 'Bxc6')
    const ds = conceptDeltas(fen, after(fen, 'dxc6'))
    const pair = find(ds, 'bishop-pair', 'b')
    expect(pair?.text).toBe('secures the bishop pair for Black')
    expect(pair!.delta).toBeGreaterThan(0)
    const doubled = find(ds, 'doubled-pawns', 'b')
    expect(doubled?.text).toBe('creates doubled pawns on the c-file')
    expect(doubled!.delta).toBeLessThan(0)
  })

  it('a rook move to an open file', () => {
    const fen = valid('r4rk1/pp3ppp/8/8/8/8/PP3PPP/R4RK1 w - - 0 1')
    const d = find(conceptDeltas(fen, after(fen, 'Rad1')), 'rook-open-file', 'w')
    expect(d?.text).toBe('puts the rook on the open d-file')
    expect(d!.delta).toBeGreaterThan(0)
  })

  it('a capture that creates a passed pawn', () => {
    const fen = valid('8/5k2/8/2p5/1P6/8/5K2/8 w - - 0 1')
    expect(find(conceptDeltas(fen, after(fen, 'bxc5')), 'passed-pawn', 'w')?.text).toBe('creates a passed pawn on c5')
  })

  it('a pawn attack on a knight is credited to the attacker', () => {
    const fen = valid('rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2')
    const d = find(conceptDeltas(fen, after(fen, 'e5')), 'threat', 'w')
    expect(d?.text).toBe('attacks the knight on f6 with a pawn')
    expect(d!.delta).toBeGreaterThan(0)
  })

  it('reports nothing structural for 1.e4 and sorts by size', () => {
    const ds = conceptDeltas(START, after(START, 'e4'))
    expect(ds.map(d => d.concept).every(c => c === 'mobility' || c === 'space')).toBe(true)
    for (let i = 1; i < ds.length; i++) expect(Math.abs(ds[i - 1].delta)).toBeGreaterThanOrEqual(Math.abs(ds[i].delta))
  })
})

describe('performance', () => {
  it('analyses a game\'s positions in about a millisecond each', () => {
    const c = new Chess()
    const fens = [c.fen()]
    const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6', 'f3', 'Be7',
      'Qd2', 'O-O', 'O-O-O', 'Nbd7', 'g4', 'b5', 'g5', 'b4', 'Ne2', 'Ne8', 'f4', 'a5', 'f5', 'a4', 'Nbd4', 'exd4', 'Nxd4', 'b3']
    for (const m of moves) { c.move(m); fens.push(c.fen()) }
    for (const f of fens) analysePosition(f) // warm up
    const t0 = performance.now()
    for (let i = 0; i < 3; i++) for (const f of fens) analysePosition(f)
    const perPosition = (performance.now() - t0) / (3 * fens.length)
    expect(perPosition).toBeLessThan(10) // ~1 ms on a desktop; generous bound for CI
  })
})
