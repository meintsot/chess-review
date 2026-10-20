import { useEffect, useState } from 'react'
import { ExercisePlayer } from './ExercisePlayer'
import { releaseExerciseEngine } from '../lib/exerciseEngine'
import { dailySession, exercisesFor, gameExercises, type Exercise } from '../lib/training'
import { lessonTitle } from '../content/lessons'
import { streak, trainingRating } from '../lib/progress'
import { tr, useLang } from '../i18n'

export function TrainView({ lesson, onLesson }: { lesson?: string; onLesson: (id: string) => void }) {
  const lang = useLang()
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
  if (!items) return <main className="page"><p className="muted">{tr({ en: 'Preparing your training…', el: 'Ετοιμάζω την εξάσκησή σου…' }, lang)}</p></main>
  if (!items.length) {
    return (
      <main className="page">
        <h2>{tr({ en: 'Training', el: 'Εξάσκηση' }, lang)}</h2>
        <p className="muted">{tr({ en: 'No exercises available for this topic yet.', el: 'Δεν υπάρχουν ακόμη ασκήσεις για αυτό το θέμα.' }, lang)}</p>
      </main>
    )
  }

  if (index >= items.length) {
    const solved = results.filter(Boolean).length
    return (
      <main className="page">
        <h2>{tr({ en: 'Session complete', el: 'Η συνεδρία ολοκληρώθηκε' }, lang)}</h2>
        <p className="big">{tr({ en: `${solved} / ${results.length} solved`, el: `Έλυσες ${solved} / ${results.length}` }, lang)}</p>
        <p className="muted">{tr({
          en: `Day streak: ${streak()} 🔥 — missed exercises come back for review in the next sessions.`,
          el: `Σερί ημερών: ${streak()} 🔥 — όσες ασκήσεις δεν έλυσες θα ξαναεμφανιστούν για επανάληψη στις επόμενες συνεδρίες.`,
        }, lang)}</p>
        <div className="row">
          <button className="primary" onClick={() => { setIndex(0); setResults([]); setItems(null); dailySession().then(s => { setItems(s.items); setFocus(s.focus) }) }}>{tr({ en: 'Another session', el: 'Νέα συνεδρία' }, lang)}</button>
          {focus.map(f => <button key={f} className="pill" onClick={() => onLesson(f)}>{tr({ en: 'Read', el: 'Διάβασε' }, lang)}: {lessonTitle(f, lang)}</button>)}
        </div>
      </main>
    )
  }

  return (
    <main className="page train">
      <div className="train-head">
        <h2>{lesson?.startsWith('game-')
          ? tr({ en: 'Your mistakes from this game', el: 'Τα λάθη σου από αυτή την παρτίδα' }, lang)
          : lesson
            ? `${tr({ en: 'Practice', el: 'Εξάσκηση' }, lang)}: ${lessonTitle(lesson, lang)}`
            : tr({ en: "Today's training", el: 'Η σημερινή σου εξάσκηση' }, lang)}</h2>
        <span className="muted">{index + 1} / {items.length}</span>
      </div>
      {!lesson && focus.length > 0 && (
        <p className="muted small">{tr({ en: 'Focus from your games', el: 'Έμφαση από τις παρτίδες σου' }, lang)}: {focus.map(f => lessonTitle(f, lang)).join(' · ')}</p>
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
