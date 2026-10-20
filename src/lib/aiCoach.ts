// Optional AI coach: the player brings their own Anthropic API key (stored only in this browser) and
// Claude writes a coach's narrative of the game. The model only receives verified facts — engine
// lines, labels, detected motifs and positional changes — and is told not to analyse beyond them.
import { coachGame, coachMove, moveNo } from './coach'
import type { GameReview } from './review'
import { formatScore } from './score'
import { getLang, tr } from '../i18n'

const KEY = 'chess-review.anthropic-key'

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY, key.trim())
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable
  }
}

const SYSTEM = `You are an experienced, warm chess coach reviewing a student's game.
You receive verified facts from a chess engine and a position analyser. Rules:
- Use ONLY the facts provided. Never invent moves, pieces, squares, variations or evaluations, and never analyse positions yourself.
- Quote moves exactly as given (SAN). If a fact is missing, say less rather than guess.
- Explain the "why" in plain language: the tactical idea, the strategic plan, the habit behind the error.
- Talk to the student directly ("you"), be encouraging but honest, avoid engine jargon (no centipawns).
Write in the student's language if it is specified, otherwise English.
Format (Markdown):
## The story of the game — 4-6 sentences.
## Key moments — one short paragraph per moment, in move order.
## What went well — 2-3 bullets.
## Your training plan — 3 concrete bullets, each naming a theme to practise and why.`

/** Compact, verified fact sheet for one game from the student's point of view. */
export function factSheet(review: GameReview, player: 'w' | 'b', language?: string) {
  const lang = language === 'Greek' ? 'el' : language === 'English' ? 'en' : getLang()
  const report = coachGame(review, player, lang)
  const keyPlies = new Set(report.moments.map(m => m.ply))
  review.moves.filter(m => m.color === player && ['mistake', 'blunder', 'miss'].includes(m.cls)).forEach(m => keyPlies.add(m.ply))
  const moments = [...keyPlies].sort((a, b) => a - b).slice(0, 8).map(ply => {
    const m = review.moves[ply - 1]
    const note = coachMove(review, ply - 1, lang)
    return {
      move: `${moveNo(m)} ${m.san}`,
      by: m.color === player ? 'student' : 'opponent',
      verdict: m.cls,
      evalBefore: formatScore(m.scoreBefore),
      evalAfter: formatScore(m.scoreAfter),
      engineBest: m.bestSan,
      engineLine: m.bestLineSan.slice(0, 6).join(' '),
      opponentReply: m.replyLineSan.slice(0, 6).join(' '),
      verifiedTactics: note.tactical,
      verifiedStrategy: note.strategic,
      habit: note.advice,
    }
  })
  return {
    language: language ?? (lang === 'el' ? 'Greek' : 'English'),
    student: player === 'w' ? review.white : review.black,
    opponent: player === 'w' ? review.black : review.white,
    studentColor: player === 'w' ? 'White' : 'Black',
    result: review.result,
    opening: review.opening,
    accuracy: { student: player === 'w' ? review.accuracy.w : review.accuracy.b, opponent: player === 'w' ? review.accuracy.b : review.accuracy.w },
    gameRating: player === 'w' ? review.gameRating.w : review.gameRating.b,
    phases: report.phases.map(p => ({ phase: p.phase, accuracy: Math.round(p.accuracy), note: p.text })),
    pawnStructures: report.structures.map(s => ({ name: s.name, plans: s.plan })),
    strengths: report.strengths,
    themesToImprove: report.improve.map(i => i.lesson.replace(/-/g, ' ')),
    moves: review.moves.map(m => `${moveNo(m)} ${m.san} [${m.cls}]`).join(' '),
    keyMoments: moments,
  }
}

/** Streams the AI coach's narrative. Calls `onText` with the text so far. `client` is only for tests (mock server). */
export async function askAiCoach(
  review: GameReview, player: 'w' | 'b', onText: (text: string) => void, language?: string, signal?: AbortSignal,
  client?: { baseURL?: string; maxRetries?: number },
) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error(tr({ en: 'Add your Anthropic API key in Profile → AI coach first.', el: 'Πρόσθεσε πρώτα το κλειδί Anthropic API στο Προφίλ → AI προπονητής.' }))
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const api = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...client })
  const facts = factSheet(review, player, language)
  let text = ''
  const stream = api.beta.messages.stream(
    {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Here are the verified facts about my game. Please review it as my coach.\n\n${JSON.stringify(facts)}` }],
    },
    { signal },
  )
  stream.on('text', delta => {
    text += delta
    onText(text)
  })
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') throw new Error(tr({ en: 'The AI coach declined this request.', el: 'Ο AI προπονητής αρνήθηκε αυτό το αίτημα.' }))
  return text
}
