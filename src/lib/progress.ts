// Training progress kept in the browser (localStorage). Compact and capped so it stays small:
// at most 60 game summaries, 300 own-game exercises and 3000 spaced-repetition cards.
import { LESSONS } from '../content/lessons'

export interface GameSummary {
  id: string
  date: number
  white: string
  black: string
  color: 'w' | 'b'
  result: string
  accuracy: number
  rating: number // game rating estimate for this game
  elo?: number // the player's actual rating from the PGN, if present
  opening?: string
  structures: string[]
  phaseLoss: { opening: number; middlegame: number; endgame: number }
  counts: Record<string, number> // label -> count for the player
  weaknesses: Record<string, number> // lesson id -> weight
}

export interface OwnExercise {
  id: string
  fen: string
  answers: [string, number][] // uci, points (10 = best)
  lesson?: string
  note: string // coach text shown after solving
  game: string // game id
  ply: number
}

export interface Card {
  box: number // Leitner box 0..5
  due: number // ms timestamp
  seen: number
  correct: number
}

export interface Progress {
  version: 1
  player?: { name: string; source: string }
  games: GameSummary[]
  own: OwnExercise[]
  cards: Record<string, Card>
  daily: { day: string; done: number }[]
}

const KEY = 'chess-review.progress.v1'
const BOX_DAYS = [0, 1, 3, 7, 16, 35]
const DAY = 86_400_000

const empty = (): Progress => ({ version: 1, games: [], own: [], cards: {}, daily: [] })

let cache: Progress | null = null
const listeners = new Set<() => void>()

export function loadProgress(): Progress {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty()
  } catch {
    cache = empty()
  }
  return cache!
}

function save(p: Progress) {
  cache = p
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Storage full or blocked: keep working in memory.
  }
  listeners.forEach(l => l())
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setPlayer(name: string, source: string) {
  const p = loadProgress()
  save({ ...p, player: { name, source } })
}

export function addGame(summary: GameSummary, exercises: OwnExercise[]) {
  const p = loadProgress()
  const games = [summary, ...p.games.filter(g => g.id !== summary.id)].slice(0, 60)
  const own = [...exercises, ...p.own.filter(e => e.game !== summary.id)].slice(0, 300)
  save({ ...p, games, own })
}

export function hasGame(id: string) {
  return loadProgress().games.some(g => g.id === id)
}

/** Record an attempt on an exercise and reschedule it (Leitner boxes). */
export function recordAttempt(exId: string, correct: boolean) {
  const p = loadProgress()
  const now = Date.now()
  const c = p.cards[exId] ?? { box: 0, due: now, seen: 0, correct: 0 }
  const box = correct ? Math.min(5, c.box + 1) : 0
  const card: Card = { box, due: now + (correct ? BOX_DAYS[box] * DAY : 10 * 60_000), seen: c.seen + 1, correct: c.correct + (correct ? 1 : 0) }
  let cards = { ...p.cards, [exId]: card }
  const ids = Object.keys(cards)
  if (ids.length > 3000) {
    // drop the oldest well-learned cards first
    ids.sort((a, b) => cards[b].box - cards[a].box || cards[a].due - cards[b].due)
    cards = Object.fromEntries(ids.slice(ids.length - 3000).map(id => [id, cards[id]]))
  }
  const today = new Date().toISOString().slice(0, 10)
  const daily = p.daily.at(-1)?.day === today ? [...p.daily.slice(0, -1), { day: today, done: p.daily.at(-1)!.done + 1 }] : [...p.daily, { day: today, done: 1 }].slice(-60)
  save({ ...p, cards, daily })
}

export function dueCards(now = Date.now()) {
  const p = loadProgress()
  return Object.entries(p.cards).filter(([, c]) => c.due <= now && c.box < 5).map(([id]) => id)
}

export function streak(): number {
  const days = new Set(loadProgress().daily.map(d => d.day))
  let n = 0
  for (let t = Date.now(); days.has(new Date(t).toISOString().slice(0, 10)); t -= DAY) n++
  return n
}

export interface WeaknessEntry {
  lesson: string
  title: string
  weight: number
  games: number
}

/** Weakness profile across reviewed games: recent games weigh more. */
export function weaknessProfile(): WeaknessEntry[] {
  const p = loadProgress()
  const total = new Map<string, { weight: number; games: number }>()
  p.games.forEach((g, i) => {
    const recency = Math.pow(0.93, i)
    for (const [lesson, w] of Object.entries(g.weaknesses)) {
      const e = total.get(lesson) ?? { weight: 0, games: 0 }
      e.weight += w * recency
      e.games += 1
      total.set(lesson, e)
    }
  })
  return [...total.entries()]
    .map(([lesson, e]) => ({ lesson, title: LESSONS.find(l => l.id === lesson)?.title ?? lesson, weight: e.weight, games: e.games }))
    .sort((a, b) => b.weight - a.weight)
}

export function resetProgress() {
  save(empty())
}

export function exportProgress(): string {
  return JSON.stringify(loadProgress())
}

export function importProgress(json: string) {
  const data = JSON.parse(json)
  if (data?.version !== 1) throw new Error('Not a Game Review progress file.')
  save({ ...empty(), ...data })
}

/** Rating to pitch exercises at: the player's real rating when known, otherwise recent game ratings (bounded). */
export function trainingRating(): number {
  const g = loadProgress().games.slice(0, 10)
  const elos = g.map(x => x.elo).filter((x): x is number => !!x)
  if (elos.length) return Math.round(elos.reduce((a, b) => a + b, 0) / elos.length)
  if (g.length) return Math.round(Math.max(600, Math.min(2200, g.reduce((a, x) => a + x.rating, 0) / g.length)))
  return 1200
}
