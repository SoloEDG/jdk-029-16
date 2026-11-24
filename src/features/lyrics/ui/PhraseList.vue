<script setup lang="ts">
import { ArrowLeftRight, ListMusic, Play, Scissors } from '@lucide/vue'
import type { LyricPhrase } from '../lib/layout'
import { clockLabel } from '../../../shared/time'

defineProps<{
  lines: LyricPhrase[]
  selected: LyricPhrase | null
  active: LyricPhrase | null
  created: { head: string; tail: string } | null
}>()
const emit = defineEmits<{ select: [string] }>()
</script>

<template>
  <section class="phrase-list" aria-labelledby="phrases-heading">
    <h2 class="rail-title" id="phrases-heading"><ListMusic :size="17" /> 逐句歌词 <span class="mono">{{ lines.length }}</span></h2>
    <ol>
      <li v-for="(line, index) in lines" :key="line.id">
        <button class="phrase" :class="{
            chosen: selected?.id === line.id,
            sounding: active?.id === line.id,
            fresh: created?.head === line.id || created?.tail === line.id,
          }" :aria-pressed="selected?.id === line.id"
          :aria-current="active?.id === line.id ? 'true' : undefined" @click="emit('select', line.id)">
          <span class="phrase-index mono">
            <Play v-if="active?.id === line.id" :size="12" fill="currentColor" />
            <template v-else>{{ String(index + 1).padStart(2, '0') }}</template>
          </span>
          <span class="phrase-text">{{ line.text }}</span>
          <span class="phrase-marks mono">
            <span v-if="line.moved" class="phrase-flag moved" title="文字来自另一处"><ArrowLeftRight :size="11" />换</span>
            <span v-if="line.tail" class="phrase-flag tail" title="拆出的后半句"><Scissors :size="11" />半</span>
            <span class="phrase-time">{{ clockLabel(line.start) }}</span>
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>
