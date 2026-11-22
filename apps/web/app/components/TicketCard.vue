<script setup lang="ts">
import { TICKET_STATUSES, type Ticket } from '#shared/contract'

defineProps<{ ticket: Ticket, movable: boolean, dragging: boolean, moving: boolean }>()
const emit = defineEmits<{ dragstart: [event: DragEvent], dragend: [], move: [status: Ticket['status']] }>()

const prLabel = (pr: NonNullable<Ticket['pullRequests']>[number]) => (pr.draft ? 'Draft' : { open: 'Open', merged: 'Merged', closed: 'Closed' }[pr.state])
const ci = { success: ['✓', 'checks passing'], failure: ['✕', 'checks failing'], pending: ['●', 'checks running'] } as const
const label = (s: string) => s.replace('_', ' ')
</script>

<template>
  <article
    :class="['card', { movable, dragging, moving }]" :draggable="movable && !moving"
    @dragstart="emit('dragstart', $event)" @dragend="emit('dragend')"
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
    <div class="title">{{ ticket.title }}</div>
    <div v-if="ticket.priority !== 'none' || ticket.pullRequests?.length || ticket.assignee" class="card-foot">
      <span v-if="ticket.priority !== 'none'" :class="['pill', ticket.priority]"><span class="dot" />{{ ticket.priority }}</span>
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
