import { computed, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { LyricLayout, LyricPhrase, LyricWord, PhraseSlot, Song } from '../../../shared/document'
import {
  createLayout, exchangePartners, exchangeSlots, initialState, normalizeLayout, phrasesOf,
  resetLayout, rewriteSlot, splitSlot, undoLayout, type EditResult, type LyricsState,
} from '../lib/layout'
import { readLayout, writeLayout } from '../lib/store'

export type EditName = 'split' | 'exchange' | 'rewrite' | 'reset'

export function useLyrics(song: Ref<Song>, position: Ref<number>) {
  const selectedId = ref('')
  const state = shallowRef<LyricsState>(initialState(song.value))
  const loaded = ref(false)
  const issue = ref('')
  const notice = ref('')
  /** Fragments created by the last split, so the list can point at them. */
  const created = shallowRef<{ head: string; tail: string } | null>(null)
  const lastEdit = ref<EditName | null>(null)

  const phrases = computed<LyricPhrase[]>(() => phrasesOf(state.value.layout))
  const words = computed<LyricWord[]>(() => state.value.layout.words)
  const slots = computed<PhraseSlot[]>(() => state.value.layout.slots)
  const canUndo = computed(() => state.value.past.length > 0)
  const selected = computed(() => phrases.value.find(phrase => phrase.id === selectedId.value) ?? null)
  const active = computed(() => phrases.value.find(phrase => within(phrase, position.value)) ?? null)
  const upcoming = computed(() => phrases.value.find(phrase => phrase.start > position.value) ?? null)
  const lineProgress = computed(() => {
    const phrase = active.value
    return phrase ? (position.value - phrase.start) / (phrase.end - phrase.start) : 0
  })
  /** Equal-length fragments this phrase may swap words with. */
  const swapPartners = computed(() => {
    const line = selected.value
    return line ? exchangePartners(state.value.layout, line.id) : []
  })

  function within(range: { start: number; end: number }, seconds: number) {
    return range.start <= seconds && seconds < range.end
  }

  function firstId(layout: LyricLayout) {
    return [...layout.slots].sort((a, b) => a.start - b.start)[0]?.id ?? ''
  }

  /** Keep the selection; fall back to the phrase that now covers the old spot. */
  function keepSelection(anchor?: number) {
    if (phrases.value.some(phrase => phrase.id === selectedId.value)) return
    const covering = anchor === undefined
      ? undefined
      : phrases.value.find(phrase => phrase.start <= anchor && anchor < phrase.end)
    selectedId.value = covering?.id ?? firstId(state.value.layout)
  }

  function adopt(layout: LyricLayout, past: LyricLayout[] = []) {
    state.value = { layout, past }
    created.value = null
    lastEdit.value = null
    keepSelection()
  }

  function persist(layout: LyricLayout) {
    void writeLayout(layout).catch(() => { issue.value = '编辑未能写入本机记录。' })
  }

  function apply(name: EditName, result: EditResult, message: string): boolean {
    if (!result.ok) {
      issue.value = result.message
      notice.value = ''
      return false
    }
    issue.value = ''
    notice.value = message
    const anchor = selected.value?.start
    state.value = result.state
    lastEdit.value = name
    created.value = result.created ?? null
    // Point at the split-off half, which is the piece that can be exchanged.
    if (result.created) selectedId.value = result.created.tail
    else keepSelection(anchor)
    persist(result.state.layout)
    return true
  }

  function select(id: string) {
    const phrase = phrases.value.find(entry => entry.id === id)
    if (phrase) selectedId.value = id
    return phrase ?? null
  }

  function adjacent(direction: -1 | 1) {
    const list = phrases.value
    const index = list.findIndex(phrase => phrase.id === (active.value ?? selected.value)?.id)
    return list[Math.min(list.length - 1, Math.max(0, index + direction))] ?? null
  }

  async function loadFor(next: Song) {
    loaded.value = false
    issue.value = ''
    notice.value = ''
    created.value = null
    let stored: unknown = null
    try {
      stored = await readLayout(next.id)
    } catch {
      issue.value = '无法读取本机歌词编辑记录。'
    }
    if (stored) {
      const layout = normalizeLayout(next, stored)
      if (layout) {
        adopt(layout)
      } else {
        issue.value = '保存的歌词与这首歌的乐句位置不符，已回到原始分句。'
        adopt(createLayout(next))
      }
    } else {
      adopt(createLayout(next))
    }
    loaded.value = true
  }

  /** Drop custom text and return to the song's own segmentation. */
  function resetLyrics() {
    return apply('reset', resetLayout(state.value, song.value), '已回到这首歌最初的分句。')
  }

  function split(slotId: string, at: number) {
    return apply('split', splitSlot(state.value, slotId, at), '已拆开这一句，后半句可以拿去交换。')
  }

  function exchange(aId: string, bId: string) {
    return apply('exchange', exchangeSlots(state.value, aId, bId), '已交换两处同长片段的文字。')
  }

  function rewrite(slotId: string, text: string) {
    return apply('rewrite', rewriteSlot(state.value, slotId, text), '已改写这一句的文字。')
  }

  /** Undo also restores the spot the undone edit was made at, when it survives. */
  function undo() {
    const previous = state.value.past.at(-1)
    if (!previous) return false
    const anchor = selected.value?.start
    state.value = { layout: previous, past: state.value.past.slice(0, -1) }
    lastEdit.value = null
    created.value = null
    keepSelection(anchor)
    notice.value = '已撤销最近一次歌词编辑。'
    issue.value = ''
    persist(previous)
    return true
  }

  watch(() => song.value.id, () => { void loadFor(song.value) })
  onMounted(() => { void loadFor(song.value) })

  return {
    phrases, words, slots, selected, active, upcoming, lineProgress, swapPartners,
    loaded, issue, notice, created, lastEdit, canUndo,
    select, adjacent, loadFor, split, exchange, rewrite, resetLyrics, undo,
  }
}
