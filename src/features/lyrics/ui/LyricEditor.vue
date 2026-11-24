<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeftRight, PencilLine, RotateCcw, Scissors, Undo2 } from '@lucide/vue'
import type { LyricPhrase } from '../lib/layout'
import { clockLabel } from '../../../shared/time'

const props = defineProps<{
  selected: LyricPhrase | null
  partners: LyricPhrase[]
  canUndo: boolean
  issue: string
  notice: string
}>()
const emit = defineEmits<{
  split: [number]
  rewrite: [string]
  exchange: [string]
  undo: []
  reset: []
}>()

const at = ref(1)
const draft = ref('')
const partner = ref('')
/** Only the user's typing should count as a rewrite draft change. */
const edited = ref(false)

const head = computed(() => props.selected?.text.slice(0, at.value) ?? '')
const tail = computed(() => props.selected?.text.slice(at.value) ?? '')

watch([() => props.selected?.id, () => props.selected?.wordId], () => {
  const text = props.selected?.text ?? ''
  at.value = Math.max(1, Math.floor(text.length / 2))
  draft.value = text
  edited.value = false
  partner.value = props.partners[0]?.id ?? ''
}, { immediate: true })

watch(() => props.partners, list => {
  if (!list.some(entry => entry.id === partner.value)) partner.value = list[0]?.id ?? ''
})

const length = computed(() => {
  const line = props.selected
  return line ? (line.end - line.start).toFixed(2) : '0.00'
})
const canSplit = computed(() => (props.selected?.text.length ?? 0) >= 2)
const canRewrite = computed(() => Boolean(props.selected && edited.value
  && draft.value.trim() && draft.value.trim() !== props.selected?.text))
const canExchange = computed(() => Boolean(props.selected && partner.value && props.partners.length))
</script>

<template>
  <section class="editor" aria-labelledby="editor-title">
    <div class="editor-heading">
      <h2 id="editor-title" class="panel-heading"><Scissors :size="17" /> 编辑这一句</h2>
      <div class="editor-actions">
        <button class="ghost-button" :disabled="!canUndo" @click="emit('undo')"><Undo2 :size="13" /> 撤销</button>
        <button class="ghost-button" @click="emit('reset')"><RotateCcw :size="13" /> 还原分句</button>
      </div>
    </div>

    <div v-if="!selected" class="editor-empty">先在左侧选一句歌词。</div>
    <template v-else>
      <p class="editor-meta mono">
        第 {{ clockLabel(selected.start, true) }}–{{ clockLabel(selected.end, true) }} 秒 · {{ length }} 秒
        <span v-if="selected.moved" class="editor-origin">文字生于 {{ clockLabel(selected.origin.start, true) }}</span>
        <span v-else-if="selected.tail" class="editor-origin">拆出的后半句</span>
      </p>

      <fieldset class="edit-block">
        <legend><Scissors :size="13" /> 拆分（按字数等分时长）</legend>
        <p class="edit-readout" aria-live="polite">
          <span class="frag">{{ head || '（空）' }}</span><span class="cut">｜</span><span class="frag tail">{{ tail || '（空）' }}</span>
        </p>
        <div class="edit-row">
          <input aria-label="拆分位置（字数）" type="range" min="1" :max="Math.max(1, selected.text.length - 1)"
            step="1" :value="at" :style="{ '--fill': `${100 * at / Math.max(1, selected.text.length)}%` }"
            :disabled="!canSplit" @input="at = Number(($event.target as HTMLInputElement).value)" />
          <button class="text-button" :disabled="!canSplit" @click="emit('split', at)">拆分</button>
        </div>
      </fieldset>

      <fieldset class="edit-block">
        <legend><PencilLine :size="13" /> 改词（原位）</legend>
        <div class="edit-row">
          <input class="text-input" aria-label="这一句的新文字" type="text" :value="draft" maxlength="40"
            @input="draft = ($event.target as HTMLInputElement).value; edited = true"
            @keydown.enter="canRewrite && emit('rewrite', draft)" />
          <button class="text-button" :disabled="!canRewrite" @click="emit('rewrite', draft)">改写</button>
        </div>
      </fieldset>

      <fieldset class="edit-block">
        <legend><ArrowLeftRight :size="13" /> 交换同长片段</legend>
        <div v-if="!partners.length" class="edit-hint">没有等长的可换片段。先拆分另一处长度相同的一句，再回来交换。</div>
        <div v-else class="edit-row">
          <select aria-label="选择要交换的等长片段" :value="partner" @change="partner = ($event.target as HTMLSelectElement).value">
            <option v-for="entry in partners" :key="entry.id" :value="entry.id">{{ entry.text }} · {{ clockLabel(entry.start, true) }}</option>
          </select>
          <button class="text-button" :disabled="!canExchange" @click="emit('exchange', partner)">交换</button>
        </div>
        <p v-if="partners.length" class="edit-hint">交换只改文字归属；乐句、循环与音高图的位置都保持原样。</p>
      </fieldset>

      <p v-if="issue" class="inline-error" role="alert">{{ issue }}</p>
      <p v-else-if="notice" class="edit-notice" role="status">{{ notice }}</p>
    </template>
  </section>
</template>
