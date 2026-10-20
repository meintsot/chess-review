// Greek text for the positional concept deltas of positional.ts, written from the player's point of view:
// the `mover` is "εσύ" (σου, τον βασιλιά σου) and the other side is "ο αντίπαλος" (του αντιπάλου).
// The English `text` of each delta is parsed template by template (see conceptDeltas in positional.ts);
// anything unrecognised falls back to a generic Greek phrase for its concept, never to English.

import type { ConceptDelta } from './positional'

type Color = 'w' | 'b'
type Gender = 'm' | 'f' | 'n'

interface PieceEl {
  /** accusative with article: "τον ίππο" */
  acc: string
  /** genitive with article: "του ίππου" */
  gen: string
  /** σε + article (accusative): "στον ίππο" */
  se: string
  /** weak object pronoun: "τον" */
  clitic: string
  g: Gender
}

const PIECES: Record<string, PieceEl> = {
  pawn: { acc: 'το πιόνι', gen: 'του πιονιού', se: 'στο πιόνι', clitic: 'το', g: 'n' },
  knight: { acc: 'τον ίππο', gen: 'του ίππου', se: 'στον ίππο', clitic: 'τον', g: 'm' },
  bishop: { acc: 'τον αξιωματικό', gen: 'του αξιωματικού', se: 'στον αξιωματικό', clitic: 'τον', g: 'm' },
  rook: { acc: 'τον πύργο', gen: 'του πύργου', se: 'στον πύργο', clitic: 'τον', g: 'm' },
  queen: { acc: 'τη βασίλισσα', gen: 'της βασίλισσας', se: 'στη βασίλισσα', clitic: 'την', g: 'f' },
  king: { acc: 'τον βασιλιά', gen: 'του βασιλιά', se: 'στον βασιλιά', clitic: 'τον', g: 'm' },
}
const GENERIC_PIECE: PieceEl = { acc: 'το κομμάτι', gen: 'του κομματιού', se: 'στο κομμάτι', clitic: 'το', g: 'n' }
const piece = (en: string | undefined) => (en && PIECES[en]) || GENERIC_PIECE
/** Accusative singular ending of an adjective in -ος/-η/-ο agreeing with the piece. */
const adj = (stem: string, p: PieceEl) => stem + (p.g === 'f' ? 'η' : 'ο')

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
const colorOf = (en: string | undefined): Color | null => (en === 'White' ? 'w' : en === 'Black' ? 'b' : null)

interface Ctx {
  /** possessive after a noun: "σου" or "του αντιπάλου" */
  poss: (c: Color) => string
  /** `c` is the player ("εσύ") */
  mine: (c: Color) => boolean
  side: Color
}

type Rule = [RegExp, (m: RegExpMatchArray, x: Ctx) => string]

const by = (en: string) => (en === 'a pawn' ? 'ένα πιόνι' : 'ένα φθηνότερο κομμάτι')
const byWith = (en: string) => (en === 'a pawn' ? 'πιόνι' : 'φθηνότερο κομμάτι')

const RULES: Record<string, Rule[]> = {
  'isolated-pawn': [
    [/^creates an isolated queen's pawn on ([a-h][1-8])$/, (m, x) => x.mine(x.side)
      ? `σου δημιουργεί απομονωμένο πιόνι της βασίλισσας στο ${m[1]}`
      : `δημιουργεί στον αντίπαλο απομονωμένο πιόνι της βασίλισσας στο ${m[1]}`],
    [/^creates an isolated pawn on ([a-h][1-8])$/, (m, x) => x.mine(x.side)
      ? `σου δημιουργεί απομονωμένο πιόνι στο ${m[1]}`
      : `δημιουργεί στον αντίπαλο απομονωμένο πιόνι στο ${m[1]}`],
    [/^repairs the isolated pawn on ([a-h][1-8])$/, (m, x) => `διορθώνει το απομονωμένο πιόνι ${x.poss(x.side)} στο ${m[1]}`],
  ],
  'backward-pawn': [
    [/^leaves a backward pawn on ([a-h][1-8])$/, (m, x) => x.mine(x.side)
      ? `σου αφήνει καθυστερημένο πιόνι στο ${m[1]}`
      : `αφήνει στον αντίπαλο καθυστερημένο πιόνι στο ${m[1]}`],
    [/^frees the backward pawn on ([a-h][1-8])$/, (m, x) => `απελευθερώνει το καθυστερημένο πιόνι ${x.poss(x.side)} στο ${m[1]}`],
  ],
  'doubled-pawns': [
    [/^creates doubled pawns on the ([a-h])-file$/, (m, x) => x.mine(x.side)
      ? `σου δημιουργεί διπλά πιόνια στη στήλη ${m[1]}`
      : `δημιουργεί στον αντίπαλο διπλά πιόνια στη στήλη ${m[1]}`],
    [/^undoubles the ([a-h])-pawns$/, (m, x) => `διορθώνει τα διπλά πιόνια ${x.poss(x.side)} στη στήλη ${m[1]}`],
  ],
  'hanging-pawns': [
    [/^creates hanging pawns on ([a-h][1-8]) and ([a-h][1-8])$/, (m, x) => x.mine(x.side)
      ? `σου δημιουργεί κρεμαστά πιόνια στα ${m[1]} και ${m[2]}`
      : `δημιουργεί στον αντίπαλο κρεμαστά πιόνια στα ${m[1]} και ${m[2]}`],
    [/^creates hanging pawns on ([a-h][1-8])$/, (m, x) => x.mine(x.side)
      ? `σου δημιουργεί κρεμαστά πιόνια στο ${m[1]}`
      : `δημιουργεί στον αντίπαλο κρεμαστά πιόνια στο ${m[1]}`],
  ],
  'passed-pawn': [
    [/^creates a passed pawn on ([a-h][1-8])$/, (m, x) => x.mine(x.side)
      ? `δημιουργεί περασμένο πιόνι στο ${m[1]}`
      : `δίνει στον αντίπαλο περασμένο πιόνι στο ${m[1]}`],
    [/^advances the passed pawn to ([a-h][1-8])$/, (m, x) => `προωθεί το περασμένο πιόνι ${x.poss(x.side)} στο ${m[1]}`],
    [/^stops the ([a-h][1-8]) pawn from being passed$/, (m, x) => `κάνει το πιόνι ${x.poss(x.side)} στο ${m[1]} να μην είναι πια περασμένο`],
  ],
  'passed-pawn-blockade': [
    // `side` is the blockading side; the pawn belongs to the other one
    [/^blockades the passed pawn on ([a-h][1-8]) with the (\w+)$/, (m, x) =>
      `αποκλείει το περασμένο πιόνι ${x.poss(other(x.side))} στο ${m[1]} με ${piece(m[2]).acc} ${x.poss(x.side)}`],
  ],
  outpost: [
    [/^gains a (\w+) outpost on ([a-h][1-8])$/, (m, x) => `κερδίζει φυλάκιο για ${piece(m[1]).acc} ${x.poss(x.side)} στο ${m[2]}`],
    [/^turns ([a-h][1-8]) into an outpost for the (\w+)$/, (m, x) => `μετατρέπει το ${m[1]} σε φυλάκιο για ${piece(m[2]).acc} ${x.poss(x.side)}`],
    [/^gives up the (\w+) outpost on ([a-h][1-8])$/, (m, x) => `εγκαταλείπει το φυλάκιο ${piece(m[1]).gen} ${x.poss(x.side)} στο ${m[2]}`],
    [/^undermines the (\w+) outpost on ([a-h][1-8])$/, (m, x) => `υπονομεύει το φυλάκιο ${piece(m[1]).gen} ${x.poss(x.side)} στο ${m[2]}`],
    [/^creates an outpost on ([a-h][1-8]) for (White|Black)'s (\w+)$/, (m, x) =>
      `δημιουργεί φυλάκιο στο ${m[1]} για ${piece(m[3]).acc} ${x.poss(colorOf(m[2]) ?? x.side)}`],
  ],
  'rook-open-file': [
    [/^puts the rook on the (open|half-open) ([a-h])-file$/, (m, x) =>
      `βάζει τον πύργο ${x.poss(x.side)} στην ${m[1] === 'open' ? 'ανοιχτή' : 'μισάνοιχτη'} στήλη ${m[2]}`],
    [/^(opens|half-opens) the ([a-h])-file for the rook on ([a-h][1-8])$/, (m, x) =>
      `${m[1] === 'opens' ? 'ανοίγει' : 'μισανοίγει'} τη στήλη ${m[2]} για τον πύργο ${x.poss(x.side)} στο ${m[3]}`],
  ],
  'rook-7th': [
    [/^puts the rook on the 7th rank \(([a-h][1-8])\)$/, (m, x) => `βάζει τον πύργο ${x.poss(x.side)} στην έβδομη γραμμή (${m[1]})`],
  ],
  'trapped-rook': [
    [/^leaves the rook on ([a-h][1-8]) trapped by its own king$/, (m, x) =>
      `αφήνει τον πύργο ${x.poss(x.side)} στο ${m[1]} εγκλωβισμένο από τον ίδιο του τον βασιλιά`],
  ],
  'bishop-pair': [
    [/^secures the bishop pair for (White|Black)$/, (m, x) => x.mine(colorOf(m[1]) ?? x.side)
      ? 'σου εξασφαλίζει το ζεύγος αξιωματικών'
      : 'εξασφαλίζει στον αντίπαλο το ζεύγος αξιωματικών'],
    [/^takes away (White|Black)'s bishop pair$/, (m, x) => x.mine(colorOf(m[1]) ?? other(x.side))
      ? 'σου στερεί το ζεύγος αξιωματικών'
      : 'στερεί από τον αντίπαλο το ζεύγος αξιωματικών'],
  ],
  'bad-bishop': [
    [/^turns the bishop on ([a-h][1-8]) into a bad bishop/, (m, x) => x.mine(x.side)
      ? `κάνει κακό τον αξιωματικό σου στο ${m[1]} (τα πιόνια σου είναι ακινητοποιημένα στο χρώμα του)`
      : `κάνει κακό τον αξιωματικό του αντιπάλου στο ${m[1]} (τα πιόνια του είναι ακινητοποιημένα στο χρώμα του)`],
  ],
  'bishop-long-diagonal': [
    [/^puts the bishop on the open long diagonal \(([a-h][1-8])\)$/, (m, x) =>
      `βάζει τον αξιωματικό ${x.poss(x.side)} στην ανοιχτή μεγάλη διαγώνιο (${m[1]})`],
  ],
  threat: [
    // `side` owns the piece
    [/^leaves the (\w+) on ([a-h][1-8]) hanging$/, (m, x) => {
      const p = piece(m[1])
      return `αφήνει ${p.acc} ${x.poss(x.side)} στο ${m[2]} ${adj('απροστάτευτ', p)}`
    }],
    [/^puts the (\w+) on ([a-h][1-8]) where (a pawn|a cheaper piece) attacks it$/, (m, x) => {
      const p = piece(m[1])
      return `βάζει ${p.acc} ${x.poss(x.side)} στο ${m[2]}, όπου ${p.clitic} απειλεί ${by(m[3])}`
    }],
    // `side` is the attacker; the piece belongs to the other side
    [/^attacks the (\w+) on ([a-h][1-8]), which is insufficiently defended$/, (m, x) =>
      `απειλεί ${piece(m[1]).acc} ${x.poss(other(x.side))} στο ${m[2]}, που δεν προστατεύεται επαρκώς`],
    [/^attacks the (\w+) on ([a-h][1-8]) with (a pawn|a cheaper piece)$/, (m, x) =>
      `απειλεί ${piece(m[1]).acc} ${x.poss(other(x.side))} στο ${m[2]} με ${byWith(m[3])}`],
    [/^threatens to attack the (\w+) on ([a-h][1-8]) with a pawn advance$/, (m, x) =>
      `απειλεί να διώξει ${piece(m[1]).acc} ${x.poss(other(x.side))} από το ${m[2]} με προώθηση πιονιού`],
    // back to the owner
    [/^moves the (\w+) out of attack$/, (m, x) => `απομακρύνει ${piece(m[1]).acc} ${x.poss(x.side)} από την απειλή`],
    [/^removes the threat to the (\w+) on ([a-h][1-8])$/, (m, x) =>
      `εξουδετερώνει την απειλή κατά ${piece(m[1]).gen} ${x.poss(x.side)} στο ${m[2]}`],
    [/^defends the (\w+) on ([a-h][1-8])$/, (m, x) => `προστατεύει ${piece(m[1]).acc} ${x.poss(x.side)} στο ${m[2]}`],
    // `side` is the attacker that lets go
    [/^releases the pressure on the (\w+) on ([a-h][1-8])$/, (m, x) =>
      `χαλαρώνει την πίεση ${piece(m[1]).se} ${x.poss(other(x.side))} στο ${m[2]}`],
  ],
  'king-shelter': [
    [/^puts (White|Black)'s king behind a (stronger|weaker) pawn shield$/, (m, x) =>
      `βάζει τον βασιλιά ${x.poss(colorOf(m[1]) ?? x.side)} πίσω από ${m[2] === 'stronger' ? 'ισχυρότερη' : 'πιο αδύναμη'} θωράκιση πιονιών`],
    [/^weakens (White|Black)'s king pawn shield( and opens a file next to the king)?$/, (m, x) => {
      const p = x.poss(colorOf(m[1]) ?? x.side)
      return `αποδυναμώνει τη θωράκιση του βασιλιά ${p}${m[2] ? ' και ανοίγει στήλη δίπλα του' : ''}`
    }],
    [/^strengthens (White|Black)'s king pawn shield$/, (m, x) => `ενισχύει τη θωράκιση του βασιλιά ${x.poss(colorOf(m[1]) ?? x.side)}`],
  ],
  'king-storm': [
    [/^advances the pawn storm against (White|Black)'s king$/, (m, x) =>
      `προωθεί την επέλαση πιονιών κατά του βασιλιά ${x.poss(colorOf(m[1]) ?? x.side)}`],
  ],
  'king-danger': [
    [/^increases the pressure on (White|Black)'s king$/, (m, x) => `αυξάνει την πίεση στον βασιλιά ${x.poss(colorOf(m[1]) ?? x.side)}`],
    [/^eases the pressure on (White|Black)'s king$/, (m, x) => `μειώνει την πίεση στον βασιλιά ${x.poss(colorOf(m[1]) ?? x.side)}`],
  ],
  mobility: [
    [/^increases (White|Black)'s piece mobility/, (m, x) => `ενεργοποιεί τα κομμάτια ${x.poss(colorOf(m[1]) ?? x.side)}`],
    [/^reduces (White|Black)'s piece mobility/, (m, x) => x.mine(colorOf(m[1]) ?? x.side)
      ? 'κάνει τα κομμάτια σου πιο παθητικά'
      : 'κάνει τα κομμάτια του αντιπάλου πιο παθητικά'],
  ],
  space: [
    [/^gains space for (White|Black)$/, (m, x) => x.mine(colorOf(m[1]) ?? x.side) ? 'κερδίζει χώρο' : 'δίνει χώρο στον αντίπαλο'],
    [/^reduces (White|Black)'s space$/, (m, x) => `περιορίζει τον χώρο ${x.poss(colorOf(m[1]) ?? x.side)}`],
  ],
}

/** Fallbacks per concept when the English text has no known template: [good for `side`, bad for `side`]. */
const GENERIC: Record<string, [string, string]> = {
  'isolated-pawn': ['βελτιώνει τη δομή πιονιών {p}', 'αφήνει απομονωμένο πιόνι στη δομή {p}'],
  'backward-pawn': ['βελτιώνει τη δομή πιονιών {p}', 'αφήνει καθυστερημένο πιόνι στη δομή {p}'],
  'doubled-pawns': ['βελτιώνει τη δομή πιονιών {p}', 'αφήνει διπλά πιόνια στη δομή {p}'],
  'hanging-pawns': ['αλλάζει τη δομή πιονιών {p}', 'αφήνει κρεμαστά πιόνια στη δομή {p}'],
  'passed-pawn': ['δυναμώνει το περασμένο πιόνι {p}', 'αποδυναμώνει το περασμένο πιόνι {p}'],
  'passed-pawn-blockade': ['αποκλείει ένα περασμένο πιόνι', 'αποκλείει ένα περασμένο πιόνι'],
  outpost: ['κερδίζει φυλάκιο για τα κομμάτια {p}', 'χάνει ένα φυλάκιο για τα κομμάτια {p}'],
  'rook-open-file': ['ενεργοποιεί τον πύργο {p} σε ανοιχτή στήλη', 'αφήνει τον πύργο {p} πιο παθητικό'],
  'rook-7th': ['βάζει τον πύργο {p} στην έβδομη γραμμή', 'απομακρύνει τον πύργο {p} από την έβδομη γραμμή'],
  'trapped-rook': ['απεγκλωβίζει τον πύργο {p}', 'εγκλωβίζει τον πύργο {p}'],
  'bishop-pair': ['εξασφαλίζει το ζεύγος αξιωματικών {p}', 'χάνει το ζεύγος αξιωματικών {p}'],
  'bad-bishop': ['βελτιώνει τον αξιωματικό {p}', 'κάνει κακό τον αξιωματικό {p}'],
  'bishop-long-diagonal': ['ενεργοποιεί τον αξιωματικό {p} στη μεγάλη διαγώνιο', 'απομακρύνει τον αξιωματικό {p} από τη μεγάλη διαγώνιο'],
  threat: ['βελτιώνει την ασφάλεια των κομματιών {p}', 'εκθέτει ένα κομμάτι {p} σε απειλή'],
  'king-shelter': ['ενισχύει τη θωράκιση του βασιλιά {p}', 'αποδυναμώνει τη θωράκιση του βασιλιά {p}'],
  'king-storm': ['απομακρύνει την επέλαση πιονιών από τον βασιλιά {p}', 'προωθεί την επέλαση πιονιών κατά του βασιλιά {p}'],
  'king-danger': ['μειώνει την πίεση στον βασιλιά {p}', 'αυξάνει την πίεση στον βασιλιά {p}'],
  mobility: ['ενεργοποιεί τα κομμάτια {p}', 'κάνει τα κομμάτια {p} πιο παθητικά'],
  space: ['αυξάνει τον χώρο {p}', 'περιορίζει τον χώρο {p}'],
}

/**
 * Greek verb phrase for a concept delta (reads after the move, like the English `text`),
 * from the point of view of `mover`, who is addressed as "εσύ".
 */
export function conceptTextEl(delta: ConceptDelta, mover: Color): string {
  // a proparoxytone noun takes a second accent before the enclitic: "τη βασίλισσά σου"
  return phrase(delta, mover)
    .replace(/βασίλισσα(ς?) σου/g, 'βασίλισσά$1 σου')
    // final -ν of την/στην drops before most consonants: "στη μισάνοιχτη στήλη"
    .replace(/(^|\s)(σ?τ)ην (?=[βδζθλμνρσφχ]|γ(?!κ))/g, '$1$2η ')
}

function phrase(delta: ConceptDelta, mover: Color): string {
  const mine = (c: Color) => c === mover
  const x: Ctx = { side: delta.side, mine, poss: c => (mine(c) ? 'σου' : 'του αντιπάλου') }
  const text = delta.text.trim()
  for (const [re, fn] of RULES[delta.concept] ?? []) {
    const m = text.match(re)
    if (m) return fn(m, x)
  }
  const good = delta.delta >= 0
  const generic = GENERIC[delta.concept]
  if (generic) return generic[good ? 0 : 1].replace('{p}', x.poss(delta.side))
  return mine(delta.side) === good ? 'βελτιώνει τη θέση σου' : 'βελτιώνει τη θέση του αντιπάλου'
}
