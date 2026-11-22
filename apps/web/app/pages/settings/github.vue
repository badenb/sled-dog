<script setup lang="ts">
import type { Envelope } from '#shared/contract'

interface Source { kind: 'org' | 'repo', name: string, lastSyncedAt: string | null, lastError: string | null }
interface Settings { tokenConfigured: boolean, apiBase: string, sources: Source[] }

const { data: me } = await useMe()
const { data, refresh } = await useFetch<Envelope<Settings>>('/api/settings/github')
const settings = computed(() => data.value?.data)
const canEdit = computed(() => !!me.value?.can['ticket:update'] && me.value?.role?.includes('owner'))
const canSync = computed(() => !!me.value?.can['ticket:update'])

const kind = ref<'org' | 'repo'>('org')
const name = ref('')
const error = ref('')
const note = ref('')
const busy = ref(false)

async function save(sources: { kind: string, name: string }[]) {
  error.value = note.value = ''
  try {
    await $fetch('/api/settings/github', { method: 'PUT', body: { sources } })
    await refresh()
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.data?.message || 'Could not save' }
}
const add = async () => {
  const current = (settings.value?.sources ?? []).map(({ kind, name }) => ({ kind, name }))
  await save([...current, { kind: kind.value, name: name.value.trim() }])
  if (!error.value) name.value = ''
}
const remove = (s: Source) => save((settings.value?.sources ?? []).filter(x => x !== s).map(({ kind, name }) => ({ kind, name })))

async function syncNow() {
  busy.value = true
  error.value = note.value = ''
  try {
    const res = await $fetch<Envelope<{ source: string, prsSeen: number, error: string | null, transitions: unknown[] }[]>>('/api/sync', { method: 'POST' })
    note.value = res.data.map(r => r.error ? `${r.source}: ${r.error}` : `${r.source}: ${r.prsSeen} PRs, ${r.transitions.length} ticket(s) moved`).join(' · ')
    await refresh()
  } catch (e: any) { error.value = e?.data?.statusMessage || 'Sync failed' } finally { busy.value = false }
}
</script>

<template>
  <section class="panel">
    <h2>GitHub</h2>
    <p class="muted">Pull requests that mention a ticket (<code>SD-12</code> in the branch, title or description) are linked to it, and the ticket moves automatically: draft → in progress, open → in review, merged → done.</p>

    <p v-if="settings && !settings.tokenConfigured" class="error">
      The server has no <code>SLED_DOG_GITHUB_TOKEN</code>. Set it (and <code>SLED_DOG_GITHUB_API_BASE</code> for Enterprise) in the server environment, then restart.
    </p>
    <p v-else class="muted small">Connected to {{ settings?.apiBase }}</p>

    <h3>Sources</h3>
    <p v-if="!settings?.sources.length" class="muted">None yet. Add one GitHub org, or a list of repos.</p>
    <div v-for="s in settings?.sources" :key="s.kind + s.name" class="row">
      <div>
        <strong>{{ s.name }}</strong> <span class="muted">{{ s.kind }} · {{ s.lastSyncedAt ? `synced ${new Date(s.lastSyncedAt).toLocaleString()}` : 'never synced' }}</span>
        <div v-if="s.lastError" class="error small">{{ s.lastError }}</div>
      </div>
      <button v-if="canEdit" @click="remove(s)">Remove</button>
    </div>

    <form v-if="canEdit" class="stack" @submit.prevent="add">
      <select v-model="kind" aria-label="Kind"><option value="org">Organization</option><option value="repo">Repository</option></select>
      <input v-model="name" :placeholder="kind === 'org' ? 'acme' : 'acme/service'" required aria-label="Name">
      <button class="primary" :disabled="!name.trim()">Add source</button>
    </form>
    <p v-else class="muted small">Only owners can change sources.</p>

    <p v-if="canSync"><button :disabled="busy || !settings?.tokenConfigured || !settings?.sources.length" @click="syncNow">{{ busy ? 'Syncing…' : 'Sync now' }}</button></p>
    <p v-if="note">{{ note }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>
