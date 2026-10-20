import { STRUCTURES_EL } from './structures.el'
// Named pawn structures, classified exactly as specified in docs/structures.md (shared with the Python
// data pipeline). Rules look only at pawns; each rule is written for White and its mirror (ranks
// flipped, colours swapped) is applied for Black. A position can match several structures.

export interface Structure { id: string; name: string; owner: 'w' | 'b' | 'both' }

type Color = 'w' | 'b'

/** Pawn lookup from one side's point of view: `us`/`them` take a square named in White's terms (e.g. "d4")
 *  and mirror the rank when the rule is applied for Black. */
interface View {
  us: (sq: string) => boolean
  them: (sq: string) => boolean
  usFile: (file: string) => number
  themFile: (file: string) => number
  usOnFile: (file: string) => number[] // relative ranks of our pawns on a file
  themOnFile: (file: string) => number[]
}

function pawnSets(fen: string): Record<Color, Set<string>> {
  const sets: Record<Color, Set<string>> = { w: new Set(), b: new Set() }
  const rows = fen.trim().split(/\s+/)[0].split('/')
  rows.forEach((row, i) => {
    let file = 0
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue }
      if (ch === 'P') sets.w.add('abcdefgh'[file] + (8 - i))
      if (ch === 'p') sets.b.add('abcdefgh'[file] + (8 - i))
      file++
    }
  })
  return sets
}

function view(sets: Record<Color, Set<string>>, side: Color): View {
  const other: Color = side === 'w' ? 'b' : 'w'
  const rel = (sq: string) => (side === 'w' ? sq : sq[0] + (9 - Number(sq[1])))
  const onFile = (c: Color, file: string) =>
    [...sets[c]].filter(q => q[0] === file).map(q => (side === 'w' ? Number(q[1]) : 9 - Number(q[1])))
  return {
    us: sq => sets[side].has(rel(sq)),
    them: sq => sets[other].has(rel(sq)),
    usFile: f => onFile(side, f).length,
    themFile: f => onFile(other, f).length,
    usOnFile: f => onFile(side, f),
    themOnFile: f => onFile(other, f),
  }
}

interface Rule { id: string; name: string; owner: 'us' | 'them' | 'both'; test: (v: View) => boolean }

// Each test is the "White version" of the rule: `us` = White, `them` = Black.
const RULES: Rule[] = [
  {
    id: 'iqp', name: "Isolated queen's pawn", owner: 'us',
    test: v => v.usFile('d') > 0 && v.usFile('c') === 0 && v.usFile('e') === 0,
  },
  {
    id: 'hanging-pawns', name: 'Hanging pawns', owner: 'us',
    test: v => [3, 4, 5].some(r => v.us('c' + r) && v.us('d' + r)) && v.usFile('b') === 0 && v.usFile('e') === 0,
  },
  {
    id: 'carlsbad', name: 'Carlsbad', owner: 'us',
    test: v => v.us('d4') && v.usFile('c') === 0 && (v.us('e3') || v.us('e2'))
      && v.them('d5') && v.them('c6') && v.themFile('e') === 0,
  },
  {
    id: 'maroczy', name: 'Maróczy bind', owner: 'us',
    test: v => v.us('c4') && v.us('e4') && v.usFile('d') === 0 && (v.them('d6') || v.them('d7')) && v.themFile('c') === 0,
  },
  {
    id: 'hedgehog', name: 'Hedgehog', owner: 'them',
    test: v => (v.them('a6') || v.them('a7')) && v.them('b6') && v.them('d6') && v.them('e6') && v.themFile('c') === 0
      && v.us('c4') && v.us('e4') && v.usFile('d') === 0,
  },
  {
    id: 'stonewall', name: 'Stonewall', owner: 'us',
    test: v => v.us('c3') && v.us('d4') && v.us('e3') && v.us('f4'),
  },
  {
    id: 'french-chain', name: 'French pawn chain', owner: 'both',
    test: v => v.us('d4') && v.us('e5') && v.them('d5') && v.them('e6'),
  },
  {
    id: 'kid-chain', name: "King's Indian chain", owner: 'both',
    test: v => v.us('d5') && v.us('e4') && v.them('d6') && v.them('e5'),
  },
  {
    id: 'caro-slav', name: 'Slav / Caro-Kann triangle', owner: 'them',
    test: v => v.them('c6') && v.them('d5') && (v.them('e6') || v.them('e7')) && v.us('d4'),
  },
  {
    id: 'small-center', name: 'Sicilian small centre (Scheveningen)', owner: 'them',
    test: v => v.them('d6') && v.them('e6') && v.themFile('c') === 0 && v.us('e4') && v.usFile('d') === 0,
  },
  {
    id: 'boleslavsky', name: 'Boleslavsky hole', owner: 'us',
    test: v => v.them('d6') && v.them('e5') && v.themFile('c') === 0 && v.us('e4') && v.usFile('d') === 0,
  },
  {
    id: 'dragon', name: 'Dragon', owner: 'them',
    test: v => v.them('d6') && v.them('g6') && v.them('f7') && (v.them('h7') || v.them('h6') || v.them('h5'))
      && v.themFile('c') === 0 && v.us('e4') && v.usFile('d') === 0,
  },
  {
    id: 'open-center', name: 'Open centre', owner: 'both',
    test: v => v.usFile('d') + v.usFile('e') + v.themFile('d') + v.themFile('e') === 0,
  },
  {
    id: 'closed-center', name: 'Closed centre', owner: 'both',
    test: v => ['d', 'e'].every(f => {
      const ours = v.usOnFile(f), theirs = v.themOnFile(f)
      // each d/e pawn of each side present and blocked by an enemy pawn directly in front of it
      return ours.length > 0 && theirs.length > 0
        && ours.every(r => theirs.includes(r + 1)) && theirs.every(r => ours.includes(r - 1))
    }),
  },
]

/** Named pawn structures present in `fen` (see docs/structures.md). */
export function classifyStructure(fen: string): Structure[] {
  const sets = pawnSets(fen)
  const out: Structure[] = []
  for (const rule of RULES) {
    for (const side of ['w', 'b'] as const) {
      if (!rule.test(view(sets, side))) continue
      const owner = rule.owner === 'both' ? 'both' : rule.owner === 'us' ? side : side === 'w' ? 'b' : 'w'
      if (!out.some(s => s.id === rule.id && s.owner === owner)) out.push({ id: rule.id, name: rule.name, owner })
    }
  }
  return out
}

/** Coach notes per structure. `owner` = the side the structure is named after (see the spec's owner column). */
export const STRUCTURES: Record<string, { name: string; summary: string; plansFor: { owner: string; opponent: string } }> = {
  iqp: {
    name: "Isolated queen's pawn",
    summary: "One side has a d-pawn with no pawns on the c- and e-files. The pawn gives space, open lines and the e5/c5 (or e4/c4) squares for pieces, but it cannot be defended by pawns and the square in front of it is a permanent outpost for the opponent.",
    plansFor: {
      owner: 'Keep pieces on and play actively: put knights on e5 and c3, aim the bishops and queen at the king, lift a rook to the third rank, and look for the d4-d5 break to free your game before the endgame arrives.',
      opponent: 'Blockade the pawn with a knight on d5, trade minor pieces (especially the attacking bishops), then pile up on the pawn with rooks and queen; the simpler the position, the weaker the isolani becomes.',
    },
  },
  'hanging-pawns': {
    name: 'Hanging pawns',
    summary: 'Two connected pawns side by side on c4 and d4 with no friendly pawns on the b- and e-files. They control many central squares and support a timely advance, but neither can be defended by another pawn, and once one of them advances the other can become weak.',
    plansFor: {
      owner: 'Keep the pawns side by side and defended by pieces, use the half-open b- and e-files, and push d5 or c5 when it opens lines for your pieces or cuts the opponent in two.',
      opponent: 'Attack the pair with pieces (rooks on the c- and d-files, bishops on the long diagonal) and challenge it with b5 or e5 to make one pawn advance, then blockade and win the backward partner.',
    },
  },
  carlsbad: {
    name: 'Carlsbad',
    summary: "The Queen's Gambit Exchange structure: White has pawns on d4 and e3, Black has d5 and c6 after cxd5 exd5. White has the half-open c-file and Black the half-open e-file.",
    plansFor: {
      owner: 'Run the minority attack: b4-b5 and bxc6 to leave Black with a weak c-pawn or isolated d-pawn on the half-open c-file. Alternatively, play f3 and e4 to build a big centre after castling short.',
      opponent: 'Use the e-file and the outpost on e4 for a knight, play for a kingside attack with pieces (Nf6-e4, Rf8-e8-e6-h6, f5-f4), or meet b4 with a timely ...b5 or ...a5 to blunt the minority attack.',
    },
  },
  maroczy: {
    name: 'Maróczy bind',
    summary: 'White pawns on c4 and e4 with no d-pawn, against a Black d-pawn and no c-pawn. The pawns clamp d5 and give White a lasting space advantage, while Black is solid but cramped.',
    plansFor: {
      owner: 'Keep the bind: control d5 with pieces, avoid trades that ease Black\'s position, and expand slowly (b4, f4) while watching for the ...b5 and ...d5 breaks.',
      opponent: 'Trade pieces to relieve the cramp, put a knight on c5 or e5 and the dark-squared bishop on the long diagonal, and prepare ...b5 or ...d5 (or ...f5) to break the bind.',
    },
  },
  hedgehog: {
    name: 'Hedgehog',
    summary: 'Black has pawns on a6 (or a7), b6, d6 and e6 with no c-pawn, facing White pawns on c4 and e4. Black accepts a cramped position behind a compact, spiky pawn wall, waiting for the right moment to strike.',
    plansFor: {
      owner: 'Stay compact and flexible (bishops on b7 and e7, queen on c7, rooks on c8 and d8), and prepare the ...b5 or ...d5 breaks; when one of them works, the position springs open in Black\'s favour.',
      opponent: 'Use your extra space without overextending: stop ...b5 and ...d5 with pieces, and then expand on the kingside (f4, g4) or prepare e5 or c5 at the right moment.',
    },
  },
  stonewall: {
    name: 'Stonewall',
    summary: 'White pawns on c3, d4, e3 and f4 form a wall on the dark squares. The e5 square is a strong outpost and the structure supports a kingside attack, but e4 is a hole and the c1 bishop is often bad.',
    plansFor: {
      owner: 'Plant a knight on e5, bring the queen and rook to the kingside (Rf3-h3, Qf3) and attack; activate or trade off the problem bishop on c1, hemmed in by its own pawns.',
      opponent: 'Occupy e4 with a knight, trade the strong dark-squared bishop or the e5 knight, and open the queenside with ...c5 and ...b5, where the wall does not help.',
    },
  },
  'french-chain': {
    name: 'French pawn chain',
    summary: 'White pawns d4-e5 against Black pawns d5-e6. White has kingside space; Black attacks the chain from the front and the base.',
    plansFor: {
      owner: 'White: keep e5 and d4 supported (c3, f4, Nf3), and attack on the kingside where the extra space is. Black: undermine the chain with ...c5 against d4 and ...f6 against e5, and use the c-file.',
      opponent: 'White: keep e5 and d4 supported (c3, f4, Nf3), and attack on the kingside where the extra space is. Black: undermine the chain with ...c5 against d4 and ...f6 against e5, and use the c-file.',
    },
  },
  'kid-chain': {
    name: "King's Indian chain",
    summary: 'White pawns d5-e4 against Black pawns d6-e5, as in the closed King\'s Indian. The centre is locked, so each side attacks on the wing its chain points to: White on the queenside, Black on the kingside.',
    plansFor: {
      owner: 'White: expand on the queenside with c5 (prepared by b4 and Nd2-c4) and break into c7. Black: play ...f5, ...f4 and ...g5-g4 for a direct attack on the white king.',
      opponent: 'White: expand on the queenside with c5 (prepared by b4 and Nd2-c4) and break into c7. Black: play ...f5, ...f4 and ...g5-g4 for a direct attack on the white king.',
    },
  },
  'caro-slav': {
    name: 'Slav / Caro-Kann triangle',
    summary: 'Black pawns on c6, d5 and e6 (or e7) against a white d4 pawn. A very solid structure: d5 is well protected, but Black has less space and must find a way to free the position.',
    plansFor: {
      owner: 'Develop the light-squared bishop before closing it in with ...e6 if possible, and free the position with ...c5 or ...e5 once development is complete.',
      opponent: 'Use the extra space: occupy e5 with a knight, prepare e4 (or c4xd5) to open the centre, and stop Black\'s freeing ...c5 and ...e5 breaks.',
    },
  },
  'small-center': {
    name: 'Sicilian small centre (Scheveningen)',
    summary: 'Black pawns on d6 and e6 with no c-pawn, against a white e4 pawn and no white d-pawn. Black\'s compact centre controls d5 and e5 and holds back White\'s pieces, at the cost of space.',
    plansFor: {
      owner: 'Stay flexible and counter-attack on the queenside with ...a6, ...b5 and pressure on the half-open c-file; at the right moment free the position with ...d5 or ...e5.',
      opponent: 'Use the extra space for a kingside attack (f4, g4-g5 or f4-f5), and watch for the e5 or f5 breaks against d6 and e6.',
    },
  },
  boleslavsky: {
    name: 'Boleslavsky hole',
    summary: 'Black pawns on d6 and e5 with no c-pawn, against a white e4 pawn and no white d-pawn. Black gains central control and piece activity, but d5 becomes a permanent hole and d6 can become a backward pawn.',
    plansFor: {
      owner: 'Occupy and control d5: bring knights to d5, trade Black\'s defenders of d5 (often the f6 knight with Bg5xf6), and pressure the backward d6 pawn on the half-open d-file.',
      opponent: 'Keep d5 under control with pieces, prepare ...d5 to liquidate the weakness, and use the half-open c-file and active piece play for counter-chances.',
    },
  },
  dragon: {
    name: 'Dragon',
    summary: 'Black pawns on d6, g6, f7 and h7 with no c-pawn, against a white e4 pawn and no white d-pawn. The fianchettoed bishop on g7 bites down the long diagonal, and Black has the half-open c-file.',
    plansFor: {
      owner: 'Pile up on the c-file (...Rc8, ...Rxc3 exchange sacrifices), use the long diagonal against b2 and the white king, and push ...b5 or ...a5 for a queenside pawn storm.',
      opponent: 'Castle long and storm the kingside with h4-h5 and g4, trade the g7 bishop with Be3-h6, and open the h-file for a mating attack.',
    },
  },
  'open-center': {
    name: 'Open centre',
    summary: 'No pawns on the d- or e-files. Pieces move freely, open files and diagonals decide the game, and development and the initiative matter more than slow plans.',
    plansFor: {
      owner: 'Develop quickly, occupy the open d- and e-files with rooks, keep the bishops active, and play for concrete threats against the king or loose pieces.',
      opponent: 'Develop quickly, occupy the open d- and e-files with rooks, keep the bishops active, and play for concrete threats against the king or loose pieces.',
    },
  },
  'closed-center': {
    name: 'Closed centre',
    summary: 'The d- and e-pawns of both sides are locked against each other. Play moves to the wings, slow manoeuvring is possible, and knights are often better than bishops.',
    plansFor: {
      owner: 'Attack on the wing your pawn chain points to with pawn breaks (c- or f-pawn), and reroute pieces to that side; keep the centre closed while you are not ready.',
      opponent: 'Attack on the wing your pawn chain points to with pawn breaks (c- or f-pawn), and reroute pieces to that side; keep the centre closed while you are not ready.',
    },
  },
}

/** Structure name, summary and plans in the current language. */
export function structureInfo(id: string, lang: 'en' | 'el' = 'en') {
  return (lang === 'el' ? STRUCTURES_EL[id] : undefined) ?? STRUCTURES[id]
}
