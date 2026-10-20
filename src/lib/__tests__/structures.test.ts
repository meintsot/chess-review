import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { classifyStructure, STRUCTURES } from '../structures'

const valid = (fen: string) => {
  new Chess(fen) // throws on an invalid FEN
  return fen
}
function play(moves: string[]) {
  const c = new Chess()
  for (const m of moves) c.move(m)
  return c.fen()
}
const ids = (fen: string) => classifyStructure(valid(fen)).map(s => `${s.id}:${s.owner}`)

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// [structure, owner, positives (two real positions each), negatives]
const CASES: [string, 'w' | 'b' | 'both', string[], string[]][] = [
  ['iqp', 'w', [
    'r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10',
    play(['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'e6', 'Nf3', 'Be7', 'cxd5', 'Nxd5']),
  ], [START, 'r1bq1rk1/pp1nbppp/2p2n2/3p2B1/3P4/2NBP3/PPQ2PPP/R3K1NR w KQ - 0 9']],
  ['iqp', 'b', [
    play(['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'cxd4', 'Qxd4', 'exd5']),
    play(['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'exd5', 'Nf3', 'Nc6', 'g3', 'Nf6', 'Bg2', 'Be7', 'O-O', 'O-O', 'dxc5', 'Bxc5']),
  ], [START]],
  ['hanging-pawns', 'w', [
    'r2q1rk1/pb2bppp/1pn1pn2/8/2PP4/P1N2N2/4BPPP/R1BQ1RK1 w - - 0 11',
    'r2qr1k1/pb3ppp/1pn1pn2/8/2PP4/P1NB1N2/5PPP/R1BQR1K1 b - - 0 13',
  ], [START, 'r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10']],
  ['hanging-pawns', 'b', [
    'r1bq1rk1/p3bppp/2n2n2/2pp4/8/1P2PN2/PB2BPPP/RN1Q1RK1 w - - 0 10',
    'r2q1rk1/pb2bppp/5n2/2pp4/8/1P2PN2/PB2BPPP/R2Q1RK1 w - - 0 12',
  ], [START]],
  ['carlsbad', 'w', [
    'r1bq1rk1/pp1nbppp/2p2n2/3p2B1/3P4/2NBP3/PPQ2PPP/R3K1NR w KQ - 0 9',
    play(['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'c6', 'e3', 'Be7', 'Bd3', 'Nbd7', 'Qc2', 'O-O']),
  ], [START, 'rnbqkb1r/pp3ppp/2p1pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5']],
  ['carlsbad', 'b', [
    play(['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3']),
    play(['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4', 'Qb3', 'Qd7', 'Nd2', 'e6']),
  ], [START]],
  ['maroczy', 'w', [
    'r1bqk2r/pp1pppbp/2n2np1/8/2PNP3/2N5/PP3PPP/R1BQKB1R w KQkq - 3 7',
    'r1bq1rk1/pp2ppbp/2np1np1/8/2PNP3/2N1B3/PP2BPPP/R2QK2R w KQ - 2 9',
  ], [START, 'rnbqkb1r/pp2pp1p/3p1np1/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6']],
  ['hedgehog', 'b', [
    'r2q1rk1/1b1nbppp/pp1ppn2/8/2PNP3/1PN3P1/P3QPBP/R1BR2K1 w - - 0 12',
    'r1bq1rk1/p2nbppp/1p1ppn2/8/2PNP3/2N1B3/PP2BPPP/R2Q1RK1 w - - 0 10',
  ], [START, 'r1bq1rk1/pp2ppbp/2np1np1/8/2PNP3/2N1B3/PP2BPPP/R2QK2R w KQ - 2 9']],
  ['stonewall', 'w', [
    'rnbq1rk1/ppp1b1pp/4pn2/3p1p2/3P1P2/2PBPN2/PP4PP/RNBQ1RK1 w - - 0 7',
    'r1bq1rk1/pp1nb1pp/2p1pn2/3p1p2/3P1P2/2PBPN2/PP1N2PP/R1BQ1RK1 w - - 0 9',
  ], [START, 'rnbq1rk1/pp2b1pp/2p1pn2/3p1p2/2PP4/5NP1/PP2PPBP/RNBQ1RK1 w - - 0 7']],
  ['stonewall', 'b', [
    'rnbq1rk1/pp2b1pp/2p1pn2/3p1p2/2PP4/5NP1/PP2PPBP/RNBQ1RK1 w - - 0 7',
    'r1bq1rk1/pp1nb1pp/2p1pn2/3p1p2/2PP4/1P3NP1/P2NPPBP/R1BQ1RK1 w - - 0 9',
  ], [START]],
  ['french-chain', 'both', [
    'rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq c6 0 4',
    'r1b1kbnr/pp3ppp/1qn1p3/3pP3/3P4/5N2/PP3PPP/RNBQKB1R w KQkq - 0 7',
  ], [START, 'rnbq1rk1/ppp2pbp/3p1np1/3Pp3/2P1P3/2N5/PP2BPPP/R1BQK1NR b KQ - 0 7']],
  ['kid-chain', 'both', [
    'rnbq1rk1/ppp2pbp/3p1np1/3Pp3/2P1P3/2N5/PP2BPPP/R1BQK1NR b KQ - 0 7',
    'r1bq1rk1/pppnnpbp/3p2p1/3Pp3/2P1P3/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 10',
  ], [START, 'rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq c6 0 4']],
  ['caro-slav', 'b', [
    'rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 2 4',
    'rnbqkb1r/pp3ppp/2p1pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5',
  ], [START, 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4']],
  ['small-center', 'b', [
    'rnbqkb1r/1p3ppp/p2ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 7',
    'r1bqkb1r/pp3ppp/2nppn2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 2 7',
  ], [START, 'rnbqkb1r/1p3ppp/p2p1n2/4p3/4P3/1NN5/PPP2PPP/R1BQKB1R w KQkq - 0 7']],
  ['boleslavsky', 'w', [
    'rnbqkb1r/1p3ppp/p2p1n2/4p3/4P3/1NN5/PPP2PPP/R1BQKB1R w KQkq - 0 7',
    'r1bqkb1r/5ppp/p1np1n2/1p2p1B1/4P3/N1N5/PPP2PPP/R2QKB1R w KQkq - 0 9',
  ], [START, 'rnbqkb1r/1p3ppp/p2ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 7']],
  ['dragon', 'b', [
    'rnbqkb1r/pp2pp1p/3p1np1/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
    'r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R b KQ - 2 9',
  ], [START, 'r1bqkb1r/pp3ppp/2nppn2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 2 7']],
  ['open-center', 'both', [
    'r1bqr1k1/pp3ppp/2n2n2/2b5/8/2NB1N2/PP3PPP/R1BQR1K1 w - - 0 11',
    '2r2rk1/pp3ppp/8/8/8/8/PP3PPP/2RR2K1 w - - 0 1',
  ], [START, 'r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10']],
  ['closed-center', 'both', [
    'rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq c6 0 4',
    'r1bq1rk1/pppnnpbp/3p2p1/3Pp3/2P1P3/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 10',
  ], [START, 'rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 2 4']],
]

describe('classifyStructure', () => {
  for (const [id, owner, positives, negatives] of CASES) {
    describe(`${id} (${owner})`, () => {
      it.each(positives)('recognises %s', fen => {
        expect(ids(fen)).toContain(`${id}:${owner}`)
      })
      it.each(negatives)('does not report it in %s', fen => {
        expect(ids(fen)).not.toContain(`${id}:${owner}`)
      })
    })
  }

  it('finds nothing in the start position', () => {
    expect(classifyStructure(START)).toEqual([])
  })

  it('can report several structures at once', () => {
    // French advance: the chain is also a closed centre
    expect(ids('rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq c6 0 4')).toEqual(['french-chain:both', 'closed-center:both'])
    // Hedgehog against a Maróczy set-up also satisfies the Maróczy and small-centre rules
    expect(ids('r1bq1rk1/p2nbppp/1p1ppn2/8/2PNP3/2N1B3/PP2BPPP/R2Q1RK1 w - - 0 10')).toEqual(['maroczy:w', 'hedgehog:b', 'small-center:b'])
  })

  it('applies the hanging-pawn rank limits (3–5 for White, 6–4 for Black)', () => {
    expect(ids('4k3/8/8/2PP4/8/8/8/4K3 w - - 0 1')).toContain('hanging-pawns:w')
    expect(ids('4k3/8/2PP4/8/8/8/8/4K3 w - - 0 1')).not.toContain('hanging-pawns:w')
    expect(ids('4k3/8/8/8/2pp4/8/8/4K3 w - - 0 1')).toContain('hanging-pawns:b')
    expect(ids('4k3/8/8/8/8/2pp4/8/4K3 w - - 0 1')).not.toContain('hanging-pawns:b')
  })

  it('returns the documented shape', () => {
    expect(classifyStructure('r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10'))
      .toEqual([{ id: 'iqp', name: "Isolated queen's pawn", owner: 'w' }])
  })
})

describe('STRUCTURES', () => {
  it('describes every structure in the spec', () => {
    const specIds = ['iqp', 'hanging-pawns', 'carlsbad', 'maroczy', 'hedgehog', 'stonewall', 'french-chain', 'kid-chain',
      'caro-slav', 'small-center', 'boleslavsky', 'dragon', 'open-center', 'closed-center']
    expect(Object.keys(STRUCTURES).sort()).toEqual([...specIds].sort())
    for (const id of specIds) {
      const s = STRUCTURES[id]
      expect(s.summary.length).toBeGreaterThan(80)
      expect(s.plansFor.owner.length).toBeGreaterThan(40)
      expect(s.plansFor.opponent.length).toBeGreaterThan(40)
    }
  })

  it('uses the same names as classifyStructure', () => {
    for (const [, , positives] of CASES) {
      for (const s of classifyStructure(positives[0])) expect(STRUCTURES[s.id].name).toBe(s.name)
    }
  })

  it('names the minority attack for the Carlsbad', () => {
    expect(STRUCTURES.carlsbad.plansFor.owner).toMatch(/minority attack/i)
    expect(STRUCTURES.carlsbad.plansFor.owner).toMatch(/b4-b5/)
  })
})
