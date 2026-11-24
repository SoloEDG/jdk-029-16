import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Song, Take } from '../src/shared/document.ts'
import { exchangeSlots, initialState, phrasesOf, rewriteSlot, splitSlot, type LyricsState } from '../src/features/lyrics/lib/layout.ts'
import { attachTake, takeViews, splitAncestry } from '../src/features/review/lib/attach.ts'

const song: Song = {
  id: 'fixture',
  title: '测试曲',
  artist: '测试',
  bpm: 90,
  key: 'C',
  duration: 60,
  audio: '',
  cover: '',
  notes: [],
  lines: [
    { id: 'l1', text: '把夜色折进衣袖', start: 2, end: 6.8 },
    { id: 'l2', text: '听见远处的海风', start: 7, end: 11.8 },
    { id: 'l3', text: '如果星光还能停留', start: 12, end: 16.8 },
    { id: 'l4', text: '就让余音慢慢漂流', start: 17, end: 21.8 },
    { id: 'l5', text: '如果星光还能停留', start: 22, end: 26.8 },
  ],
}

let clock = 0
function take(partial: Partial<Take> & Pick<Take, 'lineId' | 'start' | 'end'>): Take {
  clock += 1
  return {
    id: `t${clock}`,
    songId: 'fixture',
    wordId: `w-${partial.lineId}`,
    wordText: '',
    createdAt: 1000 + clock,
    audio: new Blob(),
    pitch: [],
    ...partial,
  }
}

/** Split both choruses, then trade their latter halves. */
function swapped(): LyricsState {
  const a = splitSlot(initialState(song), 'l3', 4, 'aaaa')
  assert.equal(a.ok, true)
  if (!a.ok) throw new Error(a.message)
  const b = splitSlot(a.state, 'l5', 4, 'bbbb')
  assert.equal(b.ok, true)
  if (!b.ok) throw new Error(b.message)
  const x = exchangeSlots(b.state, a.created!.tail, b.created!.tail)
  assert.equal(x.ok, true)
  if (!x.ok) throw new Error(x.message)
  return x.state
}

function fragment(state: LyricsState, id: string) {
  const phrase = phrasesOf(state.layout).find(p => p.id === id)
  assert.ok(phrase, `missing phrase ${id}`)
  return phrase
}

function byWord(state: LyricsState, wordId: string) {
  const phrase = phrasesOf(state.layout).find(p => p.wordId === wordId)
  assert.ok(phrase, `missing word ${wordId}`)
  return phrase
}

test('plain takes stay with their own repeated chorus by word identity', () => {
  const state = swapped()
  const words = state.layout.words
  const t3 = take({ lineId: 'l3', wordId: 'w-aaaa-h', wordText: '如果星光', start: 12, end: 14.4 })
  const t5 = take({ lineId: 'l5', wordId: 'w-bbbb-h', wordText: '如果星光', start: 22, end: 24.4 })
  const atL3 = takeViews([t3, t5], fragment(state, 'l3'), words)
  const atL5 = takeViews([t3, t5], fragment(state, 'l5'), words)
  assert.deepEqual(atL3.map(v => v.take.id), [t3.id])
  assert.deepEqual(atL5.map(v => v.take.id), [t5.id])
  assert.deepEqual(atL3[0].marks, ['word', 'time'])
})

test('a take that stopped after the first half is never attached to the moved latter half', () => {
  const state = swapped()
  const words = state.layout.words
  // t1 was recorded for the original phrase and stops exactly at the new split.
  const t1 = take({ lineId: 'l3', wordId: 'w-l3', wordText: '如果星光还能停留', start: 12, end: 14.4 })
  const head = fragment(state, 'l3')
  const movedTail = byWord(state, 'w-aaaa-t')
  assert.deepEqual(takeViews([t1], head, words).map(v => v.marks), [['word', 'time']])
  assert.deepEqual(takeViews([t1], movedTail, words), [])
  // It also does not turn up at the tail's new home by song time.
  const newHome = byWord(state, 'w-aaaa-t')
  assert.deepEqual(takeViews([t1], newHome, words), [])
})

test('a take crossing the split is found from both fragments and names what it sang', () => {
  const state = swapped()
  const words = state.layout.words
  const crossing = take({ lineId: 'l3', wordId: 'w-l3', wordText: '如果星光还能停留', start: 13, end: 15 })
  const head = fragment(state, 'l3')
  const movedTail = byWord(state, 'w-aaaa-t')
  const [atHead] = takeViews([crossing], head, words)
  const [atTail] = takeViews([crossing], movedTail, words)
  assert.deepEqual(atHead.marks, ['word', 'time'])
  assert.deepEqual(atHead.wordCoverage, { sung: { start: 13, end: 14.4 }, entered: false, left: true })
  assert.deepEqual(atTail.marks, ['word'])
  assert.equal(atTail.elsewhere, true)
  // Measured against the tail's birth at 14.4, the take begins before it.
  assert.deepEqual(atTail.wordCoverage, { sung: { start: 14.4, end: 15 }, entered: true, left: false })
})

test('identical swapped text still separates original-word history from current song time', () => {
  const state = swapped()
  const words = state.layout.words
  // Recorded for the l5 tail before the swap; both tails now read 还能停留.
  const oldL5Tail = take({ lineId: 'l5', wordId: 'w-bbbb-t', wordText: '还能停留', start: 24.4, end: 26.8 })
  // After the swap, l3's tail holds the word born at l5, and vice versa.
  const l3Tail = byWord(state, 'w-bbbb-t')
  const l5Tail = byWord(state, 'w-aaaa-t')
  const [atL3] = takeViews([oldL5Tail], l3Tail, words)
  const [atL5] = takeViews([oldL5Tail], l5Tail, words)
  assert.deepEqual(atL3.marks, ['word'])
  assert.equal(atL3.text, '还能停留')
  assert.equal(atL3.elsewhere, true)
  assert.deepEqual(atL5.marks, ['time'])
  assert.equal(atL5.timeCoverage?.sung.start, 24.4)
  // Same text, same recording, two different histories.
  assert.equal(l3Tail.text, l5Tail.text)
  assert.notEqual(atL3.marks.join(), atL5.marks.join())
})

test('a take matching by both words and song time appears once with both marks', () => {
  const state = swapped()
  const words = state.layout.words
  // Recorded before the split for the second chorus; spans all of l5.
  const oldL5 = take({ lineId: 'l5', wordId: 'w-l5', wordText: '如果星光还能停留', start: 22, end: 26.8 })
  // l5's head still holds a word split from w-l5 and still sits at 22–24.4.
  const l5Head = phrasesOf(state.layout).find(p => p.id === 'l5')!
  const views = takeViews([oldL5], l5Head, words)
  assert.equal(views.length, 1)
  assert.deepEqual(views[0].marks, ['word', 'time'])
  assert.deepEqual(views[0].wordCoverage?.sung, { start: 22, end: 24.4 })
  assert.deepEqual(views[0].timeCoverage?.sung, { start: 22, end: 24.4 })
})

test('untouched recording wholly inside its phrase keeps one home', () => {
  const state = swapped()
  const words = state.layout.words
  const plain = take({ lineId: 'l2', wordId: 'w-l2', wordText: '听见远处的海风', start: 7, end: 11.8 })
  for (const id of ['l2', 'l3', 'l4']) {
    const views = takeViews([plain], fragment(state, id), words)
    if (id === 'l2') assert.equal(views.length, 1)
    else assert.equal(views.length, 0)
  }
})

test('rewriting in place keeps only the time link for old takes', () => {
  const plain = initialState(song)
  const rewritten = { ...plain, layout: structuredClone(plain.layout) }
  const word = { id: 'w-new', text: '向前走', parentId: 'w-l2', relation: 'replace' as const, slice: null, origin: { start: 7, end: 11.8 } }
  rewritten.layout = {
    ...rewritten.layout,
    words: [...rewritten.layout.words, word],
    slots: rewritten.layout.slots.map(slot => slot.id === 'l2' ? { ...slot, wordId: word.id } : slot),
  }
  const old = take({ lineId: 'l2', wordId: 'w-l2', wordText: '听见远处的海风', start: 7, end: 11.8 })
  const [view] = takeViews([old], fragment(rewritten, 'l2'), rewritten.layout.words)
  assert.deepEqual(view.marks, ['time'])
  assert.equal(view.text, '听见远处的海风')
  assert.equal(view.wordCoverage, null)
})

test('after an exchange, rewriting in place separates the two histories for good', () => {
  const state = swapped()
  const rewritten = rewriteSlot(state, 'l5', '向前走', 'cccc')
  assert.equal(rewritten.ok, true)
  if (!rewritten.ok) return
  const words = rewritten.state.layout.words
  // A take of the old l5 head text now only meets the rewritten place by time.
  const oldHead = take({ lineId: 'l5', wordId: 'w-bbbb-h', wordText: '如果星光', start: 22, end: 24.4 })
  const head = fragment(rewritten.state, 'l5')
  const [view] = takeViews([oldHead], head, words)
  assert.deepEqual(view.marks, ['time'])
  assert.equal(view.text, '如果星光')
  assert.equal(view.wordCoverage, null)
  // A new take made after the rewrite owns the words outright.
  const fresh = take({ lineId: 'l5', wordId: 'w-cccc-r', wordText: '向前走', start: 22, end: 24.4 })
  const [newView] = takeViews([fresh], head, words)
  assert.deepEqual(newView.marks, ['word', 'time'])
  // The exchange itself is untouched by the rewrite of another place.
  const l3Tail = byWord(rewritten.state, 'w-bbbb-t')
  assert.deepEqual([l3Tail.start, l3Tail.end], [14.4, 16.8])
})

test('a take crossing an unmoved split is found from both halves with both marks', () => {
  const a = splitSlot(initialState(song), 'l3', 4, 'aaaa')
  assert.equal(a.ok, true)
  if (!a.ok) return
  const crossing = take({ lineId: 'l3', wordId: 'w-l3', wordText: '如果星光还能停留', start: 13, end: 15 })
  const head = fragment(a.state, 'l3')
  const tail = byWord(a.state, 'w-aaaa-t')
  const [atHead] = takeViews([crossing], head, a.state.layout.words)
  const [atTail] = takeViews([crossing], tail, a.state.layout.words)
  assert.deepEqual(atHead.marks, ['word', 'time'])
  assert.deepEqual(atTail.marks, ['word', 'time'])
  assert.equal(atTail.elsewhere, false)
})

test('split ancestry stops at a rewrite', () => {
  const words = [
    { id: 'a', text: 'ab', parentId: null, relation: null, slice: null, origin: { start: 0, end: 1 } },
    { id: 'b', text: 'a', parentId: 'a', relation: 'split' as const, slice: { from: 0, to: 1 }, origin: { start: 0, end: 0.5 } },
    { id: 'c', text: 'x', parentId: 'b', relation: 'replace' as const, slice: null, origin: { start: 0, end: 0.5 } },
  ]
  assert.deepEqual([...splitAncestry('b', words)], ['b', 'a'])
  assert.deepEqual([...splitAncestry('c', words)], ['c'])
})

test('a take with no word identity falls back to its slot word', () => {
  const state = swapped()
  const legacy = take({ lineId: 'l2', start: 7, end: 11.8 })
  delete legacy.wordId
  const views = takeViews([legacy], fragment(state, 'l2'), state.layout.words)
  assert.equal(views.length, 1)
  assert.deepEqual(views[0].marks, ['word', 'time'])
})
