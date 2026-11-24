import type { LyricWord, Take } from '../../../shared/document'

export interface Interval { start: number; end: number }
/** Why a recording belongs to a phrase: the words it practised, the time it covers. */
export type WordMark = 'word' | 'time'

export interface SpanCoverage {
  /** The stretch of the target span this recording truly sang. */
  sung: Interval
  /** The recording starts before the target; its beginning belongs to an earlier fragment. */
  entered: boolean
  /** The recording runs past the target; its ending belongs to a later fragment. */
  left: boolean
}

export interface Fragment {
  wordId: string
  /** Where the word lives now. */
  start: number
  end: number
  /** Where the word was born and first sung. */
  origin: Interval
}

/**
 * One recording attached to one phrase.
 *
 * `word` and `time` keep the two histories apart: the words the singer really
 * touched, and the stretch of the song the microphone was open for. A take can
 * carry both marks and still appears only once.
 */
export interface TakeView {
  take: Take
  marks: WordMark[]
  /** Text exactly as recorded, named even after the word retired. */
  text: string
  /** Stretch of this phrase's word, measured at its birth, that was really sung. */
  wordCoverage: SpanCoverage | null
  /** Stretch of this slot's current song time that was really sung. */
  timeCoverage: SpanCoverage | null
  /** The words belong here, but the take was made at another place. */
  elsewhere: boolean
}

export type CompareKind = 'slot' | 'words' | 'time' | 'apart'

const EPS = 0.001
const WINDOW = 0.03

export function span(range: Interval) {
  return range.end - range.start
}

export function overlap(a: Interval, b: Interval) {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start)
}

/** Older takes predate word identity and only carry their slot. */
export function takeWordId(take: Take): string | null {
  return take.wordId ?? (take.lineId ? `w-${take.lineId}` : null)
}

/**
 * Split ancestry means one breath was cut in two, so a parent's recordings can
 * still show a child's words. A rewrite deliberately breaks the chain: a
 * replacement is a new word, and older attempts merely share its song time.
 */
export function splitAncestry(phraseWordId: string, words: readonly LyricWord[]): Set<string> {
  const table = new Map(words.map(word => [word.id, word]))
  const chain = new Set<string>([phraseWordId])
  let current = table.get(phraseWordId)
  while (current?.parentId && current.relation === 'split') {
    chain.add(current.parentId)
    current = table.get(current.parentId)
  }
  return chain
}

export function takeText(take: Take, words: readonly LyricWord[]): string {
  if (take.wordText) return take.wordText
  const wordId = takeWordId(take)
  return words.find(word => word.id === wordId)?.text ?? ''
}

function clip(recorded: Interval, bounds: Interval): SpanCoverage | null {
  const sung = {
    start: Math.max(recorded.start, bounds.start),
    end: Math.min(recorded.end, bounds.end),
  }
  if (span(sung) <= EPS) return null
  return {
    sung,
    entered: recorded.start < bounds.start - EPS,
    left: recorded.end > bounds.end + EPS,
  }
}

/**
 * Attach one recording to one phrase.
 *
 * The words claim the phrase when the recording was made for this exact word,
 * or for a word later split into it. An ancestor only reaches a split child if
 * the recording covered the place where that child was born — so a take that
 * stopped after the first half never lands on a latter half moved elsewhere.
 *
 * The song time claims the phrase when the recording covers this slot as it
 * stands now, which keeps an earlier word's attempts with a place that has
 * since been rewritten or exchanged, even when the new text is identical.
 */
export function attachTake(take: Take, fragment: Fragment, words: readonly LyricWord[]): TakeView | null {
  const recorded = { start: take.start, end: take.end }
  const slot = { start: fragment.start, end: fragment.end }
  const takeWord = takeWordId(take)
  const identity = takeWord !== null && takeWord === fragment.wordId
  const splitFrom = takeWord !== null && splitAncestry(fragment.wordId, words).has(takeWord)
  const wordCoverage = clip(recorded, fragment.origin)
  const timeCoverage = clip(recorded, slot)
  const byWord = identity || (splitFrom && wordCoverage !== null)
  if (!byWord && !timeCoverage) return null
  const marks: WordMark[] = []
  if (byWord) marks.push('word')
  if (timeCoverage) marks.push('time')
  return {
    take,
    marks,
    text: takeText(take, words),
    wordCoverage: byWord ? wordCoverage : null,
    timeCoverage,
    elsewhere: byWord && !timeCoverage,
  }
}

/**
 * Recordings for one phrase, newest first, each shown once. A take that
 * qualifies both by its words and by current song time keeps both marks.
 */
export function takeViews(
  takes: readonly Take[],
  fragment: Fragment,
  words: readonly LyricWord[],
): TakeView[] {
  const views: TakeView[] = []
  for (const take of takes) {
    const view = attachTake(take, fragment, words)
    if (view) views.push(view)
  }
  return views.sort((a, b) => b.take.createdAt - a.take.createdAt)
}

export function compareKind(
  a: { id: string; lineId: string; start: number; end: number; wordId?: string },
  b: { id: string; lineId: string; start: number; end: number; wordId?: string },
): CompareKind {
  if (a.id === b.id || a.lineId === b.lineId) return 'slot'
  if (a.wordId && a.wordId === b.wordId) return 'words'
  if (overlap({ start: a.start, end: a.end }, { start: b.start, end: b.end }) >= -WINDOW) return 'time'
  return 'apart'
}

export function compareLabel(kind: CompareKind): string {
  switch (kind) {
    case 'slot': return '同一位置'
    case 'words': return '同一段原词'
    case 'time': return '同一段歌时'
    default: return '不同片段'
  }
}

/**
 * Name the stretch of the original fragment a take really sang, in song time,
 * so the singer can see which part of the words was actually theirs.
 */
export function spanText(coverage: SpanCoverage | null, format: (value: number) => string = seconds): string {
  if (!coverage) return ''
  const from = format(coverage.sung.start)
  const to = format(coverage.sung.end)
  const lead = coverage.entered ? '自前接续 ' : ''
  const tail = coverage.left ? ' 续入后句' : ''
  return `${lead}${from}–${to}${tail}`
}

function seconds(value: number) {
  return value.toFixed(1)
}
