import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { conceptDeltas, type ConceptDelta } from '../positional'
import { conceptTextEl } from '../positional.el'

const play = (fen: string, san: string) => {
  const c = new Chess(fen)
  c.move(san)
  return c.fen()
}
const fromStart = (moves: string[]) => {
  const c = new Chess()
  for (const m of moves) c.move(m)
  return c.fen()
}

const GREEK = /[Ͱ-Ͽ]/
const ENGLISH = /\b(the|an|pawns?|knight|bishop|rook|queen|king|creates|gains|leaves|puts|file|rank|outpost|white|black|on|with|for|of)\b/i

/** [label, FEN before, move] — real games and the positions of positional.test.ts. */
const CASES: [string, string, string][] = [
  ['isolated queen\'s pawn', fromStart(['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'cxd4', 'Qxd4']), 'exd5'],
  ['knight outpost', 'rnbqkb1r/1p3ppp/p2p1n2/4p3/4P3/1NN5/PPP2PPP/R1BQKB1R w KQkq - 0 7', 'Nd5'],
  ['king pawn shield', 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 0 6', 'g4'],
  ['bishop pair + doubled pawns', fromStart(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6']), 'dxc6'],
  ['rook to open file', 'r4rk1/pp3ppp/8/8/8/8/PP3PPP/R4RK1 w - - 0 1', 'Rad1'],
  ['passed pawn', '8/5k2/8/2p5/1P6/8/5K2/8 w - - 0 1', 'bxc5'],
  ['pawn attacks knight', 'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2', 'e5'],
  ['1.e4 mobility and space', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e4'],
  ['rook on the 7th', '6k1/5ppp/8/8/8/8/1R3PPP/6K1 w - - 0 1', 'Rb7'],
  ['backward pawn', fromStart(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Nb3']), 'e5'],
  ['hanging pawns', 'r2q1rk1/pb2bppp/1pn1pn2/8/3P4/P1P2N2/4BPPP/R1BQ1RK1 w - - 0 11', 'c4'],
  ['long diagonal', 'rnbqk2r/ppppppbp/5np1/8/8/5NP1/PPPPPP1P/RNBQKB1R w KQkq - 0 4', 'Bg2'],
  ['blockade', '8/8/5k2/3P4/2n5/8/5K2/8 b - - 0 1', 'Nd6'],
  ['bad bishops', fromStart(['e4', 'e6', 'd4', 'd5']), 'e5'],
  ['loose pawn', fromStart(['e4', 'e5', 'Nf3']), 'Nf6'],
]

const RUNS = CASES.map(([label, fen, san]) => {
  const mover = new Chess(fen).turn()
  return { label, san, mover, deltas: conceptDeltas(fen, play(fen, san)) }
})

const greekOf = (label: string, concept: string, side: 'w' | 'b') => {
  const run = RUNS.find(r => r.label === label)!
  const d = run.deltas.find(x => x.concept === concept && x.side === side)
  expect(d, `${label}: ${concept} for ${side}`).toBeDefined()
  return conceptTextEl(d!, run.mover)
}

describe('conceptTextEl', () => {
  it.each(RUNS.map(r => [r.label, r] as const))('%s: every delta reads in Greek with the right squares', (_, run) => {
    expect(run.deltas.length).toBeGreaterThan(0)
    for (const d of run.deltas) {
      const el = conceptTextEl(d, run.mover)
      expect(el.length, d.text).toBeGreaterThan(0)
      expect(el, d.text).toMatch(GREEK)
      expect(el, d.text).not.toMatch(ENGLISH)
      expect(el, d.text).not.toMatch(/\d+ squares?|\+\d/) // no mobility numbers
      for (const sq of d.text.match(/\b[a-h][1-8]\b/g) ?? []) expect(el, d.text).toContain(sq)
      const file = d.text.match(/\b([a-h])-(?:file|pawns)\b/)
      if (file) expect(el, d.text).toContain(`στήλη ${file[1]}`)
    }
  })

  it('covers the main concept kinds', () => {
    const seen = new Set(RUNS.flatMap(r => r.deltas.map(d => d.concept)))
    for (const c of ['isolated-pawn', 'backward-pawn', 'doubled-pawns', 'hanging-pawns', 'passed-pawn', 'passed-pawn-blockade',
      'outpost', 'rook-open-file', 'rook-7th', 'bishop-pair', 'bad-bishop', 'bishop-long-diagonal', 'threat',
      'king-shelter', 'king-storm', 'king-danger', 'mobility', 'space']) expect(seen, c).toContain(c)
  })

  it('speaks to the player and names the opponent', () => {
    expect(greekOf('isolated queen\'s pawn', 'isolated-pawn', 'b')).toBe('σου δημιουργεί απομονωμένο πιόνι της βασίλισσας στο d5')
    expect(greekOf('knight outpost', 'outpost', 'w')).toBe('κερδίζει φυλάκιο για τον ίππο σου στο d5')
    expect(greekOf('king pawn shield', 'king-shelter', 'w')).toBe('αποδυναμώνει τη θωράκιση του βασιλιά σου')
    expect(greekOf('bishop pair + doubled pawns', 'bishop-pair', 'b')).toBe('σου εξασφαλίζει το ζεύγος αξιωματικών')
    expect(greekOf('bishop pair + doubled pawns', 'doubled-pawns', 'b')).toBe('σου δημιουργεί διπλά πιόνια στη στήλη c')
    expect(greekOf('rook to open file', 'rook-open-file', 'w')).toBe('βάζει τον πύργο σου στην ανοιχτή στήλη d')
    expect(greekOf('passed pawn', 'passed-pawn', 'w')).toBe('δημιουργεί περασμένο πιόνι στο c5')
    expect(greekOf('pawn attacks knight', 'threat', 'w')).toBe('απειλεί τον ίππο του αντιπάλου στο f6 με πιόνι')
    expect(greekOf('1.e4 mobility and space', 'mobility', 'w')).toBe('ενεργοποιεί τα κομμάτια σου')
    expect(greekOf('1.e4 mobility and space', 'space', 'b')).toBe('περιορίζει τον χώρο του αντιπάλου')
    expect(greekOf('rook on the 7th', 'rook-7th', 'w')).toBe('βάζει τον πύργο σου στην έβδομη γραμμή (b7)')
    expect(greekOf('backward pawn', 'backward-pawn', 'b')).toBe('σου αφήνει καθυστερημένο πιόνι στο d6')
    expect(greekOf('backward pawn', 'outpost', 'w')).toBe('δημιουργεί φυλάκιο στο d5 για τον ίππο του αντιπάλου')
    expect(greekOf('hanging pawns', 'hanging-pawns', 'w')).toBe('σου δημιουργεί κρεμαστά πιόνια στα c4 και d4')
    expect(greekOf('blockade', 'passed-pawn-blockade', 'b')).toBe('αποκλείει το περασμένο πιόνι του αντιπάλου στο d5 με τον ίππο σου')
    expect(greekOf('bad bishops', 'bad-bishop', 'b')).toMatch(/^κάνει κακό τον αξιωματικό του αντιπάλου στο c8/)
  })

  it('switches the point of view with the player', () => {
    const run = RUNS.find(r => r.label === 'knight outpost')!
    const d = run.deltas.find(x => x.concept === 'outpost')!
    expect(conceptTextEl(d, 'b')).toBe('κερδίζει φυλάκιο για τον ίππο του αντιπάλου στο d5')
  })

  it('handles the rarer templates and agrees with the piece\'s gender', () => {
    const el = (concept: string, side: 'w' | 'b', text: string, delta = 1) =>
      conceptTextEl({ concept, side, delta, text } satisfies ConceptDelta, 'w')
    expect(el('trapped-rook', 'w', 'leaves the rook on h1 trapped by its own king', -20))
      .toBe('αφήνει τον πύργο σου στο h1 εγκλωβισμένο από τον ίδιο του τον βασιλιά')
    expect(el('threat', 'w', 'leaves the queen on d4 hanging', -50)).toBe('αφήνει τη βασίλισσά σου στο d4 απροστάτευτη')
    expect(el('threat', 'w', 'puts the bishop on b5 where a pawn attacks it', -30))
      .toBe('βάζει τον αξιωματικό σου στο b5, όπου τον απειλεί ένα πιόνι')
    expect(el('threat', 'b', 'releases the pressure on the queen on d1', -10)).toBe('χαλαρώνει την πίεση στη βασίλισσά σου στο d1')
    expect(el('bishop-pair', 'w', "takes away Black's bishop pair", 90)).toBe('στερεί από τον αντίπαλο το ζεύγος αξιωματικών')
    expect(el('king-shelter', 'b', "weakens Black's king pawn shield and opens a file next to the king", -30))
      .toBe('αποδυναμώνει τη θωράκιση του βασιλιά του αντιπάλου και ανοίγει στήλη δίπλα του')
    expect(el('rook-open-file', 'w', 'half-opens the f-file for the rook on f1')).toBe('μισανοίγει τη στήλη f για τον πύργο σου στο f1')
    expect(el('mobility', 'w', "reduces White's piece mobility (-6 squares)", -12)).toBe('κάνει τα κομμάτια σου πιο παθητικά')
  })

  it('falls back to generic Greek, never English', () => {
    const fallback = (concept: string, delta: number) =>
      conceptTextEl({ concept, side: 'w', delta, text: 'something new the engine says' }, 'w')
    expect(fallback('outpost', 5)).toBe('κερδίζει φυλάκιο για τα κομμάτια σου')
    expect(fallback('king-danger', -20)).toBe('αυξάνει την πίεση στον βασιλιά σου')
    expect(fallback('brand-new-concept', 5)).toBe('βελτιώνει τη θέση σου')
    expect(fallback('brand-new-concept', -5)).toBe('βελτιώνει τη θέση του αντιπάλου')
  })
})
