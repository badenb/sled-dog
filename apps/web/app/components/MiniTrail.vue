<script setup lang="ts">
import type { StepLite } from '#shared/contract'
import { trailProgress } from '#shared/trail'

const props = defineProps<{ steps: StepLite[] }>()
const progress = computed(() => trailProgress(props.steps))
</script>

<template>
  <div v-if="steps.length" class="mini-trail" role="img" :aria-label="`${progress.done} of ${progress.total} checkpoints done`" :title="steps.map(s => `${s.status === 'done' ? '✓' : '○'} ${s.title}`).join('\n')">
    <template v-for="(s, i) in steps" :key="s.id">
      <span v-if="i" :class="['seg', { done: steps[i - 1]!.status === 'done' }]" />
      <span :class="['pt', s.status, { current: s.id === progress.currentId }]" />
    </template>
    <span class="mini-count">{{ progress.complete ? '🏁' : `${progress.done}/${progress.total}` }}</span>
  </div>
</template>
