import type { Classification } from './review'

export const CLASS_INFO: Record<Classification, { label: string; color: string; phrase: string }> = {
  brilliant: { label: 'Brilliant', color: '#1fb5ad', phrase: 'is brilliant' },
  great: { label: 'Great', color: '#5b8fc7', phrase: 'is a great move' },
  best: { label: 'Best', color: '#7fb24a', phrase: 'is best' },
  excellent: { label: 'Excellent', color: '#93bf55', phrase: 'is excellent' },
  good: { label: 'Good', color: '#9cb38a', phrase: 'is good' },
  book: { label: 'Book', color: '#a8876a', phrase: 'is a book move' },
  forced: { label: 'Forced', color: '#8e9aa6', phrase: 'is forced' },
  inaccuracy: { label: 'Inaccuracy', color: '#e8b923', phrase: 'is an inaccuracy' },
  mistake: { label: 'Mistake', color: '#ee8a3c', phrase: 'is a mistake' },
  miss: { label: 'Miss', color: '#e2665c', phrase: 'is a miss' },
  blunder: { label: 'Blunder', color: '#d93a2b', phrase: 'is a blunder' },
}

export const SUMMARY_ORDER: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
]

// Glyphs are vector paths centred on (0,0) in a ±46 box, so they look identical on every device
// (text glyphs like ★ ✓ shift or turn into emoji depending on the platform font).
const W = 'fill="#fff"'
const S = 'fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"'
const bang = `<path d="M-7 -24a7 7 0 0 1 14 0l-2 30h-10z" ${W}/><circle cy="20" r="7" ${W}/>`
const quest = `<path d="M-14 -13c0-18 28-18 28-1 0 11-14 11-14 22" ${S} stroke-width="11"/><circle cy="24" r="7" ${W}/>`
const pair = (a: string, b: string) =>
  `<g transform="translate(-14 0) scale(.82)">${a}</g><g transform="translate(14 0) scale(.82)">${b}</g>`

const GLYPHS: Record<Classification, string> = {
  brilliant: pair(bang, bang),
  great: bang,
  best: `<path d="M0.0 -28.0L7.3 -8.1L28.5 -7.3L11.9 5.9L17.6 26.3L0.0 14.5L-17.6 26.3L-11.9 5.9L-28.5 -7.3L-7.3 -8.1z" ${W}/>`,
  excellent: `<path d="M-24 -4h9v29h-9z" ${W}/><path d="M-10 -4l9-21c3-6 12-4 11 3l-2 10h14c5 0 8 4 7 9l-5 20c-1 4-4 7-8 7h-26z" ${W}/>`,
  good: `<path d="M-19 1l12 12 25-26" ${S} stroke-width="11"/>`,
  book: `<path d="M-3 -16c-8-6-18-7-27-4v35c9-3 19-2 27 4z" ${W}/><path d="M3 -16c8-6 18-7 27-4v35c-9-3-19-2-27 4z" ${W}/>`,
  forced: `<path d="M-20 0h36M4 -13l14 13-14 13" ${S} stroke-width="10"/>`,
  inaccuracy: pair(quest, bang),
  mistake: quest,
  miss: `<path d="M-15 -15l30 30M15 -15l-30 30" ${S} stroke-width="11"/>`,
  blunder: pair(quest, quest),
}

/** Badge as SVG markup drawn in a 100×100 box (used on the board and in the UI). */
export function badgeSvg(cls: Classification, cx = 50, cy = 50, r = 46): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${CLASS_INFO[cls].color}" stroke="rgba(0,0,0,.35)" stroke-width="${r * 0.08}"/>` +
    `<g transform="translate(${cx} ${cy}) scale(${r / 46})">${GLYPHS[cls]}</g>`
  )
}

const CLASS_EL: Record<Classification, { label: string; phrase: string }> = {
  brilliant: { label: 'Εκπληκτική', phrase: 'είναι εκπληκτική κίνηση' },
  great: { label: 'Σπουδαία', phrase: 'είναι σπουδαία κίνηση' },
  best: { label: 'Καλύτερη', phrase: 'είναι η καλύτερη κίνηση' },
  excellent: { label: 'Άριστη', phrase: 'είναι άριστη κίνηση' },
  good: { label: 'Καλή', phrase: 'είναι καλή κίνηση' },
  book: { label: 'Θεωρία', phrase: 'είναι κίνηση θεωρίας' },
  forced: { label: 'Αναγκαστική', phrase: 'είναι αναγκαστική' },
  inaccuracy: { label: 'Ανακρίβεια', phrase: 'είναι ανακρίβεια' },
  mistake: { label: 'Λάθος', phrase: 'είναι λάθος' },
  miss: { label: 'Χαμένη ευκαιρία', phrase: 'είναι χαμένη ευκαιρία' },
  blunder: { label: 'Αβλεψία', phrase: 'είναι αβλεψία' },
}

/** Label and phrase ("Nf3 is a mistake") in the given language. */
export const classText = (cls: Classification, lang: 'en' | 'el') => (lang === 'el' ? CLASS_EL[cls] : CLASS_INFO[cls])
