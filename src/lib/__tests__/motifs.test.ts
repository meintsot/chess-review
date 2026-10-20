import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { detectMotifs, type Motif, type MotifKind, type PrevMove } from '../motifs'

// Positions marked with a puzzle id are Lichess puzzles (https://lichess.org/training/<id>): `fen` is the
// position after the opponent's last move, `prev` that move, `line` the puzzle solution.

function playLine(fen: string, line: string[]): Chess {
  const c = new Chess(fen)
  for (const uci of line) c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return c
}

/** Validates the position, the line and the previous move with chess.js, then detects motifs. */
function detect(fen: string, line: string, prev?: PrevMove): Motif[] {
  const moves = line.split(' ')
  expect(() => playLine(fen, moves)).not.toThrow()
  if (prev) expect(playLine(prev.fen, [prev.uci]).fen().split(' ')[0]).toBe(fen.split(' ')[0])
  return detectMotifs(fen, moves, prev)
}

function find(motifs: Motif[], kind: MotifKind): Motif {
  const m = motifs.find(x => x.kind === kind)
  expect(m, `${kind} in ${motifs.map(x => x.kind).join(', ')}`).toBeDefined()
  return m as Motif
}

const kinds = (motifs: Motif[]) => motifs.map(m => m.kind)

describe('detectMotifs', () => {
  it('knight fork (NcSNe): Nc2+ forks king and rook, then back-rank mate', () => {
    const m = detect('2kr1b1r/p1p2ppp/8/1Q6/1nn5/P3P3/1P2NPPP/R1B1K2R b KQ - 0 15', 'b4c2 e1f1 d8d1', {
      fen: '2kr1b1r/p1p2ppp/8/1p6/Qnn5/P3P3/1P2NPPP/R1B1K2R w KQ - 0 15',
      uci: 'a4b5',
    })
    expect(find(m, 'fork')).toEqual({ kind: 'fork', ply: 0, square: 'c2', piece: 'n', targets: ['a1', 'e1'] })
    expect(find(m, 'backRankMate')).toMatchObject({ ply: 2, square: 'd1', piece: 'r', targets: ['f1'] })
    expect(find(m, 'mate').mateIn).toBe(2)
    // mates first, then fork
    expect(kinds(m).slice(0, 3)).toEqual(['mate', 'backRankMate', 'fork'])
  })

  it('queen fork (fOFHr): Qe5+ forks king and rook', () => {
    const m = detect('rnbqkbnr/pppp4/8/6pp/4PQ1P/8/PPPP2P1/RNB1KB1R w KQkq - 0 8', 'f4e5 d8e7 e5h8')
    expect(find(m, 'fork')).toMatchObject({ ply: 0, square: 'e5', piece: 'q', targets: ['e8', 'h8'] })
  })

  it('absolute pin (pdz6x): Bh6 pins the queen to the king', () => {
    const m = detect('r1b4r/pp3kb1/2p2pp1/q6p/4PQ2/P1N2N1P/1PP2PP1/2KR3R b - - 0 18', 'g7h6 f4h6 h8h6')
    expect(find(m, 'pin')).toEqual({ kind: 'pin', ply: 0, square: 'h6', piece: 'b', targets: ['f4', 'c1'] })
  })

  it('absolute pin (WtRaw): Rg3 cannot be taken by the pinned f-pawn', () => {
    const m = detect('6k1/N1p2pb1/6p1/6Np/5p2/P1Pr4/1P2rPK1/1R3R2 b - - 2 26', 'd3g3 g2h1 g3g5')
    expect(find(m, 'pin')).toMatchObject({ square: 'e2', piece: 'r', targets: ['f2', 'g2'] })
  })

  it('relative pin: Bb5 pins the rook to the queen', () => {
    const m = detect('4q2k/p5pp/2r5/8/8/8/PP3PPP/5BK1 w - - 0 1', 'f1b5 a7a6 b5c6')
    expect(find(m, 'pin')).toEqual({ kind: 'pin', ply: 0, square: 'b5', piece: 'b', targets: ['c6', 'e8'] })
  })

  it('skewer (EUsZL): Ra8 skewers queen and knight', () => {
    const m = detect('1r5r/2pqkppp/Q1pbpn2/3p2B1/N2P4/4PP2/PPP2P1P/2KR2R1 b - - 4 14', 'b8a8 a6d3 a8a4')
    expect(find(m, 'skewer')).toEqual({ kind: 'skewer', ply: 0, square: 'a8', piece: 'r', targets: ['a6', 'a4'] })
  })

  it('discovered attack (exMh6): e6 uncovers the queen against the queen on a5', () => {
    const m = detect('r1b5/pp2pkbp/2p2n2/q3P1Q1/3r4/2N5/PPP2PPP/R4RK1 w - - 0 16', 'e5e6 c8e6 g5a5')
    expect(find(m, 'discoveredAttack')).toEqual({ kind: 'discoveredAttack', ply: 0, square: 'g5', piece: 'q', targets: ['a5'] })
  })

  it('discovered check (2Q9kJ): Rf7+ uncovers the bishop on c5', () => {
    const m = detect('8/3k2Qp/bp4p1/p1bB4/q7/8/P2N1rPP/1R2R1K1 b - - 5 31', 'f2f7 g1h1 f7g7')
    expect(find(m, 'discoveredCheck')).toEqual({ kind: 'discoveredCheck', ply: 0, square: 'c5', piece: 'b', targets: ['g1'] })
  })

  it('discovered check (constructed): Nxf7+ uncovers the rook on e1', () => {
    const m = detect('3qk2r/pp3ppp/8/4N3/8/8/PP3PPP/4R1K1 w k - 0 1', 'e5f7 e8f8 f7d8')
    expect(find(m, 'discoveredCheck')).toMatchObject({ ply: 0, square: 'e1', piece: 'r', targets: ['e8'] })
    expect(kinds(m)).not.toContain('doubleCheck')
  })

  it('double check (xsAeZ): Nd5++ with the queen on c2', () => {
    const m = detect('r6r/p1k2pp1/bq2p2p/3pPn2/8/2N2N2/PPQB2PP/R3b2K w - - 0 18', 'c3d5 c7b7 d5b6')
    expect(find(m, 'doubleCheck')).toMatchObject({ ply: 0, square: 'd5', piece: 'n', targets: ['c7'] })
  })

  it('hanging piece (og7Zn): Qxb7+ wins the loose bishop', () => {
    const prev = { fen: '1rBq4/Qb2k1b1/3p1npp/1p1Pp3/1P2P2P/P5P1/5P2/2R3K1 b - - 1 28', uci: 'b8c8' }
    const m = detect('2rq4/Qb2k1b1/3p1npp/1p1Pp3/1P2P2P/P5P1/5P2/2R3K1 w - - 0 29', 'a7b7 d8d7 b7c8 d7c8 c1c8', prev)
    expect(find(m, 'hangingPiece')).toEqual({ kind: 'hangingPiece', ply: 0, square: 'b7', piece: 'q', targets: ['b7'] })
  })

  it('trapped piece (wUJh1): h6 traps the queen on g5', () => {
    const m = detect('4r1nk/5r1p/1p1Bq1p1/p2pP1Q1/P2P1RPP/8/1P5K/5R2 b - - 0 36', 'h7h6 g5g6 e6g6')
    expect(find(m, 'trappedPiece')).toMatchObject({ ply: 0, square: 'h6', piece: 'p', targets: ['g5'] })
  })

  it('sacrifice (PH5TI): Bg1+ gives up the bishop for a mate in 2', () => {
    const m = detect('r1b3k1/qp3p1p/p1P3p1/4R1B1/N1Qb1P2/1B4nP/PP4PK/8 b - - 2 25', 'd4g1 h2g3 a7f2')
    expect(find(m, 'sacrifice')).toMatchObject({ ply: 0, square: 'g1', piece: 'b' })
    expect(find(m, 'mate')).toMatchObject({ ply: 2, mateIn: 2, square: 'f2', piece: 'q' })
  })

  it('deflection (H1g3R): Rg5+ deflects the king from the e4 rook', () => {
    const m = detect('8/8/1p6/p1p2kp1/P2prp2/1P3K1P/2P3RP/8 w - - 0 36', 'g2g5 f5g5 f3e4 g5h4 e4f4')
    expect(find(m, 'deflection')).toEqual({ kind: 'deflection', ply: 0, square: 'g5', piece: 'r', targets: ['f5', 'e4'] })
  })

  it('deflection to promote (QtBB5): Rxc7 deflects the rook from the g-file', () => {
    const m = detect('8/2P3R1/8/2r5/1K6/5k2/6p1/8 b - - 1 47', 'c5c7 g7c7 g2g1q')
    expect(find(m, 'deflection')).toMatchObject({ ply: 0, square: 'c7', targets: ['g7', 'g1'] })
    expect(find(m, 'promotion')).toMatchObject({ ply: 2, square: 'g1', piece: 'q' })
    expect(find(m, 'advancedPawn')).toMatchObject({ ply: 2, piece: 'p' })
    expect(kinds(m)).not.toContain('underPromotion')
  })

  it('attraction (1ajF9): Bg5+ lures the king onto the queen fork square', () => {
    const m = detect('8/8/3P4/8/5K1b/P3QP2/1P4k1/2q5 b - - 2 63', 'h4g5 f4g5 c1e3')
    expect(find(m, 'attraction')).toEqual({ kind: 'attraction', ply: 0, square: 'g5', piece: 'b', targets: ['f4'] })
  })

  it('back-rank mate in 1', () => {
    const m = detect('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'd1d8')
    expect(kinds(m)).toEqual(['mate', 'backRankMate'])
    expect(find(m, 'mate')).toMatchObject({ ply: 0, mateIn: 1, square: 'd8', piece: 'r', targets: ['g8'] })
  })

  it('smothered mate: Qg8+ Rxg8 Nf7#', () => {
    const m = detect('r6k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1', 'b3g8 a8g8 h6f7')
    expect(kinds(m).slice(0, 2)).toEqual(['mate', 'smotheredMate'])
    expect(find(m, 'smotheredMate')).toMatchObject({ ply: 2, square: 'f7', piece: 'n', targets: ['h8'] })
    expect(find(m, 'sacrifice')).toMatchObject({ ply: 0, piece: 'q' })
  })

  it('mate in 3 (70LcB) with a knight sacrifice and kingside attack', () => {
    const m = detect('rn4qk/pbp3pp/1p1pQ3/6p1/3P3N/2P5/P1P3PP/5RK1 w - - 2 18', 'h4g6 h7g6 e6h3 g8h7 f1f8')
    expect(find(m, 'mate')).toMatchObject({ ply: 4, mateIn: 3, square: 'f8', piece: 'r' })
    expect(find(m, 'sacrifice')).toMatchObject({ ply: 0, square: 'g6', piece: 'n' })
    expect(find(m, 'kingsideAttack').targets).toEqual(['h8'])
  })

  it('no mate when the line stops before mate', () => {
    const m = detect('rn4qk/pbp3pp/1p1pQ3/6p1/3P3N/2P5/P1P3PP/5RK1 w - - 2 18', 'h4g6 h7g6 e6h3 g8h7')
    expect(kinds(m)).not.toContain('mate')
  })

  it('intermezzo (p8KGM): Qxg5 in between before recapturing', () => {
    const prev = { fen: '2k3r1/pp1n4/6r1/2b2QP1/2R5/2P4p/PP5P/7K b - - 1 27', uci: 'g6g5' }
    const fen = '2k3r1/pp1n4/8/2b2Qr1/2R5/2P4p/PP5P/7K w - - 0 28'
    const line = 'c4c5 c8d8 f5g5 g8g5 c5g5'
    expect(find(detect(fen, line, prev), 'intermezzo')).toMatchObject({ ply: 2, square: 'g5', piece: 'q', targets: ['g5'] })
    // the capture that started it is only known through `prev`
    expect(kinds(detect(fen, line))).not.toContain('intermezzo')
  })

  it('x-ray: Bxc3 recaptures through the square the queen came from', () => {
    const m = detect('6k1/5ppp/8/8/8/2n5/1q3PPP/B1R3K1 w - - 0 1', 'c1c3 b2c3 a1c3')
    expect(find(m, 'xRayAttack')).toEqual({ kind: 'xRayAttack', ply: 2, square: 'a1', piece: 'b', targets: ['c3'] })
  })

  it('capturing defender (eAFEG): Rxa7 removes the defender of a5', () => {
    const m = detect('r5k1/R5pp/5n2/N2p4/b7/P1bBB1P1/5P1P/6K1 b - - 0 28', 'a8a7 e3a7 c3a5')
    expect(find(m, 'capturingDefender')).toEqual({ kind: 'capturingDefender', ply: 0, square: 'a7', piece: 'r', targets: ['a7', 'a5'] })
  })

  it('quiet move (mp4mM): g5 quietly traps the rook', () => {
    const m = detect('8/6bR/5kp1/7P/4b3/4P3/7K/8 b - - 0 52', 'g6g5 h5h6 e4h7')
    expect(find(m, 'quietMove')).toMatchObject({ ply: 0, square: 'g5', piece: 'p' })
    expect(find(m, 'trappedPiece').targets).toEqual(['h7'])
  })

  it('interference (00Yuf): Bc2 cuts the queen off from the a4 knight', () => {
    const m = detect('5rk1/n1q2ppp/1p1bpn2/3p1b2/NP1P4/P3PN2/3BBPPP/3Q1RK1 b - - 1 19', 'f5c2 d1a1 c2a4')
    expect(find(m, 'interference')).toEqual({ kind: 'interference', ply: 0, square: 'c2', piece: 'b', targets: ['a4', 'd1'] })
  })

  it('clearance (00Huv): Rh6 clears the h-file for the queen', () => {
    const m = detect('3r1q2/5prk/p3pQpp/1p2P3/2p4R/2P2P1P/PPB2P2/6K1 w - - 3 30', 'h4h6 h7g8 f6h4')
    expect(find(m, 'clearance')).toMatchObject({ ply: 0, square: 'h4', piece: 'r' })
  })

  it('en passant (01MsO)', () => {
    const m = detect('5rk1/2p3b1/3pq3/P4rB1/1PP1p1Q1/7P/5P1K/2R2R2 b - - 0 36', 'e6e5 f2f4 e4f3')
    expect(find(m, 'enPassant')).toMatchObject({ ply: 2, square: 'f3', piece: 'p' })
  })

  it('mate patterns: hook, arabian, anastasia, double bishop', () => {
    expect(find(detect('3r4/4kp1r/p2Np1p1/3bP3/P2n4/8/1P3RPP/5RK1 w - - 5 26', 'f2f7 h7f7 f1f7'), 'hookMate'))
      .toMatchObject({ ply: 2, square: 'f7', targets: ['e7'] })
    expect(find(detect('5bk1/2R4p/6p1/8/4NP1P/3bP1K1/r7/8 w - - 3 46', 'e4f6 g8h8 c7h7'), 'arabianMate'))
      .toMatchObject({ ply: 2, square: 'h7', targets: ['h8'] })
    expect(find(detect('r4r2/1pp1Nppk/3p4/p3n3/4P3/1PPP2P1/1P1K2P1/3R4 w - - 0 23', 'd1h1'), 'anastasiaMate'))
      .toMatchObject({ ply: 0, square: 'h1', targets: ['h7'] })
    expect(find(detect('rnbk1r2/pppp1Bpp/8/5p2/4p3/2PP4/P1P2PPP/R1B1K2R w KQ - 1 14', 'c1g5'), 'doubleBishopMate'))
      .toMatchObject({ ply: 0, square: 'g5', targets: ['d8'] })
  })

  it('under-promotion: exd8=N', () => {
    const m = detect('3q1k2/4P3/5K2/8/8/8/8/8 w - - 0 1', 'e7d8n f8e8 f6e6')
    expect(find(m, 'underPromotion')).toMatchObject({ ply: 0, square: 'd8', piece: 'n' })
    expect(find(m, 'promotion').piece).toBe('n')
  })

  it('reports nothing tactical in a quiet opening line', () => {
    const m = detect('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1')
    const tactical: MotifKind[] = ['fork', 'pin', 'skewer', 'discoveredAttack', 'discoveredCheck', 'hangingPiece', 'sacrifice', 'mate']
    expect(kinds(m).filter(k => tactical.includes(k))).toEqual([])
    expect(find(m, 'castling').ply).toBe(8)
  })

  it('handles empty, invalid and illegal input', () => {
    expect(detectMotifs('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [])).toEqual([])
    expect(detectMotifs('not a fen', ['e2e4'])).toEqual([])
    expect(detectMotifs('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e5'])).toEqual([])
    // an illegal move truncates the line: the mate in 1 is still found
    const m = detectMotifs('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['d1d8', 'a1a2'])
    expect(kinds(m)).toContain('backRankMate')
  })
})
