<script setup lang="ts">
import { TICKET_STATUSES, type Envelope, type Subtask, type Ticket } from '#shared/contract'

const props = defineProps<{ ticketId: string, subtasks: Subtask[], canEdit: boolean }>()
const emit = defineEmits<{ 'update:subtasks': [list: Subtask[]], ticketStatus: [status: Ticket['status']] }>()
const toast = useToast()

const base = computed(() => `/api/tickets/${props.ticketId}/subtasks`)
const label = (s: string) => s.replace('_', ' ')
const set = (next: Subtask[]) => emit('update:subtasks', next)
const fail = (e: any, fallback: string) => toast.push(e?.data?.statusMessage || fallback, 'error')
const reached = computed(() => props.subtasks.filter(s => ['in_review', 'test', 'done'].includes(s.status)).length)

// Changing a subtask can carry the parent forward; the response says where the ticket ended up.
async function patch(sub: Subtask, body: Record<string, unknown>) {
  const before = props.subtasks
  set(props.subtasks.map(s => (s.id === sub.id ? { ...s, ...body } as Subtask : s)))
  try {
    const res = await $fetch<Envelope<Subtask> & { meta: { ticketStatus?: Ticket['status'] } }>(`${base.value}/${sub.number}`, { method: 'PATCH', body })
    set(props.subtasks.map(s => (s.id === sub.id ? res.data : s)))
    if (res.meta.ticketStatus) emit('ticketStatus', res.meta.ticketStatus)
  } catch (e) { set(before); fail(e, 'Could not save the subtask') }
}
function rename(sub: Subtask, e: Event) {
  const el = e.target as HTMLInputElement
  const title = el.value.trim()
  if (!title) { el.value = sub.title; return }
  if (title !== sub.title) patch(sub, { title })
}
function reassign(sub: Subtask, e: Event) {
  const v = (e.target as HTMLInputElement).value.trim().replace(/^@/, '')
  if (v !== (sub.assignee ?? '')) patch(sub, { assignee: v || null })
}

const draft = ref('')
const adding = ref(false)
async function add() {
  const title = draft.value.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    const res = await $fetch<Envelope<Subtask>>(base.value, { method: 'POST', body: { title } })
    set([...props.subtasks, res.data])
    draft.value = ''
  } catch (e) { fail(e, 'Could not add the subtask') } finally { adding.value = false }
}
async function remove(sub: Subtask) {
  if (!confirm(`Remove ${sub.ref}? ${sub.pullRequests.length ? 'Its linked pull requests stay on GitHub.' : ''}`)) return
  const before = props.subtasks
  set(props.subtasks.filter(s => s.id !== sub.id))
  try {
    const res = await $fetch<Envelope<unknown> & { meta: { ticketStatus?: Ticket['status'] } }>(`${base.value}/${sub.number}`, { method: 'DELETE' })
    if (res.meta.ticketStatus) emit('ticketStatus', res.meta.ticketStatus)
  } catch (e) { set(before); fail(e, 'Could not remove the subtask') }
}
async function copy(ref: string) {
  try { await navigator.clipboard.writeText(ref); toast.push(`Copied ${ref}. Put it in a branch name or PR title to link the PR.`) } catch { toast.push(`Use ${ref} in a branch name or PR title`) }
}
const ci = { success: '✓', failure: '✕', pending: '●' } as const
const prLabel = (pr: Subtask['pullRequests'][number]) => (pr.draft ? 'Draft' : { open: 'Open', merged: 'Merged', closed: 'Closed' }[pr.state])
</script>

<template>
  <section v-if="subtasks.length || canEdit" class="block subtasks">
    <div class="block-head">
      <h3>Subtasks</h3>
      <span v-if="subtasks.length" class="muted small">{{ reached }} of {{ subtasks.length }} in review or beyond</span>
    </div>
    <p v-if="canEdit" class="muted small hint">
      Split work that needs several pull requests. Name a branch <code>{{ ticketId }}.1-…</code> to link it to subtask 1. The ticket follows its subtasks: it reaches <b>In review</b> only when every subtask has.
    </p>

    <ul v-if="subtasks.length" class="subs">
      <li v-for="s in subtasks" :key="s.id" class="sub">
        <button class="ref" :title="`Copy ${s.ref}`" @click="copy(s.ref)">{{ s.ref }}</button>
        <input v-if="canEdit" class="sub-title" :value="s.title" maxlength="200" aria-label="Subtask title" @blur="rename(s, $event)" @keydown.enter="($event.target as HTMLInputElement).blur()">
        <span v-else class="sub-title static">{{ s.title }}</span>
        <label class="sub-status"><span class="dot" :style="{ background: `var(--s-${s.status})` }" />
          <select :value="s.status" :disabled="!canEdit" :aria-label="`${s.ref} status`" @change="patch(s, { status: ($event.target as HTMLSelectElement).value })">
            <option v-for="st in TICKET_STATUSES" :key="st" :value="st">{{ label(st) }}</option>
          </select>
        </label>
        <input v-if="canEdit" class="sub-assignee" :value="s.assignee ?? ''" placeholder="@login" aria-label="Assignee" @blur="reassign(s, $event)" @keydown.enter="($event.target as HTMLInputElement).blur()">
        <Avatar v-else-if="s.assignee" :name="s.assignee" :size="22" />
        <button v-if="canEdit" class="ghost sm icon danger sub-del" :aria-label="`Remove ${s.ref}`" @click="remove(s)">✕</button>
        <div v-if="s.pullRequests.length" class="sub-prs">
          <a v-for="pr in s.pullRequests" :key="pr.key" :href="pr.url" target="_blank" rel="noopener noreferrer" :class="['pr', pr.draft ? 'draft' : pr.state]" :title="`${pr.repo}#${pr.number}: ${pr.title}`">
            #{{ pr.number }} {{ prLabel(pr) }}<span v-if="pr.checks !== 'none'" :class="['ci', pr.checks]" aria-hidden="true">{{ ci[pr.checks] }}</span>
          </a>
        </div>
      </li>
    </ul>

    <form v-if="canEdit" class="inline" style="margin-top: 10px" @submit.prevent="add">
      <input v-model="draft" placeholder="Add a subtask, e.g. API changes" maxlength="200" aria-label="New subtask">
      <button :disabled="adding || !draft.trim()">Add subtask</button>
    </form>
  </section>
</template>
