// Integrity checks over every shipped exercise (public/data). Fails loudly if a rebuild produces bad data.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Chess } from 'chess.js'
import { classifyStructure } from '../structures'

const DATA = join(__dirname, '../../../public/data')
const json = <T>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8'))

function playLine(fen: string, line: string[]): boolean {
  try {
    const c = new Chess(fen)
    for (const u of line) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
    return true
  } catch {
    return false
  }
}

describe('tactical puzzles', () => {
  const files = readdirSync(join(DATA, 'puzzles')).filter(f => f !== 'index.json')
  it('has a file per theme listed in the index', () => {
    const index = json<Record<string, { count: number }>>('puzzles/index.json')
    expect(files.length).toBe(Object.keys(index).length)
    for (const f of files) expect(json<unknown[]>(`puzzles/${f}`).length).toBe(index[f.replace('.json', '')].count)
  })
  it('every puzzle line is legal and tagged with its theme', () => {
    let n = 0
    for (const f of files) {
      const theme = f.replace('.json', '')
      for (const [id, fen, moves, rating, themes] of json<[string, string, string, number, string][]>(`puzzles/${f}`)) {
        expect(playLine(fen, moves.split(' ')), `${theme} ${id}`).toBe(true)
        expect(themes.split(' ')).toContain(theme)
        expect(rating).toBeGreaterThan(0)
        n++
      }
    }
    expect(n).toBeGreaterThan(8000)
  }, 60_000)
})

interface Row { id: string; fen: string; side: 'w' | 'b'; answers: [string, number][]; structure?: string; theme?: string; difficulty: number | null }

describe('strategic exercises', () => {
  const sts = json<Row[]>('strategy/sts.json')
  const st = json<Row[]>('strategy/structures.json')

  it('every position and answer is legal, best answer scores 10', () => {
    for (const r of [...sts, ...st]) {
      const c = new Chess(r.fen)
      expect(c.turn(), r.id).toBe(r.side)
      expect(r.answers[0][1], r.id).toBe(10)
      for (const [uci, pts] of r.answers) {
        expect(playLine(r.fen, [uci]), `${r.id} ${uci}`).toBe(true)
        expect(pts).toBeGreaterThanOrEqual(0)
        expect(pts).toBeLessThanOrEqual(10)
      }
      for (let i = 1; i < r.answers.length; i++) expect(r.answers[i][1]).toBeLessThanOrEqual(r.answers[i - 1][1])
    }
    expect(sts.length).toBeGreaterThan(1400)
    expect(st.length).toBeGreaterThan(450)
  })

  it('ids are unique', () => {
    expect(new Set(sts.map(r => r.id)).size).toBe(sts.length)
    expect(new Set(st.map(r => r.id)).size).toBe(st.length)
  })

  it('the app recognises the same pawn structure the data pipeline tagged (Python and TS agree)', () => {
    const disagree = st.filter(r => !classifyStructure(r.fen).some(s => s.id === r.structure))
    expect(disagree.map(r => `${r.id}:${r.structure}`)).toEqual([])
  })
})
