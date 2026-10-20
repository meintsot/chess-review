// Minimal i18n: English and Greek. The language comes from the user's choice, else the browser.
import { useSyncExternalStore } from 'react'
export type Lang = 'en' | 'el'

const KEY = 'chess-review.lang'
const listeners = new Set<() => void>()

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'el') return saved
  } catch {
    // storage unavailable
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('el') ? 'el' : 'en'
}

let current: Lang = detect()

export const getLang = (): Lang => current

export function setLang(lang: Lang) {
  current = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // storage unavailable
  }
  document.documentElement.lang = lang
  listeners.forEach(l => l())
}

export function subscribeLang(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Pick the string for the current language: tr({ en: '…', el: '…' }). */
export const tr = (s: { en: string; el: string }, lang: Lang = current) => s[lang]

/** React hook: re-render when the language changes. */
export const useLang = (): Lang => useSyncExternalStore(subscribeLang, getLang)
