import type { LyricLayout, LyricPhrase, LyricWord, PhraseSlot, Song, TimeRange } from '../../../shared/document'

export type { LyricPhrase } from '../../../shared/document'

/** A split fragment must stay long enough to be sung on its own. */
export const MIN_FRAGMENT_SECONDS = 0.22
/** Two fragments may be exchanged only when their places are the same length. */
export const SAME_LENGTH_SECONDS = 0.06
const EPS = 0.01

export interface LyricsState {
  layout: LyricLayout
  past: LyricLayout[]
}

export type EditResult =
  | { ok: true; state: LyricsState; created?: { head: string; tail: string } }
  | { ok: false; message: string }

function fail(message: string): EditResult {
  return { ok: false, message }
}

export function sameLength(a: TimeRange, b: TimeRange) {
  return Math.abs((a.end - a.start) - (b.end - b.start)) <= SAME_LENGTH_SECONDS
}

function seed(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return (uuid ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 8)
}

/** The segmentation a song ships with. Places are fixed here and never move again. */
export function createLayout(song: Song): LyricLayout {
  return {
    version: 1,
    songId: song.id,
    words: song.lines.map(line => ({
      id: `w-${line.id}`,
      text: line.text,
      parentId: null,
      relation: null,
      slice: null,
      origin: { start: line.start, end: line.end },
    })),
    slots: song.lines.map(line => ({
      id: line.id,
      wordId: `w-${line.id}`,
      tail: false,
      start: line.start,
      end: line.end,
    })),
  }
}

export function initialState(song: Song): LyricsState {
  return { layout: createLayout(song), past: [] }
}

export function slotOf(layout: LyricLayout, id: string): PhraseSlot | undefined {
  return layout.slots.find(slot => slot.id === id)
}

export function wordOf(layout: LyricLayout, id: string): LyricWord | undefined {
  return layout.words.find(word => word.id === id)
}

/** True when the word currently here was born in another place. */
export function isMoved(layout: LyricLayout, slot: PhraseSlot | LyricPhrase): boolean {
  const word = wordOf(layout, slot.wordId)
  if (!word) return false
  return Math.abs(word.origin.start - slot.start) > EPS
    || Math.abs(word.origin.end - slot.end) > EPS
}

/** Slots resolved against the words that currently live in them, in song order. */
export function phrasesOf(layout: LyricLayout): LyricPhrase[] {
  return [...layout.slots]
    .sort((a, b) => a.start - b.start)
    .map(slot => {
      const word = wordOf(layout, slot.wordId)
      return {
        id: slot.id,
        text: word?.text ?? '',
        start: slot.start,
        end: slot.end,
        wordId: slot.wordId,
        tail: slot.tail,
        moved: isMoved(layout, slot),
        origin: word ? { start: word.origin.start, end: word.origin.end } : { start: slot.start, end: slot.end },
      }
    })
}

/**
 * Equal-length fragments this one may trade words with. At least one side
 * must be a split-off latter half, so two untouched whole lines are never
 * offered as an exchange.
 */
export function exchangePartners(layout: LyricLayout, slotId: string): LyricPhrase[] {
  const slot = slotOf(layout, slotId)
  if (!slot) return []
  const own = wordOf(layout, slot.wordId)
  return phrasesOf(layout).filter(other => {
    if (other.id === slot.id || other.wordId === slot.wordId || !sameLength(slot, other)) return false
    if (!slot.tail && !other.tail) return false
    // The two halves of one split are one breath; trading them is meaningless.
    const peer = wordOf(layout, other.wordId)
    return !(own?.parentId && peer?.parentId && own.parentId === peer.parentId)
  })
}

function commit(state: LyricsState, layout: LyricLayout, created?: { head: string; tail: string }): EditResult {
  return { ok: true, state: { layout, past: [...state.past, state.layout].slice(-60) }, created }
}

/**
 * Cut one phrase in two by character count. Positions follow the text's
 * proportion, so the latter half keeps its share of the same breath. Both
 * halves are new words descended from the old one by a split; only the latter
 * half is flagged as exchangeable.
 */
export function splitSlot(state: LyricsState, slotId: string, at: number, newSeed = seed()): EditResult {
  const slot = slotOf(state.layout, slotId)
  if (!slot) return fail('找不到要拆分的乐句。')
  const word = wordOf(state.layout, slot.wordId)
  if (!word) return fail('这一句的文字已经不在词库中。')
  if (!Number.isInteger(at) || at < 1 || at >= word.text.length) return fail('拆分点要落在文字中间。')
  const length = slot.end - slot.start
  const headLength = length * at / word.text.length
  if (headLength < MIN_FRAGMENT_SECONDS || length - headLength < MIN_FRAGMENT_SECONDS) {
    return fail('这一句太短，无法再拆分。')
  }
  const splitAt = slot.start + headLength
  const headWordId = `w-${newSeed}-h`
  const tailWordId = `w-${newSeed}-t`
  const tailSlotId = `${slot.id}.${newSeed}`
  if (wordOf(state.layout, headWordId) || wordOf(state.layout, tailWordId) || slotOf(state.layout, tailSlotId)) {
    return fail('拆分编号冲突，请再试一次。')
  }

  const headWord: LyricWord = {
    id: headWordId, text: word.text.slice(0, at), parentId: word.id, relation: 'split',
    slice: { from: 0, to: at }, origin: { start: slot.start, end: splitAt },
  }
  const tailWord: LyricWord = {
    id: tailWordId, text: word.text.slice(at), parentId: word.id, relation: 'split',
    slice: { from: at, to: word.text.length }, origin: { start: splitAt, end: slot.end },
  }
  const headSlot: PhraseSlot = {
    id: slot.id, wordId: headWordId, tail: slot.tail, start: slot.start, end: splitAt,
  }
  const tailSlot: PhraseSlot = {
    id: tailSlotId, wordId: tailWordId, tail: true, start: splitAt, end: slot.end,
  }
  const slots = state.layout.slots
    .flatMap(entry => entry.id === slotId ? [headSlot, tailSlot] : [entry])
    .sort((a, b) => a.start - b.start)
  const layout: LyricLayout = {
    ...state.layout, words: [...state.layout.words, headWord, tailWord], slots,
  }
  return commit(state, layout, { head: headSlot.id, tail: tailSlot.id })
}

/**
 * Trade the words of two equal-length fragments. Places stay put, so the loop
 * and the pitch graph keep following the current phrases. At least one side
 * must be a split-off latter half.
 */
export function exchangeSlots(state: LyricsState, aId: string, bId: string): EditResult {
  if (aId === bId) return fail('要交换的是两个不同的片段。')
  const a = slotOf(state.layout, aId)
  const b = slotOf(state.layout, bId)
  if (!a || !b) return fail('找不到要交换的片段。')
  if (!a.tail && !b.tail) return fail('请先拆出一句的后半段，再与另一处交换。')
  if (a.wordId === b.wordId) return fail('这两个片段已经是同一段文字。')
  const wordA = wordOf(state.layout, a.wordId)
  const wordB = wordOf(state.layout, b.wordId)
  if (wordA?.parentId && wordA.parentId === wordB?.parentId) return fail('同一句拆出的两半不能互换。')
  if (!sameLength(a, b)) return fail('两个片段长度不同，不能交换。')
  const slots = state.layout.slots.map(slot => {
    if (slot.id === a.id) return { ...slot, wordId: b.wordId }
    if (slot.id === b.id) return { ...slot, wordId: a.wordId }
    return slot
  })
  return commit(state, { ...state.layout, slots })
}

/**
 * Replace a phrase's text in place. The new word descends from the old one by
 * a rewrite, not a split, so earlier attempts only share this song time.
 */
export function rewriteSlot(state: LyricsState, slotId: string, text: string, newSeed = seed()): EditResult {
  const slot = slotOf(state.layout, slotId)
  if (!slot) return fail('找不到要改词的乐句。')
  const current = wordOf(state.layout, slot.wordId)
  if (!current) return fail('这一句的文字已经不在词库中。')
  const next = text.trim()
  if (!next) return fail('新的文字不能为空。')
  if (next === current.text) return fail('文字没有变化。')
  const wordId = `w-${newSeed}-r`
  if (wordOf(state.layout, wordId)) return fail('改写编号冲突，请再试一次。')
  const word: LyricWord = {
    id: wordId, text: next, parentId: current.id, relation: 'replace', slice: null,
    origin: { start: slot.start, end: slot.end },
  }
  const slots = state.layout.slots.map(entry => entry.id === slotId ? { ...entry, wordId } : entry)
  return commit(state, { ...state.layout, words: [...state.layout.words, word], slots })
}

/**
 * Restore the song's own segmentation but keep the word table, so recordings
 * of retired words can still be named and their lineage still explained.
 */
export function resetLayout(state: LyricsState, song: Song): EditResult {
  const base = createLayout(song)
  const known = new Set(base.words.map(word => word.id))
  const kept = state.layout.words.filter(word => !known.has(word.id))
  return commit(state, { ...base, words: [...kept, ...base.words] })
}

export function undoLayout(state: LyricsState): LyricsState {
  const previous = state.past.at(-1)
  if (!previous) return state
  return { layout: previous, past: state.past.slice(0, -1) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validRange(value: unknown, duration: number): value is TimeRange {
  if (!isRecord(value)) return false
  const { start, end } = value
  return typeof start === 'number' && typeof end === 'number'
    && Number.isFinite(start) && Number.isFinite(end)
    && start >= 0 && end > start && end <= duration + EPS
}

/**
 * Every place must still sit inside one of the song's original lines, and the
 * places inside a line must tile it exactly. That keeps loops and the graph
 * anchored to the positions the song actually has.
 */
function placesFitSong(song: Song, slots: readonly PhraseSlot[]): boolean {
  for (const line of song.lines) {
    const inside = slots
      .filter(slot => slot.start < line.end - EPS && slot.end > line.start + EPS)
      .sort((a, b) => a.start - b.start)
    if (!inside.length) return false
    if (Math.abs(inside[0].start - line.start) > EPS) return false
    if (Math.abs(inside.at(-1)!.end - line.end) > EPS) return false
    for (let index = 1; index < inside.length; index++) {
      if (Math.abs(inside[index].start - inside[index - 1].end) > EPS) return false
    }
  }
  return slots.every(slot => song.lines.some(line => slot.start >= line.start - EPS && slot.end <= line.end + EPS))
}

/** Accept a stored layout only when it still fits the song's fixed phrase positions. */
export function normalizeLayout(song: Song, value: unknown): LyricLayout | null {
  if (!isRecord(value) || value.version !== 1 || value.songId !== song.id) return null
  if (!Array.isArray(value.words) || !Array.isArray(value.slots) || !value.slots.length) return null
  const words: LyricWord[] = []
  const wordIds = new Set<string>()
  for (const raw of value.words as unknown[]) {
    if (!isRecord(raw)) return null
    if (typeof raw.id !== 'string' || typeof raw.text !== 'string' || !raw.text) return null
    if (wordIds.has(raw.id)) return null
    if (raw.parentId !== null && typeof raw.parentId !== 'string') return null
    if (raw.relation !== null && raw.relation !== 'split' && raw.relation !== 'replace') return null
    if (!validRange(raw.origin, song.duration)) return null
    let slice: LyricWord['slice'] = null
    if (raw.slice !== null && raw.slice !== undefined) {
      if (!isRecord(raw.slice)) return null
      const { from, to } = raw.slice
      if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (to as number) <= (from as number)) {
        return null
      }
      slice = { from: from as number, to: to as number }
    }
    const origin = raw.origin as TimeRange
    wordIds.add(raw.id)
    words.push({
      id: raw.id, text: raw.text, parentId: raw.parentId as string | null,
      relation: raw.relation as LyricWord['relation'], slice,
      origin: { start: origin.start, end: origin.end },
    })
  }
  const slots: PhraseSlot[] = []
  const slotIds = new Set<string>()
  for (const raw of value.slots as unknown[]) {
    if (!isRecord(raw)) return null
    if (typeof raw.id !== 'string' || typeof raw.wordId !== 'string' || typeof raw.tail !== 'boolean') return null
    if (slotIds.has(raw.id) || !wordIds.has(raw.wordId)) return null
    if (!validRange(raw, song.duration)) return null
    const range = raw as unknown as TimeRange
    slotIds.add(raw.id)
    slots.push({ id: raw.id, wordId: raw.wordId, tail: raw.tail, start: range.start, end: range.end })
  }
  if (!placesFitSong(song, slots)) return null
  slots.sort((a, b) => a.start - b.start)
  return { version: 1, songId: song.id, words, slots }
}
