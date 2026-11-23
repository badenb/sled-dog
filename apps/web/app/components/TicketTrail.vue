<script setup lang="ts">
import type { Envelope, Member, Step, Team } from '#shared/contract'
import { PRESETS, reorder, trailProgress } from '#shared/trail'

const props = defineProps<{
  ticketId: string, steps: Step[], members: Member[], teams: Team[],
  canAdd: boolean, canEdit: boolean, canDelete: boolean,
}>()
const emit = defineEmits<{ 'update:steps': [steps: Step[]], complete: [] }>()
const toast = useToast()

const base = computed(() => `/api/tickets/${props.ticketId}/steps`)
const progress = computed(() => trailProgress(props.steps))
const set = (next: Step[]) => emit('update:steps', next)
const replace = (step: Step) => set(props.steps.map(s => (s.id === step.id ? step : s)))
const fail = (e: any, fallback: string) => toast.push(e?.data?.statusMessage || fallback, 'error')

// ── complete / reopen (optimistic; snaps back if the server refuses) ──
const busy = ref(new Set<number>())
async function toggle(step: Step) {
  if (!step.canComplete || busy.value.has(step.id)) return
  const was = progress.value.complete
  const status = step.status === 'done' ? 'todo' : 'done'
  const before = props.steps
  replace({ ...step, status })
  busy.value = new Set(busy.value).add(step.id)
  try {
    const res = await $fetch<Envelope<Step>>(`${base.value}/${step.id}`, { method: 'PATCH', body: { status } })
    replace(res.data)
    if (!was && trailProgress(props.steps).complete) emit('complete')
  } catch (e) {
    set(before)
    fail(e, 'Could not update the checkpoint')
  } finally {
    const next = new Set(busy.value); next.delete(step.id); busy.value = next
  }
}

// ── rename / assign ──
async function patch(step: Step, body: Record<string, unknown>, apply: Step) {
  const before = props.steps
  replace(apply)
  try { replace((await $fetch<Envelope<Step>>(`${base.value}/${step.id}`, { method: 'PATCH', body })).data) }
  catch (e) { set(before); fail(e, 'Could not save the change') }
}
function rename(step: Step, event: Event) {
  const el = event.target as HTMLInputElement
  const title = el.value.trim()
  if (!title) { el.value = step.title; return }
  if (title !== step.title) patch(step, { title }, { ...step, title })
}
const assignValue = (s: Step) => (s.team ? `team:${s.team.id}` : s.assignee ? `user:${s.assignee.id}` : '')
function assign(step: Step, event: Event) {
  const [kind, id] = (event.target as HTMLSelectElement).value.split(':')
  const team = kind === 'team' ? props.teams.find(t => t.id === id) ?? null : null
  const person = kind === 'user' ? props.members.find(m => m.id === id) ?? null : null
  patch(step, { teamId: team?.id ?? null, assigneeId: person?.id ?? null }, {
    ...step, team: team && { id: team.id, name: team.name }, assignee: person && { id: person.id, name: person.name },
  })
}

// ── add / remove ──
const draft = ref('')
const adding = ref(false)
async function add(title: string) {
  title = title.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    const res = await $fetch<Envelope<Step>>(base.value, { method: 'POST', body: { title } })
    set([...props.steps, res.data])
    draft.value = ''
  } catch (e) { fail(e, 'Could not add the checkpoint') } finally { adding.value = false }
}
async function remove(step: Step) {
  if (!confirm(`Remove the "${step.title}" checkpoint?`)) return
  const before = props.steps
  set(props.steps.filter(s => s.id !== step.id))
  try { await $fetch(`${base.value}/${step.id}`, { method: 'DELETE' }) } catch (e) { set(before); fail(e, 'Could not remove the checkpoint') }
}

// ── reorder: drag by the grip, or use the arrow buttons ──
const dragId = ref<number | null>(null)
const overId = ref<number | null>(null)
async function moveTo(id: number, index: number) {
  const next = reorder(props.steps, id, index)
  if (next === props.steps) return
  const before = props.steps
  set(next)
  try { set((await $fetch<Envelope<Step[]>>(`${base.value}/order`, { method: 'PUT', body: { order: next.map(s => s.id) } })).data) }
  catch (e) { set(before); fail(e, 'Could not reorder') }
}
function onGrip(event: DragEvent, step: Step) {
  dragId.value = step.id
  event.dataTransfer?.setData('text/plain', String(step.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  const row = (event.target as HTMLElement).closest('li')
  if (row && event.dataTransfer) event.dataTransfer.setDragImage(row, 16, 16)
}
function onDrop(index: number) {
  const id = dragId.value
  dragId.value = overId.value = null
  if (id !== null) moveTo(id, index)
}

const who = (s: Step) => s.team?.name ?? s.assignee?.name ?? ''
const sledLeft = computed(() => `${Math.min(100, Math.max(0, progress.value.percent))}%`)
</script>

<template>
  <section class="trail" aria-label="Trail">
    <div class="trail-head">
      <h3>The Trail</h3>
      <span class="muted small">{{ progress.total ? `${progress.done} of ${progress.total} checkpoints` : 'No checkpoints yet' }}</span>
    </div>

    <div v-if="progress.total" class="trail-bar" role="progressbar" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${progress.percent}% of checkpoints complete`">
      <div class="trail-fill" :style="{ width: sledLeft }" />
      <span class="sled" :style="{ left: sledLeft }" aria-hidden="true">🐕</span>
      <span class="flag" aria-hidden="true">🏁</span>
    </div>

    <ol v-if="steps.length" class="steps">
      <li
        v-for="(s, i) in steps" :key="s.id"
        :class="['step', s.status, { current: s.id === progress.currentId, dragging: dragId === s.id, over: overId === s.id && dragId !== s.id }]"
        @dragover.prevent="dragId !== null && (overId = s.id)" @dragleave="overId === s.id && (overId = null)" @drop.prevent="onDrop(i)"
      >
        <button
          class="node" :disabled="!s.canComplete || busy.has(s.id)" :aria-pressed="s.status === 'done'"
          :title="s.canComplete ? (s.status === 'done' ? 'Mark not done' : 'Mark done') : 'Only the assignee, their team, or an engineer can complete this'"
          :aria-label="`${s.status === 'done' ? 'Reopen' : 'Complete'} ${s.title}`" @click="toggle(s)"
        >
          <span v-if="s.status === 'done'" aria-hidden="true">✓</span>
          <span v-else-if="s.id === progress.currentId" class="pulse" aria-hidden="true" />
        </button>

        <div class="step-main">
          <input v-if="canEdit" class="step-title" :value="s.title" maxlength="120" :aria-label="`Checkpoint name`" @blur="rename(s, $event)" @keydown.enter="($event.target as HTMLInputElement).blur()">
          <span v-else class="step-title static">{{ s.title }}</span>
          <div v-if="s.status === 'done' && s.completedBy" class="muted small">Done by {{ s.completedBy }}<ClientOnly> · {{ s.completedAt ? timeAgo(s.completedAt) : '' }}</ClientOnly></div>
          <div v-else-if="s.id === progress.currentId" class="small here">You are here</div>
        </div>

        <div class="step-who">
          <select v-if="canEdit" class="who-select" :value="assignValue(s)" aria-label="Assign checkpoint" @change="assign(s, $event)">
            <option value="">Unassigned</option>
            <optgroup v-if="teams.length" label="Teams"><option v-for="t in teams" :key="t.id" :value="`team:${t.id}`">👥 {{ t.name }}</option></optgroup>
            <optgroup label="People"><option v-for="m in members" :key="m.id" :value="`user:${m.id}`">{{ m.name }}</option></optgroup>
          </select>
          <span v-else-if="who(s)" class="pill"><Avatar v-if="s.assignee && !s.team" :name="s.assignee.name" :size="16" />{{ s.team ? '👥 ' : '' }}{{ who(s) }}</span>
        </div>

        <div v-if="canEdit || canDelete" class="step-tools">
          <template v-if="canEdit">
            <button class="ghost sm icon" :disabled="i === 0" aria-label="Move up" @click="moveTo(s.id, i - 1)">↑</button>
            <button class="ghost sm icon" :disabled="i === steps.length - 1" aria-label="Move down" @click="moveTo(s.id, i + 1)">↓</button>
            <span class="grip" draggable="true" role="img" aria-label="Drag to reorder" title="Drag to reorder" @dragstart="onGrip($event, s)" @dragend="dragId = overId = null">⠿</span>
          </template>
          <button v-if="canDelete" class="ghost sm icon danger" :aria-label="`Remove ${s.title}`" @click="remove(s)">✕</button>
        </div>
      </li>
    </ol>
    <div v-else class="empty">{{ canAdd ? 'Break this work into checkpoints: design, copy, approvals, anything.' : 'No checkpoints on this ticket.' }}</div>

    <form v-if="canAdd" class="add-step" @submit.prevent="add(draft)">
      <div class="inline">
        <input v-model="draft" placeholder="Add a checkpoint…" maxlength="120" aria-label="New checkpoint">
        <button class="primary" :disabled="adding || !draft.trim()">Add</button>
      </div>
      <div class="presets"><button v-for="p in PRESETS" :key="p" type="button" class="chip-btn" :disabled="adding" @click="add(p)">+ {{ p }}</button></div>
    </form>
  </section>
</template>
