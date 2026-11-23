<script setup lang="ts">
import { TICKET_PRIORITIES, TICKET_STATUSES, type Envelope, type Member, type Subtask, type Team, type Ticket, type TicketDetail, type Step } from '#shared/contract'
import { trailProgress } from '#shared/trail'

export interface OriginRect { left: number, top: number, width: number, height: number }
const props = defineProps<{ id: string, from: OriginRect | null }>()
const emit = defineEmits<{ close: [], changed: [] }>()

const { data: me } = useMe() // already cached by the page, so this does not refetch
const toast = useToast()
const dialog = ref<HTMLDialogElement>()
const sheet = ref<HTMLElement>()
const titleEl = ref<HTMLTextAreaElement>()
// A title can be long; a textarea that grows with its content wraps instead of clipping.
const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }

const detail = ref<TicketDetail | null>(null)
const members = ref<Member[]>([])
const teams = ref<Team[]>([])
const loadError = ref('')
watch(() => detail.value?.id, async () => { await nextTick(); if (titleEl.value) grow(titleEl.value) })

const canTicket = computed(() => !!me.value?.can['ticket:update'])
const progress = computed(() => trailProgress(detail.value?.steps ?? []))
const label = (s: string) => s.replace('_', ' ')
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

async function load() {
  try {
    const [t, m, tm] = await Promise.all([
      $fetch<Envelope<TicketDetail>>(`/api/tickets/${props.id}`),
      $fetch<Envelope<Member[]>>('/api/members'),
      $fetch<Envelope<Team[]>>('/api/teams'),
    ])
    detail.value = t.data; members.value = m.data; teams.value = tm.data
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage || 'Could not load this ticket'
  }
}

// The sheet unfolds from the card you clicked (FLIP), or fades up when opened from a link.
function playOpen() {
  const el = sheet.value
  if (!el || reduceMotion()) return
  const to = el.getBoundingClientRect()
  const f = props.from
  const frames: Keyframe[] = f
    ? [
        { transformOrigin: 'top left', transform: `translate(${f.left - to.left}px, ${f.top - to.top}px) scale(${f.width / to.width}, ${f.height / to.height})`, opacity: 0.55, borderRadius: '10px' },
        { transformOrigin: 'top left', transform: 'none', opacity: 1, borderRadius: '18px' },
      ]
    : [{ transform: 'translateY(14px) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }]
  el.animate(frames, { duration: 360, easing: 'cubic-bezier(.2,.9,.25,1)' })
}

let closing = false
async function close() {
  if (closing) return
  closing = true
  if (sheet.value && !reduceMotion()) {
    await sheet.value.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.98)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' }).finished
  }
  dialog.value?.close()
  emit('close')
}
const onBackdrop = (e: MouseEvent) => { if (e.target === dialog.value) close() }

onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  playOpen()
  await load()
})

// ── ticket fields ──
async function patchTicket(body: Record<string, unknown>) {
  const before = detail.value!
  detail.value = { ...before, ...body } as TicketDetail
  try {
    const res = await $fetch<Envelope<Ticket>>(`/api/tickets/${props.id}`, { method: 'PATCH', body })
    detail.value = { ...detail.value!, ...res.data, steps: detail.value!.steps, subtasks: detail.value!.subtasks, pullRequests: detail.value!.pullRequests }
    emit('changed')
  } catch (e: any) {
    detail.value = before
    toast.push(e?.data?.statusMessage || 'Could not save the change', 'error')
  }
}
function saveTitle(e: Event) {
  const el = e.target as HTMLTextAreaElement
  const title = el.value.trim()
  if (!title) { el.value = detail.value!.title; return }
  if (title !== detail.value!.title) patchTicket({ title })
}
const editing = ref(false)
const bodyDraft = ref('')
function editBody() { bodyDraft.value = detail.value!.body; editing.value = true }
async function saveBody() { editing.value = false; if (bodyDraft.value !== detail.value!.body) await patchTicket({ body: bodyDraft.value }) }
function saveAssignee(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim().replace(/^@/, '')
  if (v !== (detail.value!.assignee ?? '')) patchTicket({ assignee: v || null })
}

// ── trail ──
const celebrating = ref(false)
function onSteps(steps: Step[]) { detail.value = { ...detail.value!, steps }; emit('changed') }
function onSubtasks(subtasks: Subtask[]) { detail.value = { ...detail.value!, subtasks }; emit('changed') }
function onTicketStatus(status: Ticket['status']) { if (detail.value && detail.value.status !== status) { detail.value = { ...detail.value, status }; emit('changed') } }
function celebrate() {
  if (reduceMotion()) return
  celebrating.value = true
  setTimeout(() => { celebrating.value = false }, 2400)
}
const paws = Array.from({ length: 14 }, (_, i) => ({ left: 6 + ((i * 67) % 88), delay: (i % 7) * 90, size: 16 + ((i * 5) % 14) }))
const canFinish = computed(() => progress.value.complete && canTicket.value && detail.value && !['done', 'canceled'].includes(detail.value.status))
</script>

<template>
  <dialog ref="dialog" class="modal" :aria-label="`Ticket ${id}`" @cancel.prevent="close" @click="onBackdrop">
    <div ref="sheet" class="sheet" tabindex="-1" autofocus>
      <header class="sheet-head">
        <span class="id">{{ id }}</span>
        <span v-if="detail" class="pill status-pill"><span class="dot" :style="{ background: `var(--s-${detail.status})` }" />{{ label(detail.status) }}</span>
        <button class="ghost sm close" aria-label="Close" @click="close">✕</button>
      </header>

      <div v-if="loadError" class="sheet-body"><p class="notice">{{ loadError }}</p></div>
      <div v-else-if="!detail" class="sheet-body"><p class="muted">Loading…</p></div>

      <div v-else class="sheet-body">
        <div class="sheet-main">
          <textarea v-if="canTicket" ref="titleEl" class="sheet-title" rows="1" :value="detail.title" maxlength="200" aria-label="Title" @input="grow($event.target as HTMLTextAreaElement)" @blur="saveTitle" @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()" />
          <h2 v-else class="sheet-title static">{{ detail.title }}</h2>

          <TicketTrail
            :ticket-id="id" :steps="detail.steps" :members="members" :teams="teams"
            :can-add="!!me?.can['step:create']" :can-edit="!!me?.can['step:update']" :can-delete="!!me?.can['step:delete']"
            @update:steps="onSteps" @complete="celebrate"
          />

          <TicketSubtasks
            :ticket-id="id" :subtasks="detail.subtasks" :can-edit="canTicket"
            @update:subtasks="onSubtasks" @ticket-status="onTicketStatus"
          />

          <div v-if="progress.complete" class="finish">
            <span><b>🏁 Trail complete.</b> <span class="muted">Every checkpoint is done.</span></span>
            <button v-if="canFinish" class="primary sm" @click="patchTicket({ status: 'done' })">Move to Done</button>
          </div>

          <section class="block">
            <div class="block-head"><h3>Description</h3><button v-if="canTicket && !editing" class="ghost sm" @click="editBody">Edit</button></div>
            <template v-if="editing">
              <textarea v-model="bodyDraft" class="body-edit" rows="7" placeholder="What is this, and why does it matter?" aria-label="Description" autofocus @keydown.meta.enter="saveBody" @keydown.ctrl.enter="saveBody" />
              <div class="inline"><button class="primary sm" @click="saveBody">Save</button><button class="ghost sm" @click="editing = false">Cancel</button><span class="muted small">⌘↵ to save</span></div>
            </template>
            <p v-else-if="detail.body" class="body">{{ detail.body }}</p>
            <p v-else class="muted">{{ canTicket ? 'No description yet. Click Edit to add one.' : 'No description.' }}</p>
          </section>

          <section v-if="detail.pullRequests?.length" class="block">
            <div class="block-head"><h3>Pull requests</h3></div>
            <a v-for="pr in detail.pullRequests" :key="pr.key" class="pr-row" :href="pr.url" target="_blank" rel="noopener noreferrer">
              <span :class="['pr', pr.draft ? 'draft' : pr.state]">#{{ pr.number }} {{ pr.draft ? 'Draft' : pr.state }}</span>
              <span class="pr-title">{{ pr.title }}</span>
              <span v-if="pr.checks !== 'none'" :class="['ci', pr.checks]">{{ { success: '✓ passing', failure: '✕ failing', pending: '● running' }[pr.checks] }}</span>
            </a>
          </section>
        </div>

        <aside class="sheet-side">
          <label class="field-label" for="m-status">Status</label>
          <select id="m-status" :value="detail.status" :disabled="!canTicket" @change="patchTicket({ status: ($event.target as HTMLSelectElement).value })">
            <option v-for="s in TICKET_STATUSES" :key="s" :value="s">{{ label(s) }}</option>
          </select>
          <label class="field-label" for="m-prio">Priority</label>
          <select id="m-prio" :value="detail.priority" :disabled="!canTicket" @change="patchTicket({ priority: ($event.target as HTMLSelectElement).value })">
            <option v-for="p in TICKET_PRIORITIES" :key="p" :value="p">{{ p === 'none' ? 'No priority' : p }}</option>
          </select>
          <label class="field-label" for="m-assignee">Assignee</label>
          <input id="m-assignee" :value="detail.assignee ?? ''" placeholder="login" :disabled="!canTicket" @blur="saveAssignee" @keydown.enter="($event.target as HTMLInputElement).blur()">
          <p class="muted small side-meta">Created by {{ detail.createdBy }}<br>Updated <ClientOnly>{{ timeAgo(detail.updatedAt) }}</ClientOnly></p>
        </aside>
      </div>

      <div v-if="celebrating" class="paws" aria-hidden="true">
        <span v-for="(p, i) in paws" :key="i" :style="{ left: `${p.left}%`, animationDelay: `${p.delay}ms`, fontSize: `${p.size}px` }">🐾</span>
      </div>
    </div>
  </dialog>
</template>
