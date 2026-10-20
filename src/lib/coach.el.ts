// Greek wording for the built-in coach. Same facts as the English coach (coach.ts), written the way a
// Greek coach talks to a student: second person, standard Greek chess terms, algebraic notation kept as is.
import { Chess, type PieceSymbol, type Square } from 'chess.js'
import type { Motif } from './motifs'
import type { Classification } from './review'

type Case = 'nom' | 'acc' | 'gen'
const FORMS: Record<Case, Record<PieceSymbol, string>> = {
  nom: { p: 'το πιόνι', n: 'ο ίππος', b: 'ο αξιωματικός', r: 'ο πύργος', q: 'η βασίλισσα', k: 'ο βασιλιάς' },
  acc: { p: 'το πιόνι', n: 'τον ίππο', b: 'τον αξιωματικό', r: 'τον πύργο', q: 'τη βασίλισσα', k: 'τον βασιλιά' },
  gen: { p: 'του πιονιού', n: 'του ίππου', b: 'του αξιωματικού', r: 'του πύργου', q: 'της βασίλισσας', k: 'του βασιλιά' },
}

/** σε + article: "τον ίππο" -> "στον ίππο", "το e5" -> "στο e5". */
const se = (acc: string) => acc.replace(/^(το|τον|τη|την) /, (_, a: string) => `σ${a} `)

/** True when the move from `before` to `after` captured the piece standing on `sq`. */
export function capturedHere(before: string | undefined, after: string | undefined, sq: string): boolean {
  if (!before || !after || before === after) return false
  const b = pieceAt(before, sq)
  const a = pieceAt(after, sq)
  return !!b && !!a && a.color !== b.color
}

export const listEl = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} και ${xs.at(-1)}`)

function pieceAt(fen: string | undefined, sq?: string) {
  if (!fen || !sq) return undefined
  try {
    return new Chess(fen).get(sq as Square) || undefined
  } catch {
    return undefined
  }
}

/** Greek description of a tactical motif. `fens[k]` is the board before line[k]. */
export function describeMotifEl(m: Motif, fens: string[], sans: string[]): string | null {
  const before = fens[m.ply]
  const after = fens[m.ply + 1] ?? before
  const san = sans[m.ply]
  if (!san) return null
  const named = (sq: string | undefined, c: Case, prefer: 'before' | 'after' = 'before') => {
    if (!sq) return ''
    if (capturedHere(before, after, sq)) prefer = 'before'
    const p = prefer === 'before' ? pieceAt(before, sq) ?? pieceAt(after, sq) : pieceAt(after, sq) ?? pieceAt(before, sq)
    return p ? `${FORMS[c][p.type]} στο ${sq}` : `το ${sq}`
  }
  const actor = (c: Case) => (m.piece ? FORMS[c][m.piece] : 'το κομμάτι')
  const bare = (sq: string | undefined) => {
    const p = pieceAt(before, sq) ?? pieceAt(after, sq)
    return p ? FORMS.acc[p.type] : 'το κομμάτι'
  }
  const t = m.targets ?? []
  const targetsAcc = t.map(sq => named(sq, 'acc', 'after'))
  switch (m.kind) {
    case 'mate': {
      const n = m.mateIn ?? Math.ceil(sans.length / 2)
      return `${sans[0]} οδηγεί σε αναγκαστικό ματ${n ? ` σε ${n}` : ''}: ${sans.slice(0, Math.max(1, 2 * n - 1)).join(' ')}`
    }
    case 'backRankMate':
      return `${san} εκμεταλλεύεται την αδύναμη τελευταία γραμμή — ο βασιλιάς είναι παγιδευμένος πίσω από τα πιόνια του`
    case 'smotheredMate':
      return `${san} οδηγεί σε πνιγμένο ματ: ο βασιλιάς είναι κλεισμένος από τα δικά του κομμάτια`
    case 'anastasiaMate':
    case 'hookMate':
    case 'arabianMate':
    case 'doubleBishopMate':
      return `${san} στήνει ένα κλασικό μοτίβο ματ`
    case 'fork':
      return targetsAcc.length ? `${san} — ${actor('nom')}${m.square ? ` στο ${m.square}` : ''} κάνει πιρούνι ${listEl(targetsAcc.map(se))}` : `${san} είναι πιρούνι`
    case 'pin':
      return t.length >= 2 ? `${san} καρφώνει ${named(t[0], 'acc', 'after')} μπροστά από ${named(t[1], 'acc', 'after')} — δεν μπορεί να κινηθεί χωρίς να εκθέσει ό,τι είναι πίσω του` : `${san} δημιουργεί κάρφωμα`
    case 'skewer':
      return t.length >= 2 ? `${san} κάνει σούβλα ${se(named(t[0], 'acc', 'after'))}: μόλις μετακινηθεί, χάνεται ${named(t[1], 'nom', 'after')}` : `${san} είναι σούβλα`
    case 'discoveredAttack':
      return m.square ? `${san} είναι ακάλυπτη επίθεση — φεύγοντας από τη μέση ξεσκεπάζει ${actor('acc')} στο ${m.square}${targetsAcc.length ? `, που τώρα χτυπά ${listEl(targetsAcc)}` : ''}` : `${san} είναι ακάλυπτη επίθεση`
    case 'discoveredCheck':
      return `${san} δίνει ακάλυπτο σαχ${m.square ? ` από ${actor('acc')} στο ${m.square}` : ''} — το κομμάτι που φεύγει είναι ελεύθερο να κάνει ζημιά`
    case 'doubleCheck':
      return `${san} είναι διπλό σαχ — απαντιέται μόνο με κίνηση του βασιλιά`
    case 'hangingPiece':
      return targetsAcc.length ? `${san} κερδίζει απλώς ${listEl(targetsAcc)}, που είχε μείνει χωρίς προστασία` : `${san} κερδίζει ένα κομμάτι που είχε μείνει απροστάτευτο`
    case 'trappedPiece':
      return targetsAcc.length ? `${san} παγιδεύει ${listEl(targetsAcc)} — δεν έχει πια ασφαλές τετράγωνο` : `${san} παγιδεύει ένα κομμάτι`
    case 'sacrifice':
      return `${san} είναι θυσία που αποδίδει λίγες κινήσεις αργότερα`
    case 'deflection':
      return t.length >= 2 ? `${san} εκτρέπει ${named(t[0], 'acc')} από τη φύλαξη του τετραγώνου ${t[1]}` : `${san} εκτρέπει έναν αμυνόμενο από τη δουλειά του`
    case 'attraction':
      return t.length && m.square ? `${san} παρασύρει ${bare(t[0])} στο ${m.square}, όπου γίνεται στόχος` : `${san} παρασύρει ένα κομμάτι σε μοιραίο τετράγωνο`
    case 'capturingDefender':
      return t.length >= 2 ? `${san} εξαλείφει ${named(t[0], 'acc')}, που ήταν η μόνη άμυνα του τετραγώνου ${t[1]}` : `${san} εξαλείφει τον αμυνόμενο`
    case 'overloading':
      return `${san} εκμεταλλεύεται έναν υπερφορτωμένο αμυνόμενο`
    case 'interference':
      return t.length >= 2 ? `${san} κόβει τη γραμμή, και ${named(t[1], 'nom')} δεν μπορεί πια να προστατέψει ${named(t[0], 'acc')}` : `${san} κόβει τη γραμμή ανάμεσα σε έναν αμυνόμενο και ό,τι προστατεύει`
    case 'clearance':
      return m.square ? `${san} αδειάζει το ${m.square} για να το χρησιμοποιήσει άλλο κομμάτι` : `${san} ανοίγει τετράγωνο ή γραμμή για άλλο κομμάτι`
    case 'intermezzo':
      return targetsAcc.length ? `${san} είναι ενδιάμεση κίνηση που κερδίζει ${listEl(targetsAcc)} πριν από την αναμενόμενη ανακατάληψη` : `${san} είναι ενδιάμεση κίνηση — μια πιο δυνατή κίνηση πριν από την αναμενόμενη`
    case 'xRayAttack':
      return targetsAcc.length ? `${san} κερδίζει ${listEl(targetsAcc)} με ακτίνες Χ μέσα από τη γραμμή` : `${san} δουλεύει με ακτίνες Χ μέσα από τη γραμμή`
    case 'promotion':
    case 'underPromotion':
      return `${san} προάγει το πιόνι${m.kind === 'underPromotion' ? ' — και η υποπροαγωγή είναι η ακριβής επιλογή' : ''}`
    case 'advancedPawn':
      return `${san} — το προχωρημένο πιόνι είναι ο πρωταγωνιστής αυτής της γραμμής`
    case 'exposedKing':
      return `${san} κυνηγά τον εκτεθειμένο βασιλιά`
    case 'attackingF2F7':
      return `${san} χτυπά το αδύναμο πιόνι f δίπλα στον βασιλιά`
    default:
      return null
  }
}

/** "Nxg6 καρφώνει…" -> "Nxg6, που καρφώνει…" so it reads after "ο αντίπαλος έχει". */
export function clauseEl(d: string): string {
  let m = /^(\S+) — (.*)$/.exec(d)
  if (m) return `${m[1]}, και ${m[2]}`
  m = /^(\S+) είναι (.*)$/.exec(d)
  if (m) return `${m[1]}: ${m[2]}`
  m = /^(\S+) (\S+) (.*)$/.exec(d)
  if (m) return `${m[1]}, που ${m[2]} ${m[3]}`
  return d
}

export const PHRASES_EL: Record<Classification, string[]> = {
  brilliant: ['Λαμπρή ιδέα.', 'Τέτοιες κινήσεις τις θυμάται ένας προπονητής.'],
  great: ['Σπουδαίο εύρημα — η μόνη κίνηση που κρατάει τα πάντα στη θέση τους.', 'Εξαιρετικό: βρήκες τη μοναδική κίνηση που ζητούσε η θέση.'],
  best: ['Ακριβώς αυτό που χρειαζόταν η θέση.', 'Η καλύτερη κίνηση.'],
  excellent: ['Πολύ καλή κίνηση.', 'Δυνατή και φυσική κίνηση.'],
  good: ['Λογική κίνηση, αλλά υπήρχε κάτι καλύτερο.', 'Παίζεται, αλλά δεν είναι η πιο ακριβής.'],
  book: ['Θεωρία ανοίγματος.', 'Κύρια γραμμή της θεωρίας.'],
  forced: ['Η μόνη νόμιμη κίνηση.'],
  inaccuracy: ['Μικρή ανακρίβεια.', 'Όχι η πιο ακριβής.'],
  mistake: ['Πραγματικό λάθος.', 'Αυτό σου κοστίζει.'],
  miss: ['Χαμένη ευκαιρία.', 'Ο αντίπαλος μόλις σου είχε δώσει κάτι — και το άφησες να φύγει.'],
  blunder: ['Εδώ γύρισε η παρτίδα.', 'Σοβαρή αβλεψία.'],
}

const PHASE_EL = { opening: 'άνοιγμα', middlegame: 'μέσο παιχνίδι', endgame: 'φινάλε' } as const

export const TEXT_EL = {
  allowed: (san: string, d: string) =>
    / και μετά /.test(d) ? `Μετά το ${san}, ο αντίπαλος έχει τη συνέχεια ${d}.` : `Μετά το ${san}, ο αντίπαλος έχει το ${clauseEl(d)}.`,
  missed: (isMiss: boolean, d: string) => `${isMiss ? 'Είχες κερδιστικό χτύπημα' : 'Υπήρχε τακτική'}: ${d}.`,
  positionally: (san: string, items: string[]) => `Θεσιακά, το ${san} ${listEl(items)}.`,
  cost: (items: string[]) => `Το τίμημα: ${listEl(items)}.`,
  oppGives: (item: string) => `Δίνει επίσης κάτι στον αντίπαλο: ${item}.`,
  betterPlan: (best: string, items: string[]) => `Το ${best} ήταν το καλύτερο σχέδιο: ${listEl(items)}.`,
  structure: (name: string, plan: string) => `Θυμήσου τη δομή: ${name}. ${plan}`,
  adviceBlunderCheck: 'Πριν από κάθε κίνηση κάνε τον έλεγχο αβλεψίας: μετά την κίνησή μου, ποια σαχ, ποιες αλλαγές και ποιες απειλές έχει ο αντίπαλος;',
  adviceSlowDown: 'Στις κρίσιμες στιγμές πήγαινε πιο αργά: σύγκρινε την κίνησή σου με μία ή δύο εναλλακτικές πριν αποφασίσεις.',
  adviceMiss: 'Όταν ο αντίπαλος κάνει μια απρόσμενη κίνηση, σταμάτα και ρώτα τι επέτρεψε — η κίνηση μετά από λάθος του αντιπάλου είναι εκεί που κερδίζονται οι παρτίδες.',
  morePrecise: (best: string) => `Το ${best} ήταν λίγο πιο ακριβές.`,
  morePreciseScore: (best: string, a: string, b: string) => `Το ${best} ήταν λίγο πιο ακριβές (${a} αντί για ${b}).`,
  stronger: (best: string, line?: string) => (line ? `Το ${best} ήταν πιο δυνατό: ${line}.` : `Το ${best} ήταν πιο δυνατό.`),
  ideaThen: (prefix: string, d: string) => `${prefix} και μετά ${d}`,
  phase: (phase: keyof typeof PHASE_EL, acc: number, bad: number, empty: boolean) => {
    const ph = PHASE_EL[phase]
    const errs = `${bad} σοβαρ${bad === 1 ? 'ό λάθος' : 'ά λάθη'}`
    if (empty) return phase === 'endgame' ? 'Η παρτίδα κρίθηκε πριν από το φινάλε.' : ''
    if (acc >= 90) return `Εξαιρετικό ${ph} — έπαιξες κοντά στη μηχανή.`
    if (acc >= 80) return `Σταθερό ${ph}${bad ? ` με ${bad} ${bad > 1 ? 'αστοχίες' : 'αστοχία'} για να δεις ξανά` : ''}.`
    if (acc >= 65) return `${phase === 'opening' ? 'Το άνοιγμά σου' : `Το ${ph} σου`} είχε προβλήματα: ${errs}. Αυτή είναι η φάση που πρέπει να δουλέψεις.`
    return `Στο ${ph} χάθηκε αυτή η παρτίδα — ${errs}.`
  },
  phaseName: (phase: keyof typeof PHASE_EL) => PHASE_EL[phase],
  you: 'Εσύ',
  opponentView: (cls: Classification, detail: string) => {
    const head: Partial<Record<Classification, string>> = {
      blunder: 'Ο αντίπαλος έκανε αβλεψία.', mistake: 'Ο αντίπαλος έκανε λάθος.', miss: 'Ο αντίπαλος έχασε μια ευκαιρία.',
      brilliant: 'Ο αντίπαλος βρήκε λαμπρή ιδέα.', great: 'Ο αντίπαλος βρήκε τη μόνη καλή κίνηση.',
    }
    // the note speaks to the mover (here the opponent): swap "σου" and "του αντιπάλου"
    const body = detail
      .replace(/^Μετά το (\S+), ο αντίπαλος έχει (το|τη συνέχεια) /, 'Μετά το $1, είχες $2 ')
      // "σου" before a verb is "to you" (-> "του"); after a noun it is "your" (-> "του αντιπάλου")
      .replace(/(^|[\s:])σου (?=\p{L}+ε[ιί](?!\p{L}))/gu, '$1\uE001 ')
      .replace(/^Είχες κερδιστικό χτύπημα/, 'Είχε κερδιστικό χτύπημα')
      .replace(/^Δίνει επίσης κάτι στον αντίπαλο/, 'Σου δίνει επίσης κάτι')
      .replace(/^Θυμήσου τη δομή/, 'Η δομή')
      .replace(/του αντιπάλου/g, '\uE000')
      .replace(/βασίλισσά σου/g, 'βασίλισσα του αντιπάλου')
      .replace(/ σου(?!\p{L})/gu, ' του αντιπάλου')
      .replace(/\uE000/g, 'σου')
      .replace(/\uE001/g, 'του')
      .replace(/βασίλισσα σου/g, 'βασίλισσά σου')
    return `${head[cls] ?? ''} ${body}`.trim()
  },
  brilliantCount: (n: number) => `Βρήκες ${n} ${n > 1 ? 'λαμπρές κινήσεις' : 'λαμπρή κίνηση'}.`,
  greatCount: (n: number) => `Βρήκες τη μόνη καλή κίνηση ${n} ${n > 1 ? 'φορές' : 'φορά'} εκεί που μετρούσε.`,
  strongestPhase: (phase: keyof typeof PHASE_EL, acc: number) => `Η πιο δυνατή σου φάση ήταν το ${PHASE_EL[phase]} (ακρίβεια ${acc.toFixed(0)}%).`,
  noBlunders: 'Καμία αβλεψία — κράτησες τη θέση υπό έλεγχο.',
  see: (move: string) => `δες ${move}`,
  overview: (a: { name: string; result: 'win' | 'loss' | 'draw' | 'unfinished'; opp: string; acc: number; opening?: string; turningMove?: number; lesson?: string }) => {
    const res = a.result === 'draw' ? 'ισοπαλία' : a.result === 'win' ? 'νίκη' : a.result === 'loss' ? 'ήττα' : 'ημιτελής παρτίδα'
    return `${a.name}, αυτή ήταν ${res} απέναντι στον αντίπαλο ${a.opp} με ακρίβεια ${a.acc.toFixed(1)}%${a.opening ? ` στο άνοιγμα ${a.opening}` : ''}. ` +
      (a.turningMove ? `Η καμπή ήρθε στην κίνηση ${a.turningMove}. ` : '') +
      (a.lesson ? `Το μεγαλύτερο μάθημα από αυτή την παρτίδα: «${a.lesson}».` : 'Καθαρή παρτίδα — συνέχισε έτσι.')
  },
}
