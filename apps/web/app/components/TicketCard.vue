<script setup lang="ts">
import { TICKET_STATUSES, type Ticket } from '#shared/contract'
import { trailProgress } from '#shared/trail'

const props = defineProps<{ ticket: Ticket, movable: boolean, dragging: boolean, moving: boolean }>()
const emit = defineEmits<{ dragstart: [event: DragEvent], dragend: [], move: [status: Ticket['status']], open: [rect: DOMRect] }>()

const root = ref<HTMLElement>()
function open() { if (root.value) emit('open', root.value.getBoundingClientRect()) }
// Whole-card click for mouse users; the title button below is the keyboard path.
function onClick(e: MouseEvent) { if (!(e.target as HTMLElement).closest('select, a, button')) open() }
const trail = computed(() => trailProgress(props.ticket.steps ?? []))
const subs = computed(() => {
  const live = (props.ticket.subtasks ?? []).filter(s => s.status !== 'canceled')
  return { total: live.length, reached: live.filter(s => ['in_review', 'test', 'done'].includes(s.status)).length }
})

const prLabel = (pr: NonNullable<Ticket['pullRequests']>[number]) => (pr.draft ? 'Draft' : { open: 'Open', merged: 'Merged', closed: 'Closed' }[pr.state])
const ci = { success: ['✓', 'checks passing'], failure: ['✕', 'checks failing'], pending: ['●', 'checks running'] } as const
const label = (s: string) => s.replace('_', ' ')
</script>

<template>
  <article
    ref="root" :class="['card', { movable, dragging, moving }]" :draggable="movable && !moving"
    @dragstart="emit('dragstart', $event)" @dragend="emit('dragend')" @click="onClick"
  >
    <div class="card-top">
      <span class="id">{{ ticket.id }}</span>
      <select
        v-if="movable" class="move" :aria-label="`Move ${ticket.id} to a different status`" :disabled="moving" value=""
        @change="(e) => { const el = e.target as HTMLSelectElement; if (el.value) emit('move', el.value as Ticket['status']); el.value = '' }"
      >
        <option value="" disabled hidden>Move…</option>
        <option v-for="s in TICKET_STATUSES.filter(s => s !== ticket.status)" :key="s" :value="s">{{ label(s) }}</option>
      </select>
    </div>
    <button class="title" @click="open">{{ ticket.title }}</button>
    <MiniTrail v-if="ticket.steps?.length" :steps="ticket.steps" />
    <button v-if="trail.complete && movable && !['done', 'canceled'].includes(ticket.status)" class="nudge" @click="emit('move', 'done')">🏁 Trail complete · move to Done</button>
    <div v-if="ticket.priority !== 'none' || ticket.pullRequests?.length || ticket.assignee || subs.total" class="card-foot">
      <span v-if="ticket.priority !== 'none'" :class="['pill', ticket.priority]"><span class="dot" />{{ ticket.priority }}</span>
      <span v-if="subs.total" class="pill subs-pill" :title="`${subs.reached} of ${subs.total} subtasks are in review or beyond`">🧩 {{ subs.reached }}/{{ subs.total }}</span>
      <a
        v-for="pr in ticket.pullRequests" :key="pr.key" :href="pr.url" target="_blank" rel="noopener noreferrer"
        :class="['pr', pr.draft ? 'draft' : pr.state]" :title="`${pr.repo}#${pr.number}: ${pr.title}`"
      >
        #{{ pr.number }} {{ prLabel(pr) }}
        <span v-if="pr.checks !== 'none'" :class="['ci', pr.checks]" :title="ci[pr.checks][1]"><span aria-hidden="true">{{ ci[pr.checks][0] }}</span><span class="sr-only">{{ ci[pr.checks][1] }}</span></span>
      </a>
      <Avatar v-if="ticket.assignee" :name="ticket.assignee" />
    </div>
  </article>
</template>
