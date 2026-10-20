// The built-in coach: turns verified facts (engine lines, tactical motifs, positional changes, pawn
// structure, game phase) into the kind of explanation a good human coach gives. Nothing here is
// guessed: every sentence is backed by the engine line or a detected feature.
import { Chess, type PieceSymbol, type Square } from 'chess.js'
import { detectMotifs, type Motif, type PrevMove } from './motifs'
import { conceptDeltas, type ConceptDelta } from './positional'
import { classifyStructure, STRUCTURES, type Structure } from './structures'
import type { Classification, GameReview, MoveReview } from './review'
import { formatScore } from './score'
import { lessonById } from '../content/lessons'

const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export type Phase = 'opening' | 'middlegame' | 'endgame'

export interface CoachNote {
  headline: string
  tactical: string[]
  strategic: string[]
  advice?: string
  lessons: string[] // lesson ids
  motifs: { missed: Motif[]; allowed: Motif[]; played: Motif[] }
  concepts: ConceptDelta[]
}

// ------------------------------------------------------------------ helpers

function play(fen: string, uci: string[]): { fens: string[]; sans: string[] } {
  const c = new Chess(fen)
  const fens = [fen]
  const sans: string[] = []
  for (const u of uci) {
    try {
      sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san)
      fens.push(c.fen())
    } catch {
      break
    }
  }
  return { fens, sans }
}

function pieceAt(fen: string, sq?: string) {
  if (!sq) return undefined
  try {
    return new Chess(fen).get(sq as Square) || undefined
  } catch {
    return undefined
  }
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

function nonPawnMaterial(fen: string) {
  let m = 0
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase() as PieceSymbol
    if ('nbrq'.includes(t)) m += VALUE[t]
  }
  return m
}

export function phaseOf(fen: string, ply: number, inBook: boolean): Phase {
  const npm = nonPawnMaterial(fen)
  const queens = (fen.split(' ')[0].match(/q/gi) ?? []).length
  if (npm <= 26 || (queens === 0 && npm <= 32)) return 'endgame'
  if (inBook || ply <= 20) return 'opening'
  return 'middlegame'
}

/** Describe a motif as a coach would, naming pieces and squares. `fens[k]` is the board before line[k]. */
function describeMotif(m: Motif, fens: string[], sans: string[]): string | null {
  const before = fens[m.ply]
  const after = fens[m.ply + 1] ?? before
  const san = sans[m.ply]
  if (!san) return null
  const actor = m.piece ? NAME[m.piece] : 'piece'
  // name a square's piece, looking at the board before the move first (pieces may be captured after)
  const named = (sq?: string, prefer: 'before' | 'after' = 'before') => {
    if (!sq) return undefined
    const p = prefer === 'before' ? pieceAt(before, sq) ?? pieceAt(after, sq) : pieceAt(after, sq) ?? pieceAt(before, sq)
    return p ? `the ${NAME[p.type]} on ${sq}` : sq
  }
  const t = m.targets ?? []
  const targets = t.map(sq => named(sq, 'after')!)
  switch (m.kind) {
    case 'mate': {
      const n = m.mateIn ?? Math.ceil(sans.length / 2)
      return `${sans[0]} leads to a forced mate${n ? ` in ${n}` : ''}: ${sans.slice(0, Math.max(1, 2 * n - 1)).join(' ')}`
    }
    case 'backRankMate':
      return `${san} exploits the weak back rank — the king is trapped behind its own pawns`
    case 'smotheredMate':
      return `${san} leads to a smothered mate: the king is boxed in by its own pieces`
    case 'anastasiaMate':
    case 'hookMate':
    case 'arabianMate':
    case 'doubleBishopMate':
      return `${san} sets up a classic mating pattern`
    case 'fork':
      return targets.length ? `${san} — the ${actor}${m.square ? ` on ${m.square}` : ''} forks ${list(targets)}` : `${san} is a fork`
    case 'pin':
      return t.length >= 2 ? `${san} pins ${named(t[0], 'after')} to ${named(t[1], 'after')} — it cannot move without exposing it` : `${san} creates a pin`
    case 'skewer':
      return t.length >= 2 ? `${san} skewers ${named(t[0], 'after')}: once it moves, ${named(t[1], 'after')} falls` : `${san} is a skewer`
    case 'discoveredAttack':
      return m.square ? `${san} is a discovered attack — moving out of the way unmasks the ${actor} on ${m.square}${targets.length ? `, which now hits ${list(targets)}` : ''}` : `${san} is a discovered attack`
    case 'discoveredCheck':
      return `${san} gives a discovered check${m.square ? ` from the ${actor} on ${m.square}` : ''} — the moving piece is free to do damage`
    case 'doubleCheck':
      return `${san} is a double check — only a king move can answer it`
    case 'hangingPiece':
      return targets.length ? `${san} simply wins ${list(targets)}, which was left unprotected` : `${san} grabs a piece that was left hanging`
    case 'trappedPiece':
      return targets.length ? `${san} traps ${list(targets)} — it has no safe square left` : `${san} traps a piece`
    case 'sacrifice':
      return `${san} is a sacrifice that pays off a few moves later`
    case 'deflection':
      return t.length >= 2 ? `${san} deflects ${named(t[0])} away from guarding ${t[1]}` : `${san} deflects a defender away from its job`
    case 'attraction':
      return t.length && m.square ? `${san} lures ${named(t[0])} onto ${m.square}, where it becomes a target` : `${san} lures a piece onto a fatal square`
    case 'capturingDefender':
      return t.length >= 2 ? `${san} removes ${named(t[0])}, the only defender of ${t[1]}` : `${san} removes the defender`
    case 'overloading':
      return `${san} exploits an overloaded defender`
    case 'interference':
      return t.length >= 2 ? `${san} cuts ${named(t[1])} off from defending ${named(t[0])}` : `${san} cuts the line between a defender and what it protects`
    case 'clearance':
      return m.square ? `${san} clears ${m.square} so another piece can use it` : `${san} clears a square or line for another piece`
    case 'intermezzo':
      return targets.length ? `${san} is an in-between move that wins ${list(targets)} before the expected recapture` : `${san} is an in-between move — a stronger move inserted before the expected one`
    case 'xRayAttack':
      return targets.length ? `${san} wins ${list(targets)} through an x-ray along the line` : `${san} works through an x-ray along the line`
    case 'promotion':
    case 'underPromotion':
      return `${san} promotes the pawn${m.kind === 'underPromotion' ? ' — and the under-promotion is the precise choice' : ''}`
    case 'advancedPawn':
      return `${san} — the advanced pawn is the star of this line`
    case 'exposedKing':
      return `${san} goes after the exposed king`
    case 'attackingF2F7':
      return `${san} targets the weak f-pawn next to the king`
    default:
      return null
  }
}

/** "Nxg6 pins the pawn…" -> "Nxg6, which pins the pawn…" so it reads after "your opponent has". */
function asClause(d: string): string {
  let m = /^(\S+) — (.*)$/.exec(d)
  if (m) return `${m[1]}, and ${m[2]}`
  m = /^(\S+) is (an? .*)$/.exec(d)
  if (m) return `${m[1]}, ${m[2]}`
  m = /^(\S+) ([a-z]+s) (.*)$/.exec(d)
  if (m) return `${m[1]}, which ${m[2]} ${m[3]}`
  return d
}

const MOTIF_LESSON: Partial<Record<Motif['kind'], string>> = {
  fork: 'forks', pin: 'pins-skewers', skewer: 'pins-skewers', xRayAttack: 'pins-skewers',
  discoveredAttack: 'discovered-attacks', discoveredCheck: 'discovered-attacks', doubleCheck: 'discovered-attacks',
  hangingPiece: 'loose-pieces', trappedPiece: 'loose-pieces',
  deflection: 'removing-defenders', attraction: 'removing-defenders', capturingDefender: 'removing-defenders',
  overloading: 'removing-defenders', interference: 'removing-defenders', clearance: 'removing-defenders',
  intermezzo: 'in-between-moves', sacrifice: 'sacrifices',
  mate: 'mating-patterns', backRankMate: 'mating-patterns', smotheredMate: 'mating-patterns', anastasiaMate: 'mating-patterns',
  hookMate: 'mating-patterns', arabianMate: 'mating-patterns', doubleBishopMate: 'mating-patterns', exposedKing: 'king-safety',
  promotion: 'pawn-promotion', underPromotion: 'pawn-promotion', advancedPawn: 'pawn-promotion', attackingF2F7: 'mating-patterns',
}

const TACTICAL_KINDS = new Set(Object.keys(MOTIF_LESSON))

/** Map a positional concept (from positional.ts) to a lesson. */
export function conceptLesson(concept: string): string | undefined {
  const c = concept.toLowerCase()
  if (/outpost|hole/.test(c)) return 'outposts'
  if (/isolat|doubled|backward|weak|unopposed/.test(c)) return 'weak-pawns'
  if (/hanging ?pawn/.test(c)) return 'hanging-pawns'
  if (/passed/.test(c)) return 'passed-pawns'
  if (/rook|file|7th|seventh/.test(c)) return 'open-files'
  if (/bishop/.test(c)) return 'good-bad-bishop'
  if (/space|center|centre/.test(c)) return 'space-center'
  if (/king|shield|storm/.test(c)) return 'king-safety'
  if (/hanging|threat/.test(c)) return 'loose-pieces'
  return undefined
}

const STRUCTURE_LESSON: Record<string, string> = {
  iqp: 'iqp', 'hanging-pawns': 'hanging-pawns', carlsbad: 'carlsbad', maroczy: 'maroczy-hedgehog', hedgehog: 'maroczy-hedgehog',
  'french-chain': 'pawn-chains', 'kid-chain': 'pawn-chains', 'closed-center': 'pawn-chains', 'small-center': 'sicilian-structures',
  boleslavsky: 'sicilian-structures', dragon: 'sicilian-structures', stonewall: 'stonewall-slav', 'caro-slav': 'stonewall-slav',
  'open-center': 'space-center',
}
export const structureLesson = (id: string) => STRUCTURE_LESSON[id]

const isMobility = (c: ConceptDelta) => /mobility/i.test(c.concept) || /mobility/i.test(c.text)

/** Coach voice: "White's pieces" -> "your pieces" for the mover; engine-ish mobility counts become plain words. */
export function voice(text: string, mover: 'w' | 'b'): string {
  const me = mover === 'w' ? 'White' : 'Black'
  const them = mover === 'w' ? 'Black' : 'White'
  return text
    .replace(/(increases|improves) (White|Black)'s piece mobility \([^)]*\)/g, (_, _v, side) => (side === me ? 'activates your pieces' : "activates your opponent's pieces"))
    .replace(/(reduces|decreases) (White|Black)'s piece mobility \([^)]*\)/g, (_, _v, side) => (side === me ? 'makes your pieces more passive' : "restricts your opponent's pieces"))
    .replace(new RegExp(`\\b${me}'s\\b`, 'g'), 'your')
    .replace(new RegExp(`\\b${them}'s\\b`, 'g'), "your opponent's")
    .replace(new RegExp(`\\bfor ${me}\\b`, 'g'), 'for you')
    .replace(new RegExp(`\\bfor ${them}\\b`, 'g'), 'for your opponent')
}

/** Positional changes, with mobility-only changes ranked last (they are rarely the real point). */
function safeConcepts(before: string, after: string): ConceptDelta[] {
  try {
    const all = conceptDeltas(before, after)
    return [...all.filter(c => !isMobility(c)), ...all.filter(isMobility)]
  } catch {
    return []
  }
}

function safeMotifs(fen: string, line: string[], prev?: PrevMove): Motif[] {
  if (!line.length) return []
  try {
    return detectMotifs(fen, line, prev)
  } catch {
    return []
  }
}

function fenAfterUci(fen: string, uci?: string) {
  if (!uci) return undefined
  try {
    const c = new Chess(fen)
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return c.fen()
  } catch {
    return undefined
  }
}

// --------------------------------------------------------------- per move

const PHRASES: Record<Classification, string[]> = {
  brilliant: ['A brilliant idea.', 'This is the kind of move coaches remember.'],
  great: ['Great find — the only move that holds everything together.', 'Excellent: you found the one move the position demanded.'],
  best: ['Exactly what the position needed.', 'The best move.'],
  excellent: ['A very good move.', 'Strong and natural.'],
  good: ['Reasonable, but there was something better.', 'Playable, not the most precise.'],
  book: ['Opening theory.', 'A main-line move.'],
  forced: ['The only legal move.'],
  inaccuracy: ['A small slip.', 'Imprecise.'],
  mistake: ['A real mistake.', 'This costs you.'],
  miss: ['A missed chance.', 'Your opponent had just given you something — and it slipped away.'],
  blunder: ['This is where the game turned.', 'A serious blunder.'],
}

const pick = (xs: string[], seed: number) => xs[seed % xs.length]

export function coachMove(review: GameReview, index: number): CoachNote {
  const m = review.moves[index]
  const mover = m.color
  const tactical: string[] = []
  const strategic: string[] = []
  const lessons = new Set<string>()

  // Tactics: what the best line contained (missed) and what the reply line punishes (allowed).
  const errored = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.cls)
  const good = ['brilliant', 'great', 'best', 'excellent'].includes(m.cls)
  const best = play(m.fenBefore, m.bestLineUci)
  const reply = play(m.fenAfter, m.replyLineUci)
  const before = review.moves[index - 1]
  const prevUci: PrevMove | undefined = before && { fen: before.fenBefore, uci: before.uci }
  const missed = errored ? safeMotifs(m.fenBefore, m.bestLineUci, prevUci).filter(x => TACTICAL_KINDS.has(x.kind)) : []
  const allowed = errored ? safeMotifs(m.fenAfter, m.replyLineUci, { fen: m.fenBefore, uci: m.uci }).filter(x => TACTICAL_KINDS.has(x.kind)) : []
  const playedLine = good ? [m.uci, ...m.replyLineUci] : []
  const played = good && m.cls !== 'book' ? safeMotifs(m.fenBefore, playedLine, prevUci).filter(x => TACTICAL_KINDS.has(x.kind) && (x.ply === 0 || /mate/i.test(x.kind))) : []

  const headline = `${pick(PHRASES[m.cls], m.ply)}`

  if (allowed.length) {
    const d = describeMotif(allowed[0], reply.fens, reply.sans)
    if (d) tactical.push(`After ${m.san}, your opponent has ${asClause(d)}.`)
    allowed.slice(0, 2).forEach(x => MOTIF_LESSON[x.kind] && lessons.add(MOTIF_LESSON[x.kind]!))
  }
  if (missed.length && m.bestSan) {
    const d = describeMotif(missed[0], best.fens, best.sans)
    if (d) tactical.push(`${m.cls === 'miss' ? 'You had a winning shot' : 'There was a tactic'}: ${d}.`)
    missed.slice(0, 2).forEach(x => MOTIF_LESSON[x.kind] && lessons.add(MOTIF_LESSON[x.kind]!))
  }
  if (played.length) {
    const d = describeMotif(played[0], play(m.fenBefore, playedLine).fens, play(m.fenBefore, playedLine).sans)
    if (d) tactical.push(`${d}.`)
  }

  // Strategy: what the move changed positionally, and what the engine's move would have changed.
  const concepts = m.cls === 'book' ? [] : safeConcepts(m.fenBefore, m.fenAfter)
  const mine = concepts.filter(c => c.side === mover)
  const theirs = concepts.filter(c => c.side !== mover)
  const gains = mine.filter(c => c.delta > 0).filter((c, i, all) => all.findIndex(x => x.concept === c.concept) === i).slice(0, 2)
  const losses = mine.filter(c => c.delta < 0).filter((c, i, all) => all.findIndex(x => x.concept === c.concept) === i).slice(0, 2)
  const oppGains = theirs.filter(c => c.delta > 0).slice(0, 1)

  if (good && !played.length && gains.length && !(gains.length === 1 && isMobility(gains[0]))) strategic.push(`Positionally, ${m.san} ${list(gains.map(c => c.text))}.`)
  if (losses.length && errored && !(tactical.length && losses.every(isMobility))) {
    strategic.push(`The cost: it ${list(losses.map(c => c.text))}.`)
    losses.forEach(c => { const l = conceptLesson(c.concept); if (l) lessons.add(l) })
  }
  if (oppGains.length && errored) strategic.push(`It also gives your opponent something: ${oppGains[0].text}.`)

  if (errored && m.bestUci && !missed.length) {
    const afterBest = fenAfterUci(m.fenBefore, m.bestUci)
    const bestConcepts = afterBest ? safeConcepts(m.fenBefore, afterBest).filter(c => c.side === mover && c.delta > 0).slice(0, 2) : []
    if (bestConcepts.length) strategic.push(`${m.bestSan} was the better plan: it ${list(bestConcepts.map(c => c.text))}.`)
    bestConcepts.forEach(c => { const l = conceptLesson(c.concept); if (l) lessons.add(l) })
  }

  // Structure-aware plan reminder on quiet strategic mistakes.
  const structures = safeStructures(m.fenBefore)
  if (errored && !allowed.length && !missed.length && structures.length) {
    const s = structures[0]
    const info = STRUCTURES[s.id]
    if (info) {
      const side = s.owner === 'both' || s.owner === mover ? info.plansFor.owner : info.plansFor.opponent
      const nm = /^[A-Z][a-z]/.test(info.name) && !/^(Carlsbad|Maróczy|Hedgehog|Stonewall|French|King|Slav|Sicilian|Boleslavsky|Dragon|Caro)/.test(info.name) ? info.name[0].toLowerCase() + info.name.slice(1) : info.name
      strategic.push(`Remember the structure: this is ${/^[aeiou]/i.test(nm) ? 'an' : 'a'} ${nm} position. ${side}`)
      const l = structureLesson(s.id)
      if (l) lessons.add(l)
    }
  }

  for (let k = 0; k < strategic.length; k++) strategic[k] = voice(strategic[k], mover)

  // Advice: the habit behind the error.
  let advice: string | undefined
  if (m.cls === 'blunder' || (m.cls === 'mistake' && allowed.length)) {
    advice = allowed.length
      ? 'Before every move, run the blunder check: after my move, what are my opponent\'s checks, captures and threats?'
      : 'Slow down at critical moments: compare your move with one or two alternatives before committing.'
    lessons.add('blunder-check')
  } else if (m.cls === 'miss') {
    advice = 'When your opponent makes an unexpected move, stop and ask what it allowed — the move after an opponent\'s error is where games are won.'
    lessons.add('punish-mistakes')
  } else if (m.cls === 'good' && m.bestSan) {
    advice = `${m.bestSan} was a little more precise.`
  } else if (m.cls === 'inaccuracy' && !tactical.length && !strategic.length && m.bestSan) {
    advice = `${m.bestSan} was a little more precise (${formatScore(m.scoreBefore)} instead of ${formatScore(m.scoreAfter)}).`
  }

  if (errored && !tactical.length && !strategic.length && m.bestSan) {
    tactical.push(m.bestLineSan.length > 1 ? `${m.bestSan} was stronger: ${m.bestLineSan.slice(0, 5).join(' ')}.` : `${m.bestSan} was stronger.`)
  }
  return { headline, tactical, strategic, advice, lessons: [...lessons], motifs: { missed, allowed, played }, concepts }
}

function safeStructures(fen: string): Structure[] {
  try {
    return classifyStructure(fen)
  } catch {
    return []
  }
}

// --------------------------------------------------------------- per game

export interface PhaseReport { phase: Phase; moves: number; accuracy: number; lost: number; text: string }

export interface GameReport {
  overview: string
  phases: PhaseReport[]
  structures: { id: string; name: string; plan: string; lesson?: string; fromPly: number }[]
  moments: { ply: number; text: string }[]
  strengths: string[]
  improve: { lesson: string; why: string }[]
}

export function coachGame(review: GameReview, player: 'w' | 'b' = 'w'): GameReport {
  const mine = review.moves.filter(m => m.color === player)
  const name = player === 'w' ? review.white : review.black
  const opp = player === 'w' ? review.black : review.white

  // Phases
  let inBook = true
  const phaseOfMove = review.moves.map(m => {
    inBook = inBook && m.cls === 'book'
    return phaseOf(m.fenBefore, m.ply, inBook)
  })
  const phases: PhaseReport[] = (['opening', 'middlegame', 'endgame'] as Phase[]).map(phase => {
    const ms = mine.filter(m => phaseOfMove[m.ply - 1] === phase)
    const acc = ms.length ? ms.reduce((a, m) => a + m.accuracy, 0) / ms.length : 0
    const lost = ms.reduce((a, m) => a + m.loss, 0)
    const bad = ms.filter(m => ['mistake', 'blunder', 'miss'].includes(m.cls)).length
    let text = ''
    if (!ms.length) text = phase === 'endgame' ? 'The game was decided before an endgame.' : ''
    else if (acc >= 90) text = `Excellent ${phase} — you played close to the engine.`
    else if (acc >= 80) text = `A solid ${phase}${bad ? ` with ${bad} slip${bad > 1 ? 's' : ''} to review` : ''}.`
    else if (acc >= 65) text = `Your ${phase} had problems: ${bad} serious error${bad === 1 ? '' : 's'}. This is the phase to work on.`
    else text = `The ${phase} is where this game was lost — ${bad} serious error${bad === 1 ? '' : 's'}.`
    return { phase, moves: ms.length, accuracy: acc, lost, text }
  }).filter(p => p.moves > 0 || p.phase !== 'endgame')

  // Structures that lasted at least 6 plies
  const seen = new Map<string, { s: Structure; from: number; count: number }>()
  review.moves.forEach(m => {
    if (m.ply < 10) return
    for (const s of safeStructures(m.fenAfter)) {
      const e = seen.get(s.id)
      if (e) e.count++
      else seen.set(s.id, { s, from: m.ply, count: 1 })
    }
  })
  const structures = [...seen.values()]
    .filter(e => e.count >= 6)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map(e => {
      const info = STRUCTURES[e.s.id]
      const yours = e.s.owner === 'both' || e.s.owner === player
      return {
        id: e.s.id,
        name: info?.name ?? e.s.name,
        plan: info ? `${info.summary} ${yours ? info.plansFor.owner : info.plansFor.opponent}` : '',
        lesson: structureLesson(e.s.id),
        fromPly: e.from,
      }
    })

  // Key moments: the biggest swings for either side
  const moments = review.moves
    .filter(m => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.cls))
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 5)
    .sort((a, b) => a.ply - b.ply)
    .map(m => {
      const note = coachMove(review, m.ply - 1)
      const mineMove = m.color === player
      const detail = note.tactical[0] ?? note.strategic[0] ?? ''
      // Notes are written to the mover; for the opponent's moves, retell them from the player's side.
      const text = mineMove ? `${note.headline} ${detail}` : opponentView(m.cls, detail)
      return { ply: m.ply, text: `${moveNo(m)} ${m.san} (${mineMove ? 'You' : opp}) — ${text}`.trim() }
    })

  // Strengths
  const strengths: string[] = []
  const count = (cls: Classification) => mine.filter(m => m.cls === cls).length
  if (count('brilliant')) strengths.push(`You found ${count('brilliant')} brilliant move${count('brilliant') > 1 ? 's' : ''}.`)
  if (count('great')) strengths.push(`You found the only good move ${count('great')} time${count('great') > 1 ? 's' : ''} when it mattered.`)
  const best = phases.filter(p => p.moves >= 4).sort((a, b) => b.accuracy - a.accuracy)[0]
  if (best && best.accuracy >= 75) strengths.push(`Your strongest phase was the ${best.phase} (${best.accuracy.toFixed(0)}% accuracy).`)
  if (!mine.some(m => m.cls === 'blunder')) strengths.push('No blunders — you kept the position under control.')

  // What to improve: lessons weighted by how much each cost
  const weight = new Map<string, { w: number; why: string }>()
  for (const m of mine) {
    if (!['inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.cls)) continue
    const note = coachMove(review, m.ply - 1)
    for (const l of note.lessons) {
      const e = weight.get(l) ?? { w: 0, why: `${moveNo(m)} ${m.san}` }
      e.w += m.loss
      weight.set(l, e)
    }
  }
  const improve = [...weight.entries()].sort((a, b) => b[1].w - a[1].w).slice(0, 3).map(([lesson, e]) => ({ lesson, why: `see ${e.why}` }))

  const acc = player === 'w' ? review.accuracy.w : review.accuracy.b
  const result = review.result === '1/2-1/2' ? 'a draw' : (review.result === '1-0') === (player === 'w') ? 'a win' : review.result === '*' ? 'an unfinished game' : 'a loss'
  const turning = moments.find(x => review.moves[x.ply - 1].cls === 'blunder')
  const overview = `${name}, this was ${result} against ${opp} with ${acc.toFixed(1)}% accuracy${review.opening ? ` in the ${review.opening.replace(/^[A-E]\d\d /, '')}` : ''}. ` +
    (turning ? `The turning point came on move ${Math.ceil(turning.ply / 2)}. ` : '') +
    (improve.length ? `The biggest lesson from this game: ${(lessonById(improve[0].lesson)?.title ?? improve[0].lesson).toLowerCase()}.` : 'A clean game — keep it up.')

  return { overview, phases, structures, moments, strengths, improve }
}

/** Retell a coach note about the opponent's move from the player's point of view. */
function opponentView(cls: Classification, detail: string): string {
  const head: Partial<Record<Classification, string>> = {
    blunder: 'Your opponent blundered.', mistake: 'Your opponent went wrong.', miss: 'Your opponent missed a chance.',
    brilliant: 'Your opponent found a brilliant idea.', great: 'Your opponent found the only good move.',
  }
  const body = detail
    .replace(/^After (\S+), your opponent has /, 'After $1, you had ')
    .replace(/^You had a winning shot/, 'They had a winning shot')
    .replace(/^There was a tactic/, 'They had a tactic')
    .replace(/\byour opponent's\b/g, 'your')
    .replace(/\byour\b(?! opponent)/g, 'their')
  return `${head[cls] ?? ''} ${body}`.trim()
}

export const moveNo = (m: MoveReview) => `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '…'}`

/** One-sentence tactical explanation of a line (solver to move in `fen`), or null if no motif is found. */
export function explainLine(fen: string, line: string[], prev?: PrevMove): string | null {
  const motifs = safeMotifs(fen, line, prev).filter(x => TACTICAL_KINDS.has(x.kind))
  if (!motifs.length) return null
  const { fens, sans } = play(fen, line)
  const d = describeMotif(motifs[0], fens, sans)
  if (!d || motifs[0].ply === 0 || /mate/i.test(motifs[0].kind)) return d
  return `the idea is ${sans.slice(0, motifs[0].ply).join(' ')}, and then ${d}`
}
