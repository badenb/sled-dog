<script setup lang="ts">
import { TICKET_STATUSES, type Envelope, type Ticket } from '#shared/contract'
import { byRecent, moveTicket, revertMove } from '#shared/board'

const { data: me } = await useMe()
const { data, refresh, error } = await useFetch<Envelope<Ticket[]>>('/api/tickets', { query: { limit: 200 } })
// Local copy so a drag can update the board instantly; re-synced whenever the server data reloads.
const tickets = ref<Ticket[]>([])
watch(data, v => { tickets.value = v?.data ?? [] }, { immediate: true })
const byStatus = (status: string) => tickets.value.filter(t => t.status === status).sort(byRecent)

const canMove = computed(() => !!me.value?.can['ticket:update'])
const dragging = ref<string | null>(null)
const over = ref<string | null>(null)
const moving = ref(new Set<string>()) // tickets with a move in flight: ignore further moves until it settles
const moveError = ref('')

async function move(id: string, status: Ticket['status']) {
  if (!canMove.value || moving.value.has(id)) return
  const result = moveTicket(tickets.value, id, status)
  if (!result) return
  moveError.value = ''
  tickets.value = result.list
  moving.value = new Set(moving.value).add(id)
  try {
    const res = await $fetch<Envelope<Ticket>>(`/api/tickets/${id}`, { method: 'PATCH', body: { status } })
    // The PATCH response has no linked PRs, so keep the ones we already have.
    tickets.value = tickets.value.map(t => (t.id === id ? { ...res.data, pullRequests: t.pullRequests } : t))
  } catch (e: any) {
    tickets.value = revertMove(tickets.value, id, result.previous)
    moveError.value = `Could not move ${id}: ${e?.data?.statusMessage || 'the server refused'}`
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
  <form v-if="me?.can['ticket:create']" class="create" @submit.prevent="create">
    <input v-model="title" placeholder="New ticket title…" aria-label="Ticket title" maxlength="200">
    <select v-model="priority" aria-label="Priority">
      <option v-for="p in ['none', 'low', 'medium', 'high', 'urgent']" :key="p" :value="p">{{ p }}</option>
    </select>
    <button class="primary" :disabled="saving || !title.trim()">Create</button>
  </form>
  <p v-if="createError" class="error">{{ createError }}</p>
  <p v-if="error" class="error">Could not load tickets.</p>
  <p v-if="moveError" class="error" role="alert">{{ moveError }}</p>

  <div class="board">
    <section
      v-for="status in TICKET_STATUSES" :key="status" :class="['col', { over: over === status && canMove }]"
      @dragover.prevent="canMove && (over = status)" @dragleave="over === status && (over = null)" @drop.prevent="canMove && onDrop(status)"
    >
      <h2><span class="dot" :style="{ background: `var(--s-${status})` }" />{{ label(status) }} <span class="muted">{{ byStatus(status).length }}</span></h2>
      <article
        v-for="t in byStatus(status)" :key="t.id" :class="['card', { movable: canMove, dragging: dragging === t.id, moving: moving.has(t.id) }]"
        :draggable="canMove && !moving.has(t.id)" @dragstart="onDragStart($event, t.id)" @dragend="dragging = over = null"
      >
        <div class="id">{{ t.id }}</div>
        <div>{{ t.title }}</div>
        <div class="meta"><span v-if="t.priority !== 'none'">{{ t.priority }}</span><span v-if="t.assignee">@{{ t.assignee }}</span></div>
        <select v-if="canMove" class="move" :value="t.status" :disabled="moving.has(t.id)" :aria-label="`Move ${t.id} to…`" @change="move(t.id, ($event.target as HTMLSelectElement).value as Ticket['status'])">
          <option v-for="s in TICKET_STATUSES" :key="s" :value="s">{{ label(s) }}</option>
        </select>
        <div v-if="t.pullRequests?.length" class="prs">
          <a v-for="pr in t.pullRequests" :key="pr.key" :href="pr.url" target="_blank" rel="noopener noreferrer" :class="['pr', pr.draft ? 'draft' : pr.state]" :title="`${pr.repo}#${pr.number}: ${pr.title}`">
            #{{ pr.number }} {{ pr.draft ? 'draft' : pr.state }}<span v-if="pr.checks !== 'none'" :class="['ci', pr.checks]"> {{ { success: '✓', failure: '✗', pending: '…' }[pr.checks] }}</span>
          </a>
        </div>
      </article>
      <p v-if="!byStatus(status).length" class="muted">Empty</p>
    </section>
  </div>
</template>
