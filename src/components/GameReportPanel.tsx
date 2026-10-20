import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { coachGame } from '../lib/coach'
import { lessonTitle } from '../content/lessons'
import { addGame, hasGame, loadProgress, subscribe } from '../lib/progress'
import { gameId, ownExercises, summarize } from '../lib/training'
import { askAiCoach, getApiKey } from '../lib/aiCoach'
import type { GameReview } from '../lib/review'
import { tr, useLang } from '../i18n'

const PHASE_NAME: Record<string, { en: string; el: string }> = {
  opening: { en: 'Opening', el: 'Άνοιγμα' },
  middlegame: { en: 'Middlegame', el: 'Μέσο παιχνίδι' },
  endgame: { en: 'Endgame', el: 'Φινάλε' },
}

/** Tiny, safe Markdown renderer for the AI coach (headings, bullets, bold). */
function Markdown({ text }: { text: string }) {
  const bold = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>)
    bullets = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^[-*] /.test(t)) { bullets.push(t.slice(2)); continue }
    flush()
    if (!t) continue
    if (t.startsWith('#')) blocks.push(<h4 key={blocks.length}>{t.replace(/^#+\s*/, '')}</h4>)
    else blocks.push(<p key={blocks.length}>{bold(t)}</p>)
  }
  flush()
  return <div className="markdown">{blocks}</div>
}

export function GameReportPanel({ review, player, onGo, onLesson, onPractice }: {
  review: GameReview
  player?: 'w' | 'b'
  onGo: (ply: number) => void
  onLesson: (id: string) => void
  onPractice: (id?: string) => void
}) {
  const lang = useLang()
  const [side, setSide] = useState<'w' | 'b' | undefined>(player)
  const report = useMemo(() => (side ? coachGame(review, side, lang) : null), [review, side, lang])
  const saved = useSyncExternalStore(subscribe, () => hasGame(gameId(review)))
  const [ai, setAi] = useState<{ text: string; busy: boolean; error?: string } | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    if (!side || saved) return
    addGame(summarize(review, side), ownExercises(review, side))
  }, [side, saved, review])

  if (!side || !report) {
    return (
      <div className="report">
        <p>{tr({
          en: 'Which side did you play? The coach report and your training plan are written from your point of view.',
          el: 'Με ποιο χρώμα έπαιξες; Η αναφορά του προπονητή και το πλάνο εξάσκησής σου γράφονται από τη δική σου οπτική.',
        }, lang)}</p>
        <div className="row">
          <button className="pill" onClick={() => setSide('w')}>{tr({ en: 'White', el: 'Λευκά' }, lang)} · {review.white}</button>
          <button className="pill" onClick={() => setSide('b')}>{tr({ en: 'Black', el: 'Μαύρα' }, lang)} · {review.black}</button>
        </div>
      </div>
    )
  }

  const own = loadProgress().own.filter(o => o.game === gameId(review)).length

  return (
    <div className="report">
      <p className="lead">{report.overview}</p>

      <h3>{tr({ en: 'Phases', el: 'Φάσεις' }, lang)}</h3>
      {report.phases.map(p => (
        <div key={p.phase} className="phase">
          <div className="phase-head">
            <strong>{PHASE_NAME[p.phase] ? tr(PHASE_NAME[p.phase], lang) : p.phase}</strong>
            {p.moves > 0 && <span className="muted small">{p.accuracy.toFixed(0)}% · {p.moves} {tr({ en: 'moves', el: p.moves === 1 ? 'κίνηση' : 'κινήσεις' }, lang)}</span>}
          </div>
          {p.moves > 0 && <div className="bar"><div style={{ width: `${p.accuracy}%` }} /></div>}
          <p className="small">{p.text}</p>
        </div>
      ))}

      {report.structures.length > 0 && (
        <>
          <h3>{tr({ en: 'Pawn structure', el: 'Δομή πιονιών' }, lang)}</h3>
          {report.structures.map(s => (
            <div key={s.id} className="structure">
              <p><strong>{s.name}</strong> <span className="muted small">({tr({ en: 'from move', el: 'από την κίνηση' }, lang)} {Math.ceil(s.fromPly / 2)})</span></p>
              <p className="small">{s.plan}</p>
              {s.lesson && <button className="chip" onClick={() => onLesson(s.lesson!)}>{tr({ en: 'Lesson', el: 'Μάθημα' }, lang)}: {lessonTitle(s.lesson, lang)}</button>}
            </div>
          ))}
        </>
      )}

      {report.moments.length > 0 && (
        <>
          <h3>{tr({ en: 'Key moments', el: 'Κρίσιμες στιγμές' }, lang)}</h3>
          {report.moments.map(m => (
            <button key={m.ply} className="moment-row" onClick={() => onGo(m.ply)}>{m.text}</button>
          ))}
        </>
      )}

      {report.strengths.length > 0 && (
        <>
          <h3>{tr({ en: 'What went well', el: 'Τι πήγε καλά' }, lang)}</h3>
          <ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {report.improve.length > 0 && (
        <>
          <h3>{tr({ en: 'Work on', el: 'Τι να δουλέψεις' }, lang)}</h3>
          {report.improve.map(i => (
            <div key={i.lesson} className="improve">
              <button className="link" onClick={() => onLesson(i.lesson)}>{lessonTitle(i.lesson, lang)}</button>
              <span className="muted small"> — {i.why}</span>
              <button className="pill" onClick={() => onPractice(i.lesson)}>{tr({ en: 'Practise', el: 'Εξάσκηση' }, lang)}</button>
            </div>
          ))}
        </>
      )}

      <div className="row">
        {own > 0 && <button className="primary" onClick={() => onPractice(`game-${gameId(review)}`)}>{tr({
          en: `Train on this game (${own} positions)`,
          el: `Εξάσκηση σε αυτή την παρτίδα (${own} ${own === 1 ? 'θέση' : 'θέσεις'})`,
        }, lang)}</button>}
        <span className="muted small">{saved ? tr({ en: 'Saved to your training profile.', el: 'Αποθηκεύτηκε στο προφίλ εξάσκησής σου.' }, lang) : ''}</span>
      </div>

      <h3>{tr({ en: 'AI coach', el: 'AI προπονητής' }, lang)}</h3>
      {!getApiKey() ? (
        <p className="muted small">{tr({
          en: 'Optional: add your Anthropic API key in Profile to get a written review from Claude, based only on the verified analysis above.',
          el: 'Προαιρετικά: πρόσθεσε το κλειδί σου Anthropic API στο Προφίλ για να πάρεις γραπτό σχολιασμό από το Claude, βασισμένο μόνο στην επαληθευμένη ανάλυση παραπάνω.',
        }, lang)}</p>
      ) : ai ? (
        <div className="ai">
          {ai.error ? <p className="error">{ai.error}</p> : <Markdown text={ai.text || tr({ en: 'Thinking…', el: 'Σκέφτεται…' }, lang)} />}
          {ai.busy && <button className="link" onClick={() => abort.current?.abort()}>{tr({ en: 'Stop', el: 'Διακοπή' }, lang)}</button>}
        </div>
      ) : (
        <button className="pill" onClick={() => {
          abort.current = new AbortController()
          setAi({ text: '', busy: true })
          askAiCoach(review, side, text => setAi({ text, busy: true }), lang === 'el' ? 'Greek' : 'English', abort.current.signal)
            .then(text => setAi({ text, busy: false }))
            .catch(e => setAi(a => ({ text: a?.text ?? '', busy: false, error: (e as Error).name === 'AbortError' ? undefined : (e as Error).message })))
        }}>{tr({ en: 'Ask the AI coach', el: 'Ρώτα τον AI προπονητή' }, lang)}</button>
      )}
    </div>
  )
}
