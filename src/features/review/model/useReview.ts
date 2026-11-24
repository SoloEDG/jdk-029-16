import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { LyricPhrase, LyricWord, Song, Take } from '../../../shared/document'
import { readTakes, writeTake } from '../lib/archive'
import { takeViews, type TakeView } from '../lib/attach'

export function useReview(
  song: Ref<Song>,
  phrase: Ref<LyricPhrase | null>,
  words: Ref<LyricWord[]>,
  beforeListen: () => void,
) {
  const takes = shallowRef<Take[]>([])
  const ids = ref<[string | null, string | null]>([null, null])
  const playingId = ref<string | null>(null)
  const position = ref<number | null>(null)
  const issue = ref('')
  const player = new Audio()
  let source: string | null = null
  let current: Take | undefined
  let frame = 0

  const views = computed<TakeView[]>(() => {
    const target = phrase.value
    if (!target) return []
    const fragment = { wordId: target.wordId, start: target.start, end: target.end, origin: target.origin }
    return takeViews(takes.value.filter(take => take.songId === song.value.id), fragment, words.value)
  })
  const slots = computed(() => ids.value.map(id => views.value.find(view => view.take.id === id) ?? null))
  const playing = computed(() => views.value.find(view => view.take.id === playingId.value) ?? null)

  /** Replay from the recorded spot; the panel passes its view, so unwrap it. */
  function replay(view: TakeView) { return listen(view.take) }

  function stop() {
    player.pause()
    cancelAnimationFrame(frame)
    if (source) {
      player.removeAttribute('src')
      player.load()
      URL.revokeObjectURL(source)
      source = null
    }
    current = undefined
    playingId.value = null
    position.value = null
  }

  function tick() {
    if (!current || player.paused) return
    position.value = Math.min(current.end, current.start + player.currentTime)
    frame = requestAnimationFrame(tick)
  }

  /** Replay the whole recording from the spot it was actually sung at. */
  async function listen(take: Take) {
    const replay = playingId.value !== take.id
    stop()
    if (!replay) return
    beforeListen()
    issue.value = ''
    current = take
    playingId.value = take.id
    position.value = take.start
    source = URL.createObjectURL(take.audio)
    const ownUrl = source
    player.src = source
    try {
      await player.play()
      if (source === ownUrl) tick()
    } catch {
      if (source !== ownUrl) return
      stop()
      issue.value = '无法播放这条录音。'
    }
  }

  function choose(slot: 0 | 1, id: string) {
    const next = [...ids.value] as typeof ids.value
    const peer = slot === 0 ? 1 : 0
    if (id && next[peer] === id) next[peer] = null
    next[slot] = id || null
    ids.value = next
  }

  watch([() => song.value.id, () => phrase.value?.id], () => {
    stop()
    ids.value = [null, null]
    issue.value = ''
  })

  // A recording can leave the view after an edit; drop stale comparisons.
  watch(views, list => {
    const live = new Set(list.map(view => view.take.id))
    const [a, b] = ids.value
    if ((a && !live.has(a)) || (b && !live.has(b))) {
      ids.value = [a && live.has(a) ? a : null, b && live.has(b) ? b : null]
    }
    if (playingId.value && !live.has(playingId.value)) stop()
  })

  async function save(take: Take) {
    await writeTake(take)
    takes.value = [take, ...takes.value.filter(item => item.id !== take.id)]
    if (views.value.some(view => view.take.id === take.id)) {
      if (!ids.value[0]) choose(0, take.id)
      else if (!ids.value[1]) choose(1, take.id)
    }
  }

  onMounted(async () => {
    try {
      const stored = await readTakes()
      const known = new Set(takes.value.map(take => take.id))
      takes.value = [...takes.value, ...stored.filter(take => !known.has(take.id))]
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      issue.value = '无法读取本机练习记录。'
    }
  })

  player.addEventListener('ended', stop)
  onBeforeUnmount(() => { player.removeEventListener('ended', stop); stop() })
  return { views, slots, playing, playingId, position, issue, save, choose, listen, replay, stop }
}
