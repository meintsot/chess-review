// Audit the built-in coach on real games: coverage of mistakes, factual checks of every piece/square it
// mentions, fork geometry, and text hygiene.
//   npx tsx scripts/audit-coach.ts <games.json [{url,pgn}]> <analysis.json [{url,pos:[{lines:[{pv:[uci...],cp|mate}]}]}]> [en|el]
import { readFileSync } from 'node:fs'
import { Chess, type Square } from 'chess.js'
import { buildReview } from '../src/lib/review'
import type { EngineResult } from '../src/lib/engine'
import { coachGame, coachMove } from '../src/lib/coach'

const [gamesPath, analysisPath, langArg] = process.argv.slice(2)
const lang = langArg === 'el' ? 'el' : 'en'
const games: { url: string; pgn: string }[] = JSON.parse(readFileSync(gamesPath, 'utf8'))
const analysis: { url: string; pos: { lines?: { pv: string[]; cp?: number; mate?: number }[] }[] }[] = JSON.parse(readFileSync(analysisPath, 'utf8'))
const book = JSON.parse(readFileSync(new URL('../public/openings.json', import.meta.url), 'utf8'))
const NAMES: Record<string, string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }
const EL_NAMES: Record<string, string> = { 'πιόνι': 'p', 'ίππ': 'n', 'αξιωματικ': 'b', 'πύργ': 'r', 'βασίλισσ': 'q', 'βασιλι': 'k' }
// "the knight on f3" / "τον ίππο στο f3": [piece letter, square]
const CLAIM_EN = /the (pawn|knight|bishop|rook|queen|king) on ([a-h][1-8])/g
const CLAIM_EL = /(?<=(?:^|\s)(?:ο|η|το|τον|τη|την|στον|στη|στο) )(πιόνι|ίππ|αξιωματικ|πύργ|βασίλισσ|βασιλι)[α-ωάέήίόύώ]* στο ([a-h][1-8])/g
// English words that must never appear in Greek output (SAN, square names and engine scores are fine)
const LEAK_EL = /\b(the|and|your|opponent|pawn|knight|bishop|rook|queen|king|move|file|rank|wins|after|was|with)\b/i
// player names (in parentheses) and opening names are proper nouns, not coach text
const coachText = (t: string) => t.replace(/\([^)]*\)/g, '').replace(/στο άνοιγμα [^.]*\./, '').replace(/^[^,]*, αυτή/, '')

function positions(fen: string, line: string[]): string[] {
  const c = new Chess(fen)
  const out = [fen]
  for (const u of line) {
    try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); out.push(c.fen()) } catch { break }
  }
  return out
}

let moves = 0, errors = 0, specific = 0, generic = 0, claims = 0, badClaims = 0, forks = 0, badForks = 0, hygiene = 0
const problems: string[] = []
for (const an of analysis) {
  const g = games.find(x => x.url === an.url)
  if (!g) continue
  const results = an.pos.map(p => (p.lines ? ({ depth: 16, lines: p.lines.map(l => ({ score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 }, pv: l.pv })) } as EngineResult) : (undefined as unknown as EngineResult)))
  const r = buildReview(g.pgn, results, book, 16)
  for (const side of ['w', 'b'] as const) {
    const rep = coachGame(r, side, lang)
    if (lang === 'el') for (const t of [rep.overview, ...rep.phases.map(p => p.text), ...rep.moments.map(x => x.text), ...rep.strengths, ...rep.structures.map(x => x.plan)]) {
      if (LEAK_EL.test(coachText(t))) { hygiene++; problems.push(`english in report: "${t}"`) }
    }
  }
  r.moves.forEach((m, i) => {
    moves++
    const note = coachMove(r, i, lang)
    const texts = [note.headline, ...note.tactical, ...note.strategic, note.advice ?? '']
    const isError = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.cls)
    if (isError) {
      errors++
      const onlyGeneric = !note.strategic.length && note.tactical.every(t => / was stronger|ήταν πιο δυνατό/.test(t))
      if (onlyGeneric) generic++
      else specific++
    }
    // Every "the <piece> on <square>" must exist in some position the note is about.
    const boards = [...positions(m.fenBefore, m.bestLineUci), ...positions(m.fenAfter, m.replyLineUci)]
    for (const t of texts.filter(x => !/^(Remember the structure|Θυμήσου τη δομή)/.test(x))) {
      for (const [, piece, sq] of t.matchAll(lang === 'el' ? CLAIM_EL : CLAIM_EN)) {
        claims++
        const want = lang === 'el' ? EL_NAMES[piece] : NAMES[piece]
        const ok = boards.some(f => new Chess(f).get(sq as Square)?.type === want)
        if (!ok) { badClaims++; problems.push(`claim ${m.san}: "${t}"`) }
      }
      if (/undefined|NaN|\[object|\s{2,}|(?<!\.)\.\.(?!\.)|\b(White|Black)'s\b/.test(t)) { hygiene++; problems.push(`text ${m.san}: "${t}"`) }
      if (lang === 'el' && (LEAK_EL.test(t) || / σε (το|τον|τη|την) |(^|\s)(σ?την) [μλρσ]|, που [A-Za-z]/.test(t))) { hygiene++; problems.push(`english ${m.san}: "${t}"`) }
    }
    // Fork geometry: after the forking move, the forker attacks every target.
    for (const mo of [...note.motifs.allowed, ...note.motifs.missed].filter(x => x.kind === 'fork' && x.square && x.targets?.length)) {
      forks++
      const line = note.motifs.allowed.includes(mo) ? positions(m.fenAfter, m.replyLineUci) : positions(m.fenBefore, m.bestLineUci)
      const after = line[mo.ply + 1]
      if (!after) continue
      const c = new Chess(after)
      const color = c.get(mo.square as Square)?.color
      const ok = !!color && mo.targets!.every(t => c.attackers(t as Square, color).includes(mo.square as Square))
      if (!ok) { badForks++; problems.push(`fork ${m.san}: ${JSON.stringify(mo)}`) }
    }
  })
}
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`
console.log(`games ${analysis.length}, moves ${moves}, errors ${errors}`)
console.log(`errors with a specific (tactical or positional) explanation: ${specific}/${errors} (${pct(specific, errors)}); engine-line only: ${generic}`)
console.log(`piece/square claims checked: ${claims}, wrong: ${badClaims} (${pct(badClaims, claims)})`)
console.log(`fork claims checked: ${forks}, wrong geometry: ${badForks}`)
console.log(`text hygiene issues: ${hygiene}`)
if (problems.length) console.log(problems.slice(0, 15).join('\n'))
