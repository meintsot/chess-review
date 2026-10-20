// Builds public/openings.json (position key -> "ECO Name", "" for in-book positions with no name)
// from the lichess-org/chess-openings TSVs (CC0).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Chess } from 'chess.js'

const book = {}
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(new URL(`./openings/${f}.tsv`, import.meta.url), 'utf8').trim().split('\n').slice(1)
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    chess.loadPgn(pgn)
    const replay = new Chess()
    for (const mv of chess.history()) {
      replay.move(mv)
      const key = replay.fen().split(' ').slice(0, 4).join(' ')
      if (!(key in book)) book[key] = ''
    }
    const key = replay.fen().split(' ').slice(0, 4).join(' ')
    book[key] = `${eco} ${name}`
  }
}
// Popularity book: positions 2000+ players reached often in non-bullet Lichess games (see popular.json),
// so "Book" lasts about as long as chess.com's theory does even where the named lines stop.
const popularUrl = new URL('./openings/popular.json', import.meta.url)
if (existsSync(popularUrl)) {
  for (const key of Object.keys(JSON.parse(readFileSync(popularUrl, 'utf8')))) if (!(key in book)) book[key] = ''
}
writeFileSync(new URL('../public/openings.json', import.meta.url), JSON.stringify(book))
console.log(Object.keys(book).length, 'book positions')
