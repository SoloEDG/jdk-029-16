<script setup lang="ts">
import { computed } from 'vue'
import { MicVocal } from '@lucide/vue'
import type { LyricPhrase } from '../lib/layout'
import { clockLabel } from '../../../shared/time'

const props = defineProps<{
  selected: LyricPhrase | null
  active: LyricPhrase | null
  upcoming: LyricPhrase | null
  playing: boolean
  progress: number
}>()

/** The phrase the stage actually shows: the sounding one while playing, else the selection. */
const shown = computed(() => (props.playing ? props.active : props.selected) ?? props.selected)
</script>

<template>
  <section class="lyric-stage" aria-labelledby="stage-title">
    <div id="stage-title" class="panel-heading"><MicVocal :size="17" /> 当前歌词</div>
    <div class="lyric-display">
      <p v-if="active" class="lyric-hero" :style="{ '--sung': `${progress * 100}%` }">{{ active.text }}</p>
      <p v-else-if="playing" class="lyric-hero between">{{ upcoming ? '间奏' : '尾奏' }}</p>
      <p v-else class="lyric-hero idle">{{ selected?.text ?? '暂无歌词' }}</p>
      <p v-if="upcoming && (playing || upcoming.id !== selected?.id)" class="lyric-next">{{ upcoming.text }}</p>
      <p v-if="shown?.moved" class="lyric-note">
        <span class="mono">换自 {{ clockLabel(shown.origin.start, true) }}</span>
        <span>这一格的文字原本唱在别处</span>
      </p>
      <p v-else-if="shown?.tail" class="lyric-note">
        <span class="mono">拆句后半</span>
        <span>可与另一处同长片段交换</span>
      </p>
    </div>
  </section>
</template>
