import { LESSONS, localizedLesson, type LessonCategory } from '../content/lessons'
import { weaknessProfile } from '../lib/progress'
import { tr, useLang } from '../i18n'

const CATEGORY: Record<LessonCategory, { en: string; el: string }> = {
  habits: { en: 'Habits', el: 'Συνήθειες' },
  tactics: { en: 'Tactics', el: 'Τακτική' },
  strategy: { en: 'Strategy', el: 'Στρατηγική' },
  structures: { en: 'Pawn structures', el: 'Δομές πιονιών' },
  endgames: { en: 'Endgames', el: 'Φινάλε' },
}

export function LessonsView({ selected, onSelect, onPractice }: { selected?: string; onSelect: (id?: string) => void; onPractice: (id: string) => void }) {
  const lang = useLang()
  const weights = new Map(weaknessProfile().map(w => [w.lesson, w]))
  const lesson = selected ? localizedLesson(selected, lang) : undefined

  if (lesson) {
    const w = weights.get(lesson.id)
    return (
      <main className="page lesson">
        <button className="link" onClick={() => onSelect(undefined)}>{tr({ en: '← All lessons', el: '← Όλα τα μαθήματα' }, lang)}</button>
        <span className="pill">{tr(CATEGORY[lesson.category], lang)}</span>
        <h2>{lesson.title}</h2>
        <p className="lead">{lesson.summary}</p>
        {w && <p className="callout">{tr({
          en: `This theme came up in ${w.games} of your reviewed games.`,
          el: w.games === 1 ? 'Αυτό το θέμα εμφανίστηκε σε 1 από τις παρτίδες που ανέλυσες.' : `Αυτό το θέμα εμφανίστηκε σε ${w.games} από τις παρτίδες που ανέλυσες.`,
        }, lang)}</p>}
        <h3>{tr({ en: 'Key ideas', el: 'Βασικές ιδέες' }, lang)}</h3>
        <ul>{lesson.ideas.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h3>{tr({ en: 'How to spot it', el: 'Πώς το αναγνωρίζεις' }, lang)}</h3>
        <ul>{lesson.spot.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h3>{tr({ en: 'Typical mistakes', el: 'Συνηθισμένα λάθη' }, lang)}</h3>
        <ul>{lesson.mistakes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <button className="primary" onClick={() => onPractice(lesson.id)}>{tr({ en: 'Practise this →', el: 'Κάνε εξάσκηση →' }, lang)}</button>
      </main>
    )
  }

  return (
    <main className="page">
      <h2>{tr({ en: 'Lessons', el: 'Μαθήματα' }, lang)}</h2>
      <p className="muted">{tr({
        en: "Short coach's notes on the ideas that decide club games. Each one comes with exercises; the ones marked ● came up in your own games.",
        el: 'Σύντομες σημειώσεις προπονητή για τις ιδέες που κρίνουν τις παρτίδες σε επίπεδο συλλόγου. Κάθε μάθημα συνοδεύεται από ασκήσεις· όσα έχουν την ένδειξη ● εμφανίστηκαν στις δικές σου παρτίδες.',
      }, lang)}</p>
      {(Object.keys(CATEGORY) as LessonCategory[]).map(cat => (
        <section key={cat}>
          <h3>{tr(CATEGORY[cat], lang)}</h3>
          <div className="lesson-grid">
            {LESSONS.filter(l => l.category === cat).map(base => localizedLesson(base.id, lang) ?? base).map(l => (
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
