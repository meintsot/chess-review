// Compare our classifier with chess.com Game Review on scraped reviews.
//   npx tsx scripts/calibrate.ts <games.json> <analysis.json> <labels.json...>
// games.json:    [{ review, pgn }]                     (chess.com game list)
// analysis.json: [{ url, pos: [{ lines: [{ pv0, cp | mate }] } | { over }] }]  (native Stockfish, MultiPV 2)
// labels.json:   [{ url, summary, moves: [[san, icon, score, desc, text]] }]   (scraped chess.com review)
import { readFileSync, writeFileSync } from 'node:fs'
import { buildReview, type Classification } from '../src/lib/review'
import type { EngineResult } from '../src/lib/engine'

const GREEK: Record<string, Classification> = {
  Θεωρία: 'book', Καλύτερη: 'best', Άριστες: 'excellent', Καλές: 'good', Ανακρίβειες: 'inaccuracy', Λάθη: 'mistake',
  Αστοχία: 'miss', Αβλεψία: 'blunder', Εξαιρετικά: 'great', Εξαιρετικές: 'brilliant', Φορσέ: 'forced',
}
const ORDER: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder']

const [gamesPath, analysisPath, ...labelPaths] = process.argv.slice(2)
const games: { review: string; url: string; pgn: string }[] = JSON.parse(readFileSync(gamesPath, 'utf8'))
const analysis: { url: string; pos: any[] }[] = JSON.parse(readFileSync(analysisPath, 'utf8'))
const labels = labelPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8'))).filter((g: any) => g.moves)
const book = JSON.parse(readFileSync(new URL('../public/openings.json', import.meta.url), 'utf8'))

const conf = new Map<string, number>()
let exact = 0, total = 0
const accErr: number[] = [], ratingErr: number[] = []
const dump: unknown[] = []
for (const lab of labels) {
  const game = games.find(g => g.review === lab.url)
  const an = analysis.find(a => game && a.url === game.url)
  if (!game || !an) continue
  const results: EngineResult[] = an.pos.map(p =>
    p.lines ? { depth: 18, lines: p.lines.map((l: any) => ({ score: 'mate' in l ? { mate: l.mate } : { cp: l.cp }, pv: [l.pv0] })) } : (undefined as any),
  )
  const r = buildReview(game.pgn, results, book, 18)
  r.moves.forEach((m, i) => {
    const theirs = GREEK[lab.moves[i]?.[3]]
    if (!theirs) return
    total++
    dump.push({ ...m.features, theirs, ours: m.cls, game: game.url })
    if (theirs === m.cls) exact++
    conf.set(`${theirs}>${m.cls}`, (conf.get(`${theirs}>${m.cls}`) ?? 0) + 1)
  })
  const nums = lab.summary?.match(/Ακρίβεια\s+([\d.]+)\s+([\d.]+)/)
  if (nums) accErr.push(r.accuracy.w - Number(nums[1]), r.accuracy.b - Number(nums[2]))
  const gr = lab.summary?.match(/Βαθμολογία Παρτίδας\s+(\d+)\s+(\d+)/)
  if (gr) ratingErr.push(r.gameRating.w - Number(gr[1]), r.gameRating.b - Number(gr[2]))
}

if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(dump))

const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / Math.max(1, xs.length))
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length)
console.log(`labels: ${exact}/${total} exact (${((100 * exact) / total).toFixed(1)}%) over ${labels.length} games`)
console.log(`accuracy: bias ${mean(accErr).toFixed(1)}, rmse ${rms(accErr).toFixed(1)} (n=${accErr.length})`)
console.log(`game rating: bias ${mean(ratingErr).toFixed(0)}, rmse ${rms(ratingErr).toFixed(0)} (n=${ratingErr.length})`)
console.log('chess.com label -> ours (precision/recall per label):')
for (const c of ORDER) {
  const row = ORDER.map(o => conf.get(`${c}>${o}`) ?? 0)
  const theirs = row.reduce((a, b) => a + b, 0)
  const ours = ORDER.reduce((a, o) => a + (conf.get(`${o}>${c}`) ?? 0), 0)
  const hit = conf.get(`${c}>${c}`) ?? 0
  if (!theirs && !ours) continue
  const detail = ORDER.map((o, k) => (row[k] && o !== c ? `${o}:${row[k]}` : '')).filter(Boolean).join(' ')
  console.log(`  ${c.padEnd(10)} recall ${hit}/${theirs}  precision ${hit}/${ours}   misread as: ${detail}`)
}
