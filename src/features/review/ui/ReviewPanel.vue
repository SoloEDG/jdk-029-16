<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, GitCompareArrows, Headphones, History, Play, Square } from '@lucide/vue'
import type { GuideNote } from '../../../shared/document'
import { clockLabel } from '../../../shared/time'
import type { TakeView } from '../lib/attach'
import { compareKind, compareLabel, spanText } from '../lib/attach'
import { accuracy } from '../lib/summary'

const props = defineProps<{
  views: TakeView[]
  slots: (TakeView | null)[]
  playingId: string | null
  phrase: { text: string; start: number; end: number; origin: { start: number; end: number } } | null
  notes: GuideNote[]
  issue: string
}>()
const emit = defineEmits<{ listen: [TakeView]; choose: [0 | 1, string] }>()
const slotIndices = [0, 1] as const

const labels = computed(() => {
  const map = new Map<string, number>()
  ;[...props.views].sort((a, b) => a.take.createdAt - b.take.createdAt)
    .forEach((view, index) => map.set(view.take.id, index + 1))
  return map
})

const comparison = computed(() => {
  const [a, b] = props.slots
  if (!a || !b) return null
  const kind = compareKind(a.take, b.take)
  return { kind, label: compareLabel(kind) }
})

const at = (value: number) => clockLabel(value, true)

function score(view: TakeView) {
  return accuracy(view.take, props.notes)
}

function marksOf(view: TakeView) {
  const both = view.marks.includes('word') && view.marks.includes('time')
  if (both) return '原词·歌时'
  return view.marks.includes('word') ? '原词' : '歌时'
}
</script>

<template>
  <section class="review" aria-labelledby="review-title">
    <h2 class="rail-title" id="review-title"><Headphones :size="17" /> 练习回顾 <span class="mono">{{ views.length }}</span></h2>
    <div class="review-line">{{ phrase?.text ?? '未选择练习句' }}</div>
    <p class="review-hint">旧录音按当时完整唱过的位置整段复听。标「原词」的确认唱过这句文字；标「歌时」的只是与这格歌时相交。两者同时符合只出现一次。</p>
    <div v-if="!views.length" class="empty-takes"><AudioLines :size="23" /><span>本句暂无录音</span></div>
    <ol v-else class="take-list">
      <li v-for="view in views" :key="view.take.id" :class="{ active: playingId === view.take.id }">
        <button class="icon-button listen-button" :aria-label="`${playingId === view.take.id ? '停止' : '播放'}录音 ${labels.get(view.take.id)}`"
          @click="emit('listen', view)">
          <Square v-if="playingId === view.take.id" :size="13" fill="currentColor" /><Play v-else :size="13" fill="currentColor" />
        </button>
        <div class="take-info">
          <strong>录音 {{ labels.get(view.take.id) }}
            <span class="take-marks mono" :class="{ both: view.marks.length > 1 }">{{ marksOf(view) }}</span>
          </strong>
          <small class="mono">{{ clockLabel(view.take.start, true) }}–{{ clockLabel(view.take.end, true) }}
            <template v-if="view.wordCoverage"> · 原词唱到 {{ spanText(view.wordCoverage, at) }}</template>
            <template v-else-if="view.timeCoverage"> · 歌时唱到 {{ spanText(view.timeCoverage, at) }}</template>
          </small>
          <small v-if="view.text && view.text !== phrase?.text" class="take-text">当时文字：{{ view.text }}</small>
          <small v-else-if="view.elsewhere" class="take-text">在别处唱过这段文字</small>
        </div>
        <span class="mono take-score" title="检测到的音高中命中参考音的占比">{{ score(view) ?? '—' }}<template v-if="score(view) !== null">%</template></span>
      </li>
    </ol>
    <div v-if="views.length > 1" class="compare-tools">
      <p><GitCompareArrows :size="16" /> 音高对比</p>
      <label v-for="slot in slotIndices" :key="slot"><span :class="slot === 0 ? 'slot-a' : 'slot-b'">{{ slot === 0 ? 'A' : 'B' }}</span>
        <select :aria-label="slot === 0 ? '对比录音 A' : '对比录音 B'" :value="slots[slot]?.take.id ?? ''"
          @change="emit('choose', slot, ($event.target as HTMLSelectElement).value)">
          <option value="">未选择</option>
          <option v-for="view in views" :key="view.take.id" :value="view.take.id">录音 {{ labels.get(view.take.id) }}</option>
        </select>
      </label>
      <p v-if="comparison" class="compare-note"><History :size="13" /> {{ comparison.label }}</p>
    </div>
    <p v-if="issue" class="inline-error" role="alert">{{ issue }}</p>
  </section>
</template>
