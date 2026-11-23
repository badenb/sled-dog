<script setup lang="ts">
import { TICKET_STATUSES, type Envelope, type Ticket } from '#shared/contract'
import { byRecent, moveTicket, revertMove } from '#shared/board'

const WORKING = TICKET_STATUSES.filter(s => s !== 'canceled')

const sheet = useTicketSheet()

const { data: me } = await useMe()
const toast = useToast()
const { data, refresh, error } = await useFetch<Envelope<Ticket[]>>('/api/tickets', { key: 'tickets', query: { limit: 200 } })

// Local copy so a drag can update the board instantly; re-synced whenever the server data reloads.
const tickets = ref<Ticket[]>([])
watch(data, v => { tickets.value = v?.data ?? [] }, { immediate: true })
const byStatus = (status: string) => tickets.value.filter(t => t.status === status).sort(byRecent)

// The board asks for at most 200 tickets. If there are more, say so instead of letting a full page look like everything.
const truncated = computed(() => !!data.value?.meta?.truncated)
const totalTickets = computed(() => Number(data.value?.meta?.total ?? tickets.value.length))

// Finished tickets leave the board after a while: say when, and where they went.
const { data: archivedData } = await useFetch<Envelope<Ticket[]>>('/api/tickets', { key: 'archived-count', query: { archived: 'only', limit: 1 } })
const archivedCount = computed(() => Number(archivedData.value?.meta?.total ?? 0))
const { data: archiveRule } = await useFetch<Envelope<{ summary: string }>>('/api/settings/archive', { key: 'archive-setting' })

const canMove = computed(() => !!me.value?.can['ticket:update'])
const dragging = ref<string | null>(null)
const over = ref<string | null>(null)
const moving = ref(new Set<string>()) // tickets with a move in flight: ignore further moves until it settles
const showCanceled = ref(false)

async function move(id: string, status: Ticket['status']) {
  if (!canMove.value || moving.value.has(id)) return
  const result = moveTicket(tickets.value, id, status)
  if (!result) return
  tickets.value = result.list
  moving.value = new Set(moving.value).add(id)
  try {
    const res = await $fetch<Envelope<Ticket>>(`/api/tickets/${id}`, { method: 'PATCH', body: { status } })
    // The PATCH response has no linked PRs, so keep the ones we already have.
    tickets.value = tickets.value.map(t => (t.id === id ? { ...res.data, pullRequests: t.pullRequests } : t))
  } catch (e: any) {
    tickets.value = revertMove(tickets.value, id, result.previous)
    toast.push(`Could not move ${id}: ${e?.data?.statusMessage || 'the server refused'}`, 'error')
  } finally {
    const next = new Set(moving.value)
    next.delete(id)
    moving.value = next
  }
}

function onDragStart(event: DragEvent, id: string) {
  dragging.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onDrop(status: Ticket['status']) {
  const id = dragging.value
  dragging.value = over.value = null
  if (id) move(id, status)
}
const dropProps = (status: Ticket['status']) => ({
  onDragover: (e: DragEvent) => { if (canMove.value) { e.preventDefault(); over.value = status } },
  onDragleave: () => { if (over.value === status) over.value = null },
  onDrop: (e: DragEvent) => { e.preventDefault(); if (canMove.value) onDrop(status) },
})

const title = ref('')
const priority = ref('none')
const saving = ref(false)
const createError = ref('')

async function create() {
  if (!title.value.trim()) return
  saving.value = true
  createError.value = ''
  try {
    await $fetch('/api/tickets', { method: 'POST', body: { title: title.value, priority: priority.value } })
    title.value = ''
    await refresh()
  } catch (e: any) {
    createError.value = e?.data?.statusMessage || 'Could not create ticket'
  } finally {
    saving.value = false
  }
}
const label = (s: string) => s.replace('_', ' ')
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Tickets</h1>
      <p class="muted small">{{ tickets.length }} total · {{ byStatus('in_review').length }} in review · {{ byStatus('in_progress').length }} in progress</p>
    </div>
    <NuxtLink class="archive-link" :to="{ path: '/search', query: { archived: 'only' } }" :title="`Finished tickets leave the board after ${archiveRule?.data.summary ?? 'a while'}`">
      <span aria-hidden="true">📦</span> Archive <span class="count-pill">{{ archivedCount }}</span>
    </NuxtLink>
  </div>

  <form v-if="me?.can['ticket:create']" class="quick-add" @submit.prevent="create">
    <input v-model="title" placeholder="Add a ticket… press Enter" aria-label="Ticket title" maxlength="200">
    <select v-model="priority" aria-label="Priority">
      <option v-for="p in ['none', 'low', 'medium', 'high', 'urgent']" :key="p" :value="p">{{ p === 'none' ? 'No priority' : p }}</option>
    </select>
    <button class="primary" :disabled="saving || !title.trim()">Add</button>
  </form>
  <p v-if="createError" class="error">{{ createError }}</p>
  <p v-if="error" class="notice">Could not load tickets.</p>
  <p v-if="truncated" class="notice" role="status">Showing the {{ tickets.length }} most recently updated of {{ totalTickets }} tickets. Older ones are hidden. Archive finished work to make room.</p>

  <div class="board">
    <section v-for="status in WORKING" :key="status" :class="['col', { over: over === status && canMove }]" v-bind="dropProps(status)">
      <div class="col-head"><span class="dot" :style="{ background: `var(--s-${status})` }" />{{ label(status) }}<span class="count">{{ byStatus(status).length }}</span></div>
      <div class="cards">
        <TicketCard
          v-for="t in byStatus(status)" :key="t.id" :ticket="t" :movable="canMove" :dragging="dragging === t.id" :moving="moving.has(t.id)"
          @dragstart="onDragStart($event, t.id)" @dragend="dragging = over = null" @move="move(t.id, $event)" @open="sheet.open(t.id, $event)"
        />
        <div v-if="!byStatus(status).length" class="empty">{{ canMove ? 'Drop a ticket here' : 'Nothing here' }}</div>
      </div>
      <p v-if="status === 'done'" class="col-note muted small">
        Archived after {{ archiveRule?.data.summary ?? '…' }}.
        <NuxtLink v-if="me?.can['team:manage']" to="/settings/archive">Change</NuxtLink>
      </p>
    </section>
  </div>

  <div :class="['cancel-bar', { over: over === 'canceled' && canMove }]" v-bind="dropProps('canceled')">
    <button class="ghost" :aria-expanded="showCanceled" @click="showCanceled = !showCanceled">
      <span class="dot" style="width: 8px; height: 8px; border-radius: 50%; background: var(--s-canceled)" />
      Canceled · {{ byStatus('canceled').length }}
      <span class="muted small">{{ canMove ? '· drop here to cancel' : '' }}</span>
      <span style="margin-left: auto" aria-hidden="true">{{ showCanceled ? '▾' : '▸' }}</span>
    </button>
    <div v-if="showCanceled" class="cards">
      <TicketCard
        v-for="t in byStatus('canceled')" :key="t.id" :ticket="t" :movable="canMove" :dragging="dragging === t.id" :moving="moving.has(t.id)"
        @dragstart="onDragStart($event, t.id)" @dragend="dragging = over = null" @move="move(t.id, $event)" @open="sheet.open(t.id, $event)"
      />
      <div v-if="!byStatus('canceled').length" class="empty">No canceled tickets</div>
    </div>
  </div>
</template>
