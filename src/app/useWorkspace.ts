import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { songs, useTransport } from '../features/playback'
import { useLyrics } from '../features/lyrics'
import { useCapture } from '../features/capture'
import { usePitch } from '../features/pitch'
import { useReview } from '../features/review'
import type { Song } from '../shared/document'

export function useWorkspace() {
  const transport = useTransport(songs[0], {
    beforeSeek: finishCapture, onPause: finishCapture, onLoop: finishCapture,
  })
  const lyrics = useLyrics(transport.song, transport.position)
  const pitch = usePitch()
  const review = useReview(transport.song, lyrics.selected, lyrics.words, () => {
    capture.cancelRequest()
    transport.pause()
  })
  const capture = useCapture({
    onFrame: pitch.receive,
    position: transport.read,
    onComplete: async result => {
      await review.save({
        ...result, id: crypto.randomUUID(), createdAt: Date.now(), pitch: pitch.slice(result),
      })
    },
  })
  const graphRange = computed(() => {
    // Replaying an old take shows the graph where that take was really sung,
    // so a recording made at another place is not drawn off-screen.
    const replay = review.playing.value
    if (replay) return { start: replay.take.start, end: replay.take.end }
    if (!transport.isPlaying.value || capture.status.value === 'recording') {
      return lyrics.selected.value ?? { start: 0, end: transport.song.value.duration }
    }
    return lyrics.active.value ?? lyrics.upcoming.value ?? lyrics.selected.value ?? { start: 0, end: transport.song.value.duration }
  })
  const graphPosition = computed(() => review.position.value ?? transport.position.value)

  function finishCapture(position: number): void { void capture.stop(position) }

  /**
   * An edit changes who owns the words, never where a phrase sits. An active
   * single-phrase loop simply follows the phrase that is selected now, so the
   * cycle and the pitch graph stay on current phrase positions.
   */
  function afterEdit(changed: boolean) {
    if (!changed) return
    capture.cancelRequest()
    review.stop()
    if (transport.loop.value) transport.loop.value = lyrics.selected.value
  }

  function selectLine(id: string) {
    const line = lyrics.select(id)
    if (!line) return
    capture.cancelRequest()
    review.stop()
    if (transport.loop.value) transport.loop.value = line
    transport.seek(line.start)
  }

  function adjacent(direction: -1 | 1) {
    const line = lyrics.adjacent(direction)
    if (line) selectLine(line.id)
  }

  function selectSong(song: Song) {
    if (song.id === transport.song.value.id) return
    capture.cancelRequest()
    review.stop()
    transport.setSong(song)
    transport.loop.value = null
  }

  function seek(position: number) {
    capture.cancelRequest()
    review.stop()
    const loop = transport.loop.value
    if (loop && (position < loop.start || position >= loop.end)) transport.loop.value = null
    transport.seek(position)
  }

  function toggleLoop() {
    if (transport.loop.value) {
      transport.loop.value = null
      return
    }
    const line = lyrics.selected.value
    if (!line) return
    transport.loop.value = line
    selectLine(line.id)
  }

  function togglePlay() {
    capture.cancelRequest()
    review.stop()
    if (transport.isPlaying.value) transport.pause()
    else void transport.play()
  }

  function toggleRecording() {
    if (capture.status.value === 'recording') {
      finishCapture(transport.read())
      return
    }
    if (capture.status.value === 'requesting') {
      capture.cancelRequest()
      return
    }
    const line = lyrics.selected.value
    if (!line || capture.status.value !== 'idle') return
    review.stop()
    transport.pause()
    pitch.clear()
    void capture.start({
      songId: transport.song.value.id, lineId: line.id, range: line,
      wordId: line.wordId, wordText: line.text,
    }, () => {
      transport.seek(line.start)
      return transport.play()
    })
  }

  function splitAt(at: number): boolean {
    const line = lyrics.selected.value
    if (!line) return false
    const changed = lyrics.split(line.id, at)
    afterEdit(changed)
    return changed
  }

  function rewriteSelected(text: string): boolean {
    const line = lyrics.selected.value
    if (!line) return false
    const changed = lyrics.rewrite(line.id, text)
    afterEdit(changed)
    return changed
  }

  function exchangeWith(otherId: string): boolean {
    const line = lyrics.selected.value
    if (!line) return false
    const changed = lyrics.exchange(line.id, otherId)
    afterEdit(changed)
    return changed
  }

  function undoEdit(): boolean {
    const changed = lyrics.undo()
    afterEdit(changed)
    return changed
  }

  function resetLyrics(): boolean {
    const changed = lyrics.resetLyrics()
    afterEdit(changed)
    return changed
  }

  watch(transport.position, position => {
    const line = lyrics.selected.value
    if (line && position >= line.end) finishCapture(line.end)
  })

  // Switching songs rebuilds the phrase list asynchronously; pick a fresh loop point.
  watch(() => transport.song.value.id, () => { transport.loop.value = null })

  function handleVisibility() {
    if (!document.hidden) return
    capture.cancelRequest()
    transport.pause()
  }
  onMounted(() => document.addEventListener('visibilitychange', handleVisibility))
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', handleVisibility))

  return {
    transport, lyrics, pitch, review, capture, graphRange, graphPosition,
    selectLine, adjacent, selectSong, seek, toggleLoop, togglePlay, toggleRecording,
    splitAt, rewriteSelected, exchangeWith, undoEdit, resetLyrics,
  }
}
