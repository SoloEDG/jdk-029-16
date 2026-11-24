import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Song } from '../src/shared/document.ts'
import {
  createLayout, exchangePartners, exchangeSlots, phrasesOf, normalizeLayout, rewriteSlot, splitSlot,
  undoLayout, initialState, sameLength,
} from '../src/features/lyrics/lib/layout.ts'

const shortSong: Song = {
  id: 'short',
  title: '短句',
  artist: '测试',
  bpm: 90,
  key: 'C',
  duration: 30,
  audio: '',
  cover: '',
  notes: [],
  lines: [
    { id: 's1', text: '夜色折进衣袖里', start: 2, end: 7 },
    { id: 's2', text: '远处的海风', start: 8, end: 10.142857 },
  ],
}

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

function splitBoth() {
  const start = initialState(song)
  const a = splitSlot(start, 'l3', 4, 'aaaa')
  assert.equal(a.ok, true)
  if (!a.ok) throw new Error(a.message)
  const b = splitSlot(a.state, 'l5', 4, 'bbbb')
  assert.equal(b.ok, true)
  if (!b.ok) throw new Error(b.message)
  return { state: b.state, l3tail: a.created!.tail, l5tail: b.created!.tail }
}

test('splitting keeps every phrase place exactly where the song had it', () => {
  const split = splitBoth()
  const before = song.lines.map(line => [line.start, line.end])
  const after = phrasesOf(split.state.layout).map(phrase => [phrase.start, phrase.end])
  assert.equal(after.length, 7)
  // The two halves tile the old line and no place drifts.
  const l3 = phrasesOf(split.state.layout).filter(p => p.start >= 12 && p.end <= 16.8)
  assert.deepEqual(l3.map(p => [p.start, p.end]), [[12, 14.4], [14.4, 16.8]])
  assert.deepEqual(after.filter((_, i) => [0, 1, 3, 4].includes(i)).slice(0, 2), before.slice(0, 2))
})

test('split text is cut by character count and marked as split ancestry', () => {
  const split = splitBoth()
  const list = phrasesOf(split.state.layout)
  const head = list.find(p => p.id === 'l3')!
  const tail = list.find(p => p.id === split.l3tail)!
  assert.equal(head.text, '如果星光')
  assert.equal(tail.text, '还能停留')
  assert.equal(tail.tail, true)
  assert.equal(head.tail, false)
  const words = split.state.layout.words
  const tailWord = words.find(w => w.id === tail.wordId)!
  assert.equal(tailWord.relation, 'split')
  assert.equal(tailWord.parentId, 'w-l3')
})

test('only equal-length partners are offered for exchange', () => {
  const split = splitBoth()
  const tail = phrasesOf(split.state.layout).find(p => p.id === split.l3tail)!
  const l5tail = phrasesOf(split.state.layout).find(p => p.id === split.l5tail)!
  assert.equal(sameLength(tail, l5tail), true)
  assert.equal(sameLength(tail, { start: 2, end: 6.8 }), false)
})

test('exchange swaps the words between places but keeps the places fixed', () => {
  const split = splitBoth()
  const result = exchangeSlots(split.state, split.l3tail, split.l5tail)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const list = phrasesOf(result.state.layout)
  const l3tail = list.find(p => p.id === split.l3tail)!
  const l5tail = list.find(p => p.id === split.l5tail)!
  // Identical text, but the words have really traded places.
  assert.equal(l3tail.text, '还能停留')
  assert.equal(l5tail.text, '还能停留')
  assert.equal(l3tail.wordId, 'w-bbbb-t')
  assert.equal(l5tail.wordId, 'w-aaaa-t')
  assert.equal(l3tail.moved, true)
  assert.equal(l5tail.moved, true)
  assert.deepEqual([l3tail.start, l3tail.end], [14.4, 16.8])
  assert.deepEqual([l5tail.start, l5tail.end], [24.4, 26.8])
})

test('rewriting in place breaks split ancestry and undo restores both text and word', () => {
  const split = splitBoth()
  const exchanged = exchangeSlots(split.state, split.l3tail, split.l5tail)
  assert.equal(exchanged.ok, true)
  if (!exchanged.ok) return
  const rewritten = rewriteSlot(exchanged.state, split.l3tail, '向前走', 'cccc')
  assert.equal(rewritten.ok, true)
  if (!rewritten.ok) return
  const tail = phrasesOf(rewritten.state.layout).find(p => p.id === split.l3tail)!
  assert.equal(tail.text, '向前走')
  // A rewrite is born where it now sits, so it is not "moved" any more.
  assert.equal(tail.moved, false)
  assert.deepEqual(tail.origin, { start: 14.4, end: 16.8 })
  const word = rewritten.state.layout.words.find(w => w.id === tail.wordId)!
  assert.equal(word.relation, 'replace')

  const undone = undoLayout(rewritten.state)
  const restored = phrasesOf(undone.layout).find(p => p.id === split.l3tail)!
  assert.equal(restored.text, '还能停留')
  assert.equal(restored.wordId, 'w-bbbb-t')

  const again = undoLayout(undone)
  const back = phrasesOf(again.layout).find(p => p.id === split.l3tail)!
  assert.equal(back.wordId, 'w-aaaa-t')
})

test('exchange refuses non-tail, different-length, same-word and sibling pairs', () => {
  const split = splitBoth()
  const noTail = exchangeSlots(split.state, 'l1', split.l3tail)
  assert.equal(noTail.ok, false)
  const siblings = exchangeSlots(split.state, 'l3', split.l3tail)
  assert.equal(siblings.ok, false)
  const mismatch = exchangeSlots(split.state, split.l3tail, 'l4')
  assert.equal(mismatch.ok, false)
  const same = exchangeSlots(split.state, split.l3tail, split.l3tail)
  assert.equal(same.ok, false)
  const fullTwo = exchangeSlots(split.state, 'l3', 'l5')
  assert.equal(fullTwo.ok, false)
})

test('a split-off tail may trade with an equal-length fragment that was never split', () => {
  const split = splitSlot(initialState(shortSong), 's1', 4, 'aaaa')
  assert.equal(split.ok, true)
  if (!split.ok) return
  const tail = phrasesOf(split.state.layout).find(p => p.id === split.created!.tail)!
  assert.equal(tail.text, '衣袖里')
  // s2 is 2.143 seconds, exactly as long as the 3/7-split tail.
  const partners = exchangePartners(split.state.layout, tail.id)
  assert.deepEqual(partners.map(p => p.id), ['s2'])
  const result = exchangeSlots(split.state, tail.id, 's2')
  assert.equal(result.ok, true)
  if (!result.ok) return
  const list = phrasesOf(result.state.layout)
  assert.equal(list.find(p => p.id === tail.id)!.text, '远处的海风')
  assert.equal(list.find(p => p.id === 's2')!.text, '衣袖里')
  assert.equal(list.find(p => p.id === 's2')!.moved, true)
  assert.deepEqual([list.find(p => p.id === 's2')!.start, list.find(p => p.id === 's2')!.end], [8, 10.142857])
})

test('a stored layout is rejected when its places leave the song grid', () => {
  const split = splitBoth()
  const good = normalizeLayout(song, split.state.layout)
  assert.notEqual(good, null)
  const moved = structuredClone(split.state.layout)
  moved.slots = moved.slots.map(slot => slot.id === 'l3' ? { ...slot, start: 11, end: 13.4 } : slot)
  assert.equal(normalizeLayout(song, moved), null)
  const missing = structuredClone(split.state.layout)
  missing.slots = missing.slots.filter(slot => slot.id !== split.l5tail)
  assert.equal(normalizeLayout(song, missing), null)
  const stranger = structuredClone(split.state.layout)
  stranger.songId = 'other'
  assert.equal(normalizeLayout(song, stranger), null)
})

test('reset layout rebuilds the original segmentation', () => {
  const split = splitBoth()
  const base = createLayout(song)
  assert.equal(phrasesOf(base).length, 5)
  assert.equal(phrasesOf(base).some(p => p.moved), false)
  assert.equal(split.state.layout.slots.length, 7)
})
