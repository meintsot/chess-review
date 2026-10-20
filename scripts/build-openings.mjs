// Builds public/openings.json (position key -> "ECO Name", "" for in-book positions with no name)
// from the lichess-org/chess-openings TSVs (CC0).
import { readFileSync, writeFileSync } from 'node:fs'
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
writeFileSync(new URL('../public/openings.json', import.meta.url), JSON.stringify(book))
console.log(Object.keys(book).length, 'book positions')
