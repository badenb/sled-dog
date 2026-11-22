<script setup lang="ts">
import { TICKET_STATUSES, type Envelope, type Ticket } from '#shared/contract'

const { data: me } = await useMe()
const { data, refresh, error } = await useFetch<Envelope<Ticket[]>>('/api/tickets', { query: { limit: 200 } })
const tickets = computed(() => data.value?.data ?? [])
const byStatus = (status: string) => tickets.value.filter(t => t.status === status)

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

  <div class="board">
    <section v-for="status in TICKET_STATUSES" :key="status" class="col">
      <h2><span class="dot" :style="{ background: `var(--s-${status})` }" />{{ label(status) }} <span class="muted">{{ byStatus(status).length }}</span></h2>
      <article v-for="t in byStatus(status)" :key="t.id" class="card">
        <div class="id">{{ t.id }}</div>
        <div>{{ t.title }}</div>
        <div class="meta"><span v-if="t.priority !== 'none'">{{ t.priority }}</span><span v-if="t.assignee">@{{ t.assignee }}</span></div>
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
