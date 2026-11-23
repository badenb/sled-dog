<script setup lang="ts">
import { ARCHIVE_PRESETS, MAX_ARCHIVE_VALUE, describeSetting, presetFor, type ArchiveSetting, type ArchiveUnit } from '#shared/archive'
import type { Envelope } from '#shared/contract'

const toast = useToast()
const { data: me } = await useMe()
const canEdit = computed(() => !!me.value?.can['team:manage'])
const { data, refresh } = await useFetch<Envelope<ArchiveSetting & { summary: string }>>('/api/settings/archive', { key: 'archive-setting' })

const saved = computed<ArchiveSetting>(() => ({ value: data.value?.data.value ?? 30, unit: data.value?.data.unit ?? 'days' }))
const value = ref(saved.value.value)
const unit = ref<ArchiveUnit>(saved.value.unit)
const draft = computed<ArchiveSetting>(() => ({ value: Math.max(0, Math.min(MAX_ARCHIVE_VALUE, Math.round(Number(value.value) || 0))), unit: unit.value }))
const dirty = computed(() => draft.value.value !== saved.value.value || (draft.value.value > 0 && draft.value.unit !== saved.value.unit))
const preset = computed(() => presetFor(draft.value))
const choose = (s: ArchiveSetting) => { value.value = s.value; unit.value = s.unit }

// Before saving, say what it would do: how many finished tickets are already past this rule.
const wouldArchive = ref<number | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
watch(draft, (d) => {
  if (!canEdit.value) return
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try { wouldArchive.value = (await api<{ meta: { wouldArchive: number } }>('/api/settings/archive?dry_run=1', { method: 'PUT', body: d })).meta.wouldArchive }
    catch { wouldArchive.value = null }
  }, 300)
}, { immediate: true, deep: true })

const saving = ref(false)
const error = ref('')
async function save() {
  saving.value = true
  error.value = ''
  try {
    await api('/api/settings/archive', { method: 'PUT', body: draft.value })
    await refresh()
    await refreshNuxtData(['archive-setting', 'tickets', 'archived-count'])
    toast.push(`Saved: finished tickets archive after ${describeSetting(draft.value)}.`)
  } catch (e: any) { error.value = e?.data?.statusMessage || 'Could not save' } finally { saving.value = false }
}
</script>

<template>
  <div class="narrow">
    <div class="page-head">
      <div>
        <h1>Archiving</h1>
        <p class="muted small">How long a finished ticket stays on the board.</p>
      </div>
      <NuxtLink :to="{ path: '/search', query: { archived: 'only' } }" class="codex-link">Browse the archive →</NuxtLink>
    </div>

    <section class="panel">
      <h2>Archive finished tickets after</h2>
      <p class="muted">A ticket's clock starts when it is marked <b>done</b> or <b>canceled</b>. Business days skip weekends, so "3 business days" never archives anything over a weekend.</p>

      <div class="presets-row" role="radiogroup" aria-label="Archive after">
        <button v-for="p in ARCHIVE_PRESETS" :key="p.label" role="radio" :aria-checked="preset?.label === p.label" :disabled="!canEdit" :class="['preset', { on: preset?.label === p.label }]" @click="choose(p.setting)">{{ p.label }}</button>
      </div>

      <div v-if="canEdit" class="inline custom">
        <label class="field-label" for="a-value">Or set your own</label>
        <input id="a-value" v-model="value" type="number" min="0" :max="MAX_ARCHIVE_VALUE" inputmode="numeric" aria-label="Number of days">
        <select v-model="unit" :disabled="draft.value === 0" aria-label="Unit">
          <option value="business_days">business days</option>
          <option value="days">calendar days</option>
        </select>
        <span class="muted small">{{ preset ? '' : describeSetting(draft) }}</span>
      </div>

      <p v-if="canEdit && wouldArchive !== null" class="preview" role="status">
        <template v-if="draft.value === 0">Nothing will be archived automatically. Tickets stay on the board until someone archives them.</template>
        <template v-else-if="wouldArchive > 0"><b>{{ wouldArchive }}</b> finished ticket{{ wouldArchive === 1 ? '' : 's' }} {{ dirty ? 'would be' : 'will be' }} archived within the hour.</template>
        <template v-else>No finished ticket is past this yet.</template>
      </p>
      <p v-if="!canEdit" class="muted small">Currently <b>{{ data?.data.summary }}</b>. Only owners can change this.</p>

      <div v-if="canEdit" class="inline" style="margin-top: 14px">
        <button class="primary" :disabled="!dirty || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
        <button v-if="dirty" class="ghost" @click="choose(saved)">Cancel</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="panel">
      <h2>What archiving does</h2>
      <ul class="tip-list">
        <li>The ticket <b>leaves the board</b>, but is <b>never deleted</b>. Its subtasks, trail and pull requests stay with it.</li>
        <li><b>Search always finds it</b>, and the Archive view lists everything archived.</li>
        <li>Moving a ticket back out of done or canceled <b>returns it to the board</b>. Unarchiving it by hand restarts its clock, so it is not archived again at once.</li>
        <li>It happens automatically, about once an hour, and every archive is recorded in the audit log. Days and business days are counted in <b>UTC</b>, so the date shown on a ticket is the UTC date.</li>
      </ul>
    </section>
  </div>
</template>
