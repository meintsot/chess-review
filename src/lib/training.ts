// Turns reviews into training: weakness profile entries, exercises from the player's own games, and a
// daily session mixing spaced repetition, own-game positions, tactical puzzles and strategic exercises.
import { coachGame, coachMove, phaseOf } from './coach'
import { LESSONS, lessonById } from '../content/lessons'
import { classifyStructure } from './structures'
import type { GameReview } from './review'
import { dueCards, loadProgress, trainingRating, type GameSummary, type OwnExercise } from './progress'

// ------------------------------------------------------------ from a review

export function gameId(review: GameReview) {
  const s = review.white + review.black + review.moves.map(m => m.uci).join('')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return `g${(h >>> 0).toString(36)}`
}

/** Which side the player was, from the saved player name (case-insensitive substring match). */
export function playerSide(review: GameReview, name?: string): 'w' | 'b' | undefined {
  if (!name) return undefined
  const n = name.toLowerCase()
  if (review.white.toLowerCase().includes(n)) return 'w'
  if (review.black.toLowerCase().includes(n)) return 'b'
  return undefined
}

export function summarize(review: GameReview, color: 'w' | 'b'): GameSummary {
  const report = coachGame(review, color)
  const mine = review.moves.filter(m => m.color === color)
  const counts: Record<string, number> = {}
  const weaknesses: Record<string, number> = {}
  let inBook = true
  const phaseLoss = { opening: 0, middlegame: 0, endgame: 0 }
  for (const m of review.moves) {
    inBook = inBook && m.cls === 'book'
    if (m.color !== color) continue
    counts[m.cls] = (counts[m.cls] ?? 0) + 1
    phaseLoss[phaseOf(m.fenBefore, m.ply, inBook)] += m.loss
    if (['inaccuracy', 'mistake', 'miss', 'blunder'].includes(m.cls)) {
      for (const l of coachMove(review, m.ply - 1).lessons) weaknesses[l] = (weaknesses[l] ?? 0) + m.loss
    }
  }
  if (phaseLoss.endgame > 0.25) {
    const rooks = mine.some(m => /r/i.test(m.fenBefore.split(' ')[0]) && !/[qbn]/i.test(m.fenBefore.split(' ')[0]))
    weaknesses[rooks ? 'rook-endings' : 'king-activity'] = (weaknesses[rooks ? 'rook-endings' : 'king-activity'] ?? 0) + phaseLoss.endgame / 2
  }
  return {
    id: gameId(review),
    date: Date.now(),
    white: review.white,
    black: review.black,
    color,
    result: review.result,
    accuracy: color === 'w' ? review.accuracy.w : review.accuracy.b,
    rating: color === 'w' ? review.gameRating.w : review.gameRating.b,
    elo: Number(color === 'w' ? review.whiteElo : review.blackElo) || undefined,
    opening: review.opening,
    structures: report.structures.map(s => s.id),
    phaseLoss,
    counts,
    weaknesses,
  }
}

/** Positions where the player went wrong (or missed a chance) become exercises: find the engine's move. */
export function ownExercises(review: GameReview, color: 'w' | 'b'): OwnExercise[] {
  const id = gameId(review)
  return review.moves
    .filter(m => m.color === color && ['mistake', 'miss', 'blunder'].includes(m.cls) && m.bestUci)
    .slice(0, 6)
    .map(m => {
      const note = coachMove(review, m.ply - 1)
      const text = [note.tactical[0], note.strategic[0]].filter(Boolean).join(' ')
      return {
        id: `${id}-${m.ply}`,
        fen: m.fenBefore,
        answers: [[m.bestUci!, 10]],
        lesson: note.lessons[0],
        note: `In your game you played ${m.san}. ${text}`.trim(),
        game: id,
        ply: m.ply,
      }
    })
}

// ----------------------------------------------------------------- exercises

export type Exercise =
  | { kind: 'puzzle'; id: string; fen: string; moves: string[]; rating: number; themes: string[]; lesson?: string; title: string }
  | { kind: 'choice'; id: string; fen: string; answers: [string, number][]; rating: number; lesson?: string; title: string; note?: string; engineCheck?: boolean }

type PuzzleRow = [string, string, string, number, string]
interface StrategicRow { id: string; theme?: string; structure?: string; fen: string; answers: [string, number][]; difficulty: number | null; structures?: string[] }

const cache = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, fetch(path).then(r => (r.ok ? r.json() : [])).catch(() => []))
  return cache.get(path) as Promise<T>
}

export const loadPuzzles = (theme: string) => load<PuzzleRow[]>(`/data/puzzles/${theme}.json`)
export const loadSts = () => load<StrategicRow[]>('/data/strategy/sts.json')
export const loadStructureExercises = () => load<StrategicRow[]>('/data/strategy/structures.json')

function shuffle<T>(xs: T[], seed = Date.now()): T[] {
  const a = [...xs]
  let s = seed % 2147483647 || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const near = (rating: number | null, target: number, width: number) => Math.abs((rating ?? 1500) - target) <= width

/** Strategic rows: Maia difficulty is coarse (mostly "easy" or "hard"), so mix ~70% within reach and ~30% stretch. */
function pickStrategic(rows: StrategicRow[], rating: number, count: number): StrategicRow[] {
  const reach = rows.filter(r => (r.difficulty ?? 1500) <= rating + 300)
  const stretch = rows.filter(r => (r.difficulty ?? 1500) > rating + 300)
  const a = Math.ceil(count * 0.7)
  return shuffle([...shuffle(reach).slice(0, a), ...shuffle(stretch).slice(0, count - Math.min(a, reach.length))]).slice(0, count)
}

function puzzleExercise(row: PuzzleRow, lesson?: string): Exercise {
  const [id, fen, moves, rating, themes] = row
  return { kind: 'puzzle', id: `p:${id}`, fen, moves: moves.split(' '), rating, themes: themes.split(' '), lesson, title: lessonById(lesson ?? '')?.title ?? 'Tactics' }
}

function strategicExercise(row: StrategicRow, lesson: string | undefined, source: 'sts' | 'st'): Exercise {
  return { kind: 'choice', id: `${source}:${row.id}`, fen: row.fen, answers: row.answers, rating: row.difficulty ?? 0, lesson, title: lessonById(lesson ?? '')?.title ?? 'Strategy' }
}

/** Exercises that drill one lesson, near the target rating. */
export async function exercisesFor(lessonId: string, rating: number, count: number): Promise<Exercise[]> {
  const lesson = lessonById(lessonId)
  if (!lesson) return []
  const out: Exercise[] = []
  for (const theme of lesson.puzzleThemes ?? []) {
    const rows = await loadPuzzles(theme)
    const fit = rows.filter(r => near(r[3], rating, 250))
    out.push(...shuffle(fit.length >= 3 ? fit : rows).slice(0, count).map(r => puzzleExercise(r, lessonId)))
  }
  if (lesson.stsThemes?.length) {
    const rows = (await loadSts()).filter(r => r.theme && lesson.stsThemes!.includes(r.theme))
    out.push(...pickStrategic(rows, rating, count).map(r => strategicExercise(r, lessonId, 'sts')))
  }
  if (lesson.structures?.length) {
    const rows = (await loadStructureExercises()).filter(r => (r.structure && lesson.structures!.includes(r.structure)) || r.structures?.some(s => lesson.structures!.includes(s)))
    out.push(...pickStrategic(rows, rating, count).map(r => strategicExercise(r, lessonId, 'st')))
  }
  return shuffle(out).slice(0, count)
}

function ownToExercise(e: OwnExercise): Exercise {
  return { kind: 'choice', id: `own:${e.id}`, fen: e.fen, answers: e.answers, rating: 0, lesson: e.lesson, title: 'From your game', note: e.note, engineCheck: true }
}

/** The positions where the player went wrong in one reviewed game. */
export function gameExercises(game: string): Exercise[] {
  return loadProgress().own.filter(o => o.game === game).map(ownToExercise)
}

async function exerciseById(id: string): Promise<Exercise | undefined> {
  const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
  if (kind === 'own') {
    const e = loadProgress().own.find(o => o.id === rest)
    return e && ownToExercise(e)
  }
  if (kind === 'sts' || kind === 'st') {
    const rows = kind === 'sts' ? await loadSts() : await loadStructureExercises()
    const r = rows.find(x => x.id === rest)
    return r && strategicExercise(r, undefined, kind)
  }
  return undefined // puzzle cards are re-found through their lesson themes; see dailySession
}

/** Today's training: ~12 exercises focused on the player's weaknesses. */
export async function dailySession(): Promise<{ items: Exercise[]; focus: string[] }> {
  const p = loadProgress()
  const rating = trainingRating()
  const profile = Object.entries(
    p.games.slice(0, 20).reduce<Record<string, number>>((acc, g, i) => {
      for (const [l, w] of Object.entries(g.weaknesses)) acc[l] = (acc[l] ?? 0) + w * Math.pow(0.93, i)
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])
  const focus = profile.length ? profile.slice(0, 3).map(([l]) => l) : ['loose-pieces', 'forks', 'outposts']

  const items: Exercise[] = []
  // 1. Spaced repetition of missed exercises
  for (const id of dueCards().slice(0, 3)) {
    const e = await exerciseById(id)
    if (e) items.push(e)
  }
  // 2. Positions from the player's own games not yet mastered
  const own = p.own.filter(o => (p.cards[`own:${o.id}`]?.box ?? 0) < 3)
  items.push(...shuffle(own).slice(0, 3).map(ownToExercise))
  // 3. Lesson drills for the top weaknesses
  const per = Math.max(2, Math.ceil((12 - items.length) / focus.length))
  for (const lesson of focus) items.push(...(await exercisesFor(lesson, rating, per)))
  // de-duplicate, keep order
  const seen = new Set<string>()
  return { items: items.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, 14), focus }
}

export const allLessons = LESSONS

/** Structures present in a position, for the exercise view. */
export function structuresIn(fen: string) {
  try {
    return classifyStructure(fen)
  } catch {
    return []
  }
}
