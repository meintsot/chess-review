import type { GameReview } from '../lib/review'
import { CLASS_INFO } from '../lib/classes'
import { barFraction, formatScore, type Score } from '../lib/score'
import { tr, useLang } from '../i18n'

export function EvalBar({ score, orientation }: { score: Score; orientation: 'white' | 'black' }) {
  const white = barFraction(score)
  const flipped = orientation === 'black'
  const text = formatScore(score).replace('+', '')
  const whiteAhead = white >= 0.5
  const lang = useLang()
  return (
    <div className={`evalbar${flipped ? ' flipped' : ''}`} aria-label={`${tr({ en: 'Evaluation', el: 'Αξιολόγηση' }, lang)} ${formatScore(score)}`}>
      <div className="evalbar-white" style={{ height: `${white * 100}%` }} />
      <span className={`evalbar-text ${whiteAhead ? 'on-white' : 'on-black'}`}>{text}</span>
    </div>
  )
}

const W = 600
const H = 120

export function EvalGraph({ review, ply, onSelect }: { review: GameReview; ply: number; onSelect: (ply: number) => void }) {
  const scores = [review.startScore, ...review.moves.map(m => m.scoreAfter)]
  const n = scores.length - 1 || 1
  const x = (i: number) => (i / n) * W
  const y = (s: Score) => (1 - barFraction(s)) * H
  const pts = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`)
  const area = `M0,${H} L${pts.join(' L')} L${W},${H} Z`
  const lang = useLang()
  const marks = review.moves.filter(m => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.cls))

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSelect(Math.round(((e.clientX - r.left) / r.width) * n))
  }

  return (
    <svg className="evalgraph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onClick={pick} role="img" aria-label={tr({ en: 'Evaluation graph', el: 'Γράφημα αξιολόγησης' }, lang)}>
      <rect width={W} height={H} className="eg-black" />
      <path d={area} className="eg-white" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} className="eg-cursor" />
      {marks.map(m => (
        <circle key={m.ply} cx={x(m.ply)} cy={y(m.scoreAfter)} r={4.5} fill={CLASS_INFO[m.cls].color} stroke="#0008" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
