import { useState, useSyncExternalStore } from 'react'
import { exportProgress, importProgress, loadProgress, resetProgress, setPlayer, streak, subscribe, weaknessProfile } from '../lib/progress'
import { getApiKey, setApiKey } from '../lib/aiCoach'
import { lessonTitle } from '../content/lessons'
import { tr, useLang } from '../i18n'

type Msg = string | { en: string; el: string }

export function ProfileView({ onPractice, onLesson }: { onPractice: (id: string) => void; onLesson: (id: string) => void }) {
  const lang = useLang()
  const p = useSyncExternalStore(subscribe, loadProgress)
  const [name, setName] = useState(p.player?.name ?? '')
  const [key, setKey] = useState(getApiKey())
  const [msg, setMsg] = useState<Msg | null>(null)
  const weak = weaknessProfile().slice(0, 8)
  const max = Math.max(0.0001, ...weak.map(w => w.weight))
  const cards = Object.values(p.cards)
  const solved = cards.reduce((a, c) => a + c.correct, 0)
  const tried = cards.reduce((a, c) => a + c.seen, 0)
  const recent = p.games.slice(0, 10)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const days = streak()
  const saveLabel = tr({ en: 'Save', el: 'Αποθήκευση' }, lang)
  const showMsg = (m: Msg) => {
    if (typeof m !== 'string') return tr(m, lang)
    return lang === 'el' && m === 'Not a Game Review progress file.' ? 'Δεν είναι αρχείο προόδου του Game Review.' : m
  }

  return (
    <main className="page">
      <h2>{tr({ en: 'Your profile', el: 'Το προφίλ σου' }, lang)}</h2>
      <div className="stats">
        <div><span className="big">{p.games.length}</span><span className="muted small">{tr({ en: 'games reviewed', el: p.games.length === 1 ? 'αναλυμένη παρτίδα' : 'αναλυμένες παρτίδες' }, lang)}</span></div>
        <div><span className="big">{recent.length ? avg(recent.map(g => g.accuracy)).toFixed(1) : '–'}</span><span className="muted small">{tr({ en: 'avg accuracy (last 10)', el: 'μέση ακρίβεια (τελευταίες 10)' }, lang)}</span></div>
        <div><span className="big">{solved}/{tried}</span><span className="muted small">{tr({ en: 'exercises solved', el: 'λυμένες ασκήσεις' }, lang)}</span></div>
        <div><span className="big">{days}</span><span className="muted small">{tr({ en: 'day streak', el: days === 1 ? 'ημέρα στη σειρά' : 'ημέρες στη σειρά' }, lang)}</span></div>
      </div>

      <section>
        <h3>{tr({ en: 'What to work on', el: 'Τι να δουλέψεις' }, lang)}</h3>
        {weak.length === 0 ? (
          <p className="muted">{tr({
            en: 'Review a few of your games (with your username set below) and your weaknesses will show up here.',
            el: 'Ανάλυσε μερικές παρτίδες σου (αφού ορίσεις το όνομα χρήστη σου παρακάτω) και οι αδυναμίες σου θα εμφανιστούν εδώ.',
          }, lang)}</p>
        ) : (
          <div className="weak-list">
            {weak.map(w => (
              <div key={w.lesson} className="weak-row">
                <button className="link" onClick={() => onLesson(w.lesson)}>{lessonTitle(w.lesson, lang)}</button>
                <div className="bar"><div style={{ width: `${(w.weight / max) * 100}%` }} /></div>
                <span className="muted small">{tr({ en: `${w.games} game${w.games > 1 ? 's' : ''}`, el: `${w.games} ${w.games === 1 ? 'παρτίδα' : 'παρτίδες'}` }, lang)}</span>
                <button className="pill" onClick={() => onPractice(w.lesson)}>{tr({ en: 'Practise', el: 'Εξάσκηση' }, lang)}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h3>{tr({ en: 'Recent games', el: 'Πρόσφατες παρτίδες' }, lang)}</h3>
          <table className="games-table">
            <tbody>
              {recent.map(g => (
                <tr key={g.id}>
                  <td>{g.color === 'w' ? '♔' : '♚'} {g.color === 'w' ? g.black : g.white}</td>
                  <td>{g.result}</td>
                  <td>{g.accuracy.toFixed(1)}%</td>
                  <td className="muted">{g.rating}</td>
                  <td className="muted small">{g.opening?.replace(/^[A-E]\d\d /, '') ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>{tr({ en: 'Settings', el: 'Ρυθμίσεις' }, lang)}</h3>
        <label className="field">
          <span>{tr({
            en: 'Your username (chess.com or Lichess) — used to know which side you played',
            el: 'Το όνομα χρήστη σου (chess.com ή Lichess) — χρησιμοποιείται για να ξέρουμε με ποιο χρώμα έπαιξες',
          }, lang)}</span>
          <div className="row">
            <input value={name} onChange={e => setName(e.target.value)} placeholder={tr({ en: 'username', el: 'όνομα χρήστη' }, lang)} />
            <button className="pill" onClick={() => { setPlayer(name.trim(), p.player?.source ?? 'chess.com'); setMsg({ en: 'Saved.', el: 'Αποθηκεύτηκε.' }) }}>{saveLabel}</button>
          </div>
        </label>
        <label className="field">
          <span>{tr({
            en: 'AI coach (optional, beta): your Anthropic API key. It is stored only in this browser and sent only to Anthropic.',
            el: 'AI προπονητής (προαιρετικά, beta): το κλειδί σου Anthropic API. Αποθηκεύεται μόνο σε αυτό το πρόγραμμα περιήγησης και αποστέλλεται μόνο στην Anthropic.',
          }, lang)}</span>
          <div className="row">
            <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
            <button className="pill" onClick={() => {
              setApiKey(key)
              setMsg(key ? { en: 'AI coach enabled.', el: 'Ο AI προπονητής ενεργοποιήθηκε.' } : { en: 'Key removed.', el: 'Το κλειδί αφαιρέθηκε.' })
            }}>{saveLabel}</button>
          </div>
        </label>
        <div className="row">
          <button className="pill" onClick={() => {
            const blob = new Blob([exportProgress()], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = 'game-review-progress.json'
            a.click()
            URL.revokeObjectURL(a.href)
          }}>{tr({ en: 'Export progress', el: 'Εξαγωγή προόδου' }, lang)}</button>
          <label className="pill file">
            {tr({ en: 'Import progress', el: 'Εισαγωγή προόδου' }, lang)}
            <input type="file" accept="application/json" onChange={async e => {
              const f = e.target.files?.[0]
              if (!f) return
              try { importProgress(await f.text()); setMsg({ en: 'Progress imported.', el: 'Η πρόοδος εισήχθη.' }) } catch (err) { setMsg((err as Error).message) }
            }} />
          </label>
          <button className="pill danger" onClick={() => {
            if (confirm(tr({ en: 'Delete all training progress in this browser?', el: 'Να διαγραφεί όλη η πρόοδος εξάσκησης σε αυτό το πρόγραμμα περιήγησης;' }, lang))) {
              resetProgress()
              setMsg({ en: 'Progress reset.', el: 'Η πρόοδος μηδενίστηκε.' })
            }
          }}>{tr({ en: 'Reset', el: 'Μηδενισμός' }, lang)}</button>
        </div>
        {msg && <p className="muted small">{showMsg(msg)}</p>}
      </section>

      <section className="about">
        <h3>{tr({ en: 'About & credits', el: 'Σχετικά & ευχαριστίες' }, lang)}</h3>
        {lang === 'el' ? (
          <>
            <p className="small">
              Δωρεάν και ανοιχτού κώδικα (<a href="https://github.com/meintsot/chess-review">πηγαίος κώδικας</a>, AGPL-3.0). Η ανάλυση γίνεται εξ
              ολοκλήρου στο πρόγραμμα περιήγησής σου· οι παρτίδες και η πρόοδός σου αποθηκεύονται μόνο σε αυτή τη συσκευή. Δεν συνδέεται με το
              chess.com ή το Lichess.
            </p>
            <p className="small muted">
              Βασίζεται στο Stockfish 18 (GPLv3), το chessground (GPLv3), το chess.js (BSD), τον ταξινομητή τακτικών του lichess-puzzler (AGPLv3),
              το Stockfish Evaluation Guide (GPLv3), τους γρίφους, τις παρτίδες και τα ανοίγματα του Lichess (CC0), το Strategic Test Suite (MIT)
              και το Maia-2 (MIT).
            </p>
          </>
        ) : (
          <>
            <p className="small">
              Free and open source (<a href="https://github.com/meintsot/chess-review">source code</a>, AGPL-3.0). Analysis runs entirely in your
              browser; your games and progress are stored only on this device. Not affiliated with chess.com or Lichess.
            </p>
            <p className="small muted">
              Built on Stockfish 18 (GPLv3), chessground (GPLv3), chess.js (BSD), the lichess-puzzler tactic tagger (AGPLv3), the Stockfish
              Evaluation Guide (GPLv3), Lichess puzzles, games and openings (CC0), the Strategic Test Suite (MIT) and Maia-2 (MIT).
            </p>
          </>
        )}
      </section>
    </main>
  )
}
