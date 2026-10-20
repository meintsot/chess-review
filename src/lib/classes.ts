import type { Classification } from './review'

export const CLASS_INFO: Record<Classification, { label: string; color: string; symbol: string; phrase: string }> = {
  brilliant: { label: 'Brilliant', color: '#1fb5ad', symbol: '!!', phrase: 'is brilliant' },
  great: { label: 'Great', color: '#5b8fc7', symbol: '!', phrase: 'is a great move' },
  best: { label: 'Best', color: '#7fb24a', symbol: '★', phrase: 'is best' },
  excellent: { label: 'Excellent', color: '#93bf55', symbol: '✓', phrase: 'is excellent' },
  good: { label: 'Good', color: '#9cb38a', symbol: '✓', phrase: 'is good' },
  book: { label: 'Book', color: '#a8876a', symbol: 'B', phrase: 'is a book move' },
  forced: { label: 'Forced', color: '#8e9aa6', symbol: '→', phrase: 'is forced' },
  inaccuracy: { label: 'Inaccuracy', color: '#e8b923', symbol: '?!', phrase: 'is an inaccuracy' },
  mistake: { label: 'Mistake', color: '#ee8a3c', symbol: '?', phrase: 'is a mistake' },
  miss: { label: 'Miss', color: '#e2665c', symbol: '✕', phrase: 'is a miss' },
  blunder: { label: 'Blunder', color: '#d93a2b', symbol: '??', phrase: 'is a blunder' },
}

export const SUMMARY_ORDER: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
]

/** Badge as SVG markup drawn in a 100×100 box (used on the board and in the UI). */
export function badgeSvg(cls: Classification, cx = 50, cy = 50, r = 46): string {
  const { color, symbol } = CLASS_INFO[cls]
  const size = symbol.length > 1 ? r * 0.95 : r * 1.15
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="${r * 0.08}"/>` +
    `<text x="${cx}" y="${cy}" dy="0.36em" text-anchor="middle" font-family="system-ui,Segoe UI,Arial" ` +
    `font-weight="800" font-size="${size}" fill="#fff" letter-spacing="-2">${symbol}</text>`
  )
}
