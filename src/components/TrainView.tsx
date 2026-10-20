import { useEffect, useState } from 'react'
import { ExercisePlayer } from './ExercisePlayer'
import { releaseExerciseEngine } from '../lib/exerciseEngine'
import { dailySession, exercisesFor, gameExercises, type Exercise } from '../lib/training'
import { lessonById } from '../content/lessons'
import { streak, trainingRating } from '../lib/progress'

export function TrainView({ lesson, onLesson }: { lesson?: string; onLesson: (id: string) => void }) {
  const [items, setItems] = useState<Exercise[] | null>(null)
  const [focus, setFocus] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // App remounts this view per lesson (key), so state starts fresh here.
    let alive = true
    const rating = trainingRating()
    const load = lesson?.startsWith('game-')
      ? Promise.resolve({ items: gameExercises(lesson.slice(5)), focus: [] as string[] })
      : lesson
        ? exercisesFor(lesson, rating, 10).then(items => ({ items, focus: [lesson] }))
        : dailySession()
    load
      .then(s => alive && (setItems(s.items), setFocus(s.focus)))
      .catch(e => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [lesson])

  useEffect(() => () => releaseExerciseEngine(), [])

  if (error) return <main className="page"><p className="error">{error}</p></main>
  if (!items) return <main className="page"><p className="muted">Preparing your training…</p></main>
  if (!items.length) {
    return (
      <main className="page">
        <h2>Training</h2>
        <p className="muted">No exercises available for this topic yet.</p>
      </main>
    )
  }

  if (index >= items.length) {
    const solved = results.filter(Boolean).length
    return (
      <main className="page">
        <h2>Session complete</h2>
        <p className="big">{solved} / {results.length} solved</p>
        <p className="muted">Day streak: {streak()} 🔥 — missed exercises come back for review in the next sessions.</p>
        <div className="row">
          <button className="primary" onClick={() => { setIndex(0); setResults([]); setItems(null); dailySession().then(s => { setItems(s.items); setFocus(s.focus) }) }}>Another session</button>
          {focus.map(f => <button key={f} className="pill" onClick={() => onLesson(f)}>Read: {lessonById(f)?.title ?? f}</button>)}
        </div>
      </main>
    )
  }

  return (
    <main className="page train">
      <div className="train-head">
        <h2>{lesson?.startsWith('game-') ? 'Your mistakes from this game' : lesson ? `Practice: ${lessonById(lesson)?.title ?? lesson}` : "Today's training"}</h2>
        <span className="muted">{index + 1} / {items.length}</span>
      </div>
      {!lesson && focus.length > 0 && (
        <p className="muted small">Focus from your games: {focus.map(f => lessonById(f)?.title ?? f).join(' · ')}</p>
      )}
      <div className="bar"><div style={{ width: `${(index / items.length) * 100}%` }} /></div>
      <ExercisePlayer
        key={items[index].id}
        exercise={items[index]}
        onNext={ok => { setResults(r => [...r, ok]); setIndex(i => i + 1) }}
      />
    </main>
  )
}
