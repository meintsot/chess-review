import { beforeEach, describe, expect, it } from 'vitest'
import games from './fixtures/games.json'
import { buildReview, type GameReview } from '../review'
import type { EngineResult } from '../engine'
import { coachGame, coachMove } from '../coach'
import { ownExercises, summarize, gameId, playerSide } from '../training'
import { addGame, loadProgress, recordAttempt, resetProgress, weaknessProfile, dueCards } from '../progress'
import { LESSONS } from '../../content/lessons'

type Fixture = { pgn: string; pos: { lines?: { pv0: string; cp?: number; mate?: number }[] }[] }

function review(f: Fixture): GameReview {
  const results = f.pos.map(p =>
    p.lines ? ({ depth: 18, lines: p.lines.map(l => ({ score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 }, pv: [l.pv0] })) } as EngineResult) : (undefined as unknown as EngineResult),
  )
  return buildReview(f.pgn, results, {}, 18)
}

// localStorage shim for node
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: k => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
}

describe('coach', () => {
  const reviews = (games as Fixture[]).map(review)

  it('writes a note for every move without throwing', () => {
    for (const r of reviews) {
      r.moves.forEach((m, i) => {
        const note = coachMove(r, i, 'en')
        expect(note.headline.length).toBeGreaterThan(3)
        if (['mistake', 'blunder', 'miss'].includes(m.cls)) expect(note.tactical.length + note.strategic.length + (note.advice ? 1 : 0)).toBeGreaterThan(0)
        for (const l of note.lessons) expect(LESSONS.some(x => x.id === l)).toBe(true)
      })
    }
  })

  it('speaks to the player: no raw colour names, no control characters, opponent moments retold', () => {
    for (const r of reviews) {
      r.moves.forEach((m, i) => {
        const note = coachMove(r, i, 'en')
        for (const t of [...note.tactical, ...note.strategic]) {
          expect([...t].some(ch => ch.charCodeAt(0) < 9)).toBe(false)
          expect(t).not.toMatch(m.color === 'w' ? /\bWhite's\b/ : /\bBlack's\b/)
        }
      })
      const rep = coachGame(r, 'w', 'en')
      for (const mo of rep.moments) {
        if (!mo.text.includes('(You)')) expect(mo.text).not.toMatch(/your opponent has/)
      }
    }
  })

  it('builds a game report from the player\'s side', () => {
    for (const r of reviews) {
      for (const side of ['w', 'b'] as const) {
        const rep = coachGame(r, side, 'en')
        expect(rep.overview).toMatch(/accuracy/)
        expect(rep.phases.length).toBeGreaterThan(0)
        for (const i of rep.improve) expect(LESSONS.some(l => l.id === i.lesson)).toBe(true)
        for (const m of rep.moments) expect(m.ply).toBeGreaterThan(0)
      }
    }
  })

  it('speaks Greek: same facts, no English words, valid squares and grammar', () => {
    const ENGLISH = /\b(the|and|your|opponent|pawn|knight|bishop|rook|queen|king|move|file|rank|wins|after|was|with|it)\b/i
    for (const r of reviews) {
      r.moves.forEach((_, i) => {
        const en = coachMove(r, i, 'en')
        const el = coachMove(r, i, 'el')
        // the language changes the words, never the analysis
        expect(el.lessons).toEqual(en.lessons)
        expect(el.motifs).toEqual(en.motifs)
        expect(el.tactical.length).toBe(en.tactical.length)
        expect(el.strategic.length).toBe(en.strategic.length)
        for (const t of [el.headline, ...el.tactical, ...el.strategic, el.advice ?? '']) {
          expect(t).not.toMatch(ENGLISH)
          expect(t).not.toMatch(/undefined|NaN|\s{2,}| σε (το|τον|τη|την) |(^|\s)(σ?την) [μλρσ]/)
          for (const sq of t.match(/στο ([a-z]\d+)/g) ?? []) expect(sq).toMatch(/^στο [a-h][1-8]$/)
        }
      })
      for (const side of ['w', 'b'] as const) {
        const rep = coachGame(r, side, 'el')
        expect(rep.overview).toMatch(/ακρίβεια/)
        expect(rep.improve.map(x => x.lesson)).toEqual(coachGame(r, side, 'en').improve.map(x => x.lesson))
        for (const t of [...rep.phases.map(p => p.text), ...rep.strengths]) expect(t).not.toMatch(ENGLISH)
        // the opponent's moments are retold to the player, never as "ο αντίπαλος έχει"
        for (const mo of rep.moments) if (!mo.text.includes('(Εσύ)')) expect(mo.text).not.toMatch(/ο αντίπαλος έχει|Είχες κερδιστικό/)
      }
    }
  })
})

describe('training', () => {
  beforeEach(() => resetProgress())
  const r = review((games as Fixture[])[0])

  it('summarises a game and extracts own-game exercises', () => {
    const s = summarize(r, 'w')
    expect(s.id).toBe(gameId(r))
    expect(s.accuracy).toBeGreaterThan(0)
    const ex = ownExercises(r, 'w')
    for (const e of ex) {
      expect(e.answers[0][1]).toBe(10)
      expect(e.fen.split(' ')[1]).toBe('w')
    }
    addGame(s, ex)
    expect(loadProgress().games).toHaveLength(1)
    expect(weaknessProfile().every(w => w.weight >= 0)).toBe(true)
  })

  it('finds the player side by name', () => {
    expect(playerSide(r, r.white.slice(0, 4))).toBe('w')
    expect(playerSide(r, r.black.slice(0, 4))).toBe('b')
    expect(playerSide(r, 'nobody-xyz')).toBeUndefined()
  })

  it('schedules failed exercises again and promotes solved ones', () => {
    recordAttempt('sts:x', false)
    recordAttempt('sts:y', true)
    const p = loadProgress()
    expect(p.cards['sts:x'].box).toBe(0)
    expect(p.cards['sts:y'].box).toBe(1)
    expect(dueCards(Date.now() + 11 * 60_000)).toContain('sts:x')
    expect(dueCards(Date.now() + 11 * 60_000)).not.toContain('sts:y')
  })
})
