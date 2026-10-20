import { LESSONS, type LessonCategory } from '../content/lessons'
import { weaknessProfile } from '../lib/progress'

const CATEGORY: Record<LessonCategory, string> = {
  habits: 'Habits',
  tactics: 'Tactics',
  strategy: 'Strategy',
  structures: 'Pawn structures',
  endgames: 'Endgames',
}

export function LessonsView({ selected, onSelect, onPractice }: { selected?: string; onSelect: (id?: string) => void; onPractice: (id: string) => void }) {
  const weights = new Map(weaknessProfile().map(w => [w.lesson, w]))
  const lesson = LESSONS.find(l => l.id === selected)

  if (lesson) {
    const w = weights.get(lesson.id)
    return (
      <main className="page lesson">
        <button className="link" onClick={() => onSelect(undefined)}>← All lessons</button>
        <span className="pill">{CATEGORY[lesson.category]}</span>
        <h2>{lesson.title}</h2>
        <p className="lead">{lesson.summary}</p>
        {w && <p className="callout">This theme came up in {w.games} of your reviewed games.</p>}
        <h3>Key ideas</h3>
        <ul>{lesson.ideas.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h3>How to spot it</h3>
        <ul>{lesson.spot.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h3>Typical mistakes</h3>
        <ul>{lesson.mistakes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <button className="primary" onClick={() => onPractice(lesson.id)}>Practise this →</button>
      </main>
    )
  }

  return (
    <main className="page">
      <h2>Lessons</h2>
      <p className="muted">Short coach's notes on the ideas that decide club games. Each one comes with exercises; the ones marked ● came up in your own games.</p>
      {(Object.keys(CATEGORY) as LessonCategory[]).map(cat => (
        <section key={cat}>
          <h3>{CATEGORY[cat]}</h3>
          <div className="lesson-grid">
            {LESSONS.filter(l => l.category === cat).map(l => (
              <button key={l.id} className="lesson-card" onClick={() => onSelect(l.id)}>
                <strong>{weights.has(l.id) && <span className="hot">● </span>}{l.title}</strong>
                <span className="muted small">{l.summary.split('. ')[0]}.</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
