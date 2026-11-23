<script setup lang="ts">
type Source = { kind: 'org' | 'repo', name: string, lastSyncedAt: string | null, lastError: string | null }

const { data: me } = await useMe()
const { settings, refresh, canSync, ready, hint, running, run } = await useSync()
const canEdit = computed(() => !!me.value?.can['ticket:update'] && !!me.value?.role?.includes('owner'))

const kind = ref<'org' | 'repo'>('org')
const name = ref('')
const error = ref('')

async function save(sources: { kind: string, name: string }[]) {
  error.value = ''
  try {
    await $fetch('/api/settings/github', { method: 'PUT', body: { sources } })
    await refresh()
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.data?.message || 'Could not save' }
}
const current = () => (settings.value?.sources ?? []).map(({ kind, name }) => ({ kind, name }))
async function add() {
  await save([...current(), { kind: kind.value, name: name.value.trim() }])
  if (!error.value) name.value = ''
}
const remove = (s: Source) => save(current().filter(x => !(x.kind === s.kind && x.name === s.name)))
</script>

<template>
  <div class="narrow">
    <div class="page-head">
      <div>
        <h1>GitHub</h1>
        <p class="muted small">Link pull requests to tickets and move them automatically.</p>
      </div>
      <button v-if="canSync" class="primary" :disabled="!ready || running" :title="hint" @click="run">
        <span :class="{ spin: running }" aria-hidden="true">↻</span>{{ running ? 'Syncing…' : 'Sync now' }}
      </button>
    </div>

    <p v-if="settings && !settings.tokenConfigured" class="notice" style="margin-bottom: 16px">
      The server has no <code>SLED_DOG_GITHUB_TOKEN</code>. Set it (and <code>SLED_DOG_GITHUB_API_BASE</code> for Enterprise) in the server environment, then restart.
    </p>

    <section class="panel">
      <h2>How it works</h2>
      <p class="muted">Put a ticket like <code>SD-12</code> in the branch name or PR title, or write <code>closes SD-12</code> (or <code>fixes</code>, <code>part of</code>, <code>refs</code>) in the description. A plain mention in the description does not link. A draft PR moves it to <b>in progress</b>, an open PR to <b>in review</b>, and once merged it moves to <b>test</b> for a person to verify and move to <b>done</b>. Tickets only move forward. If a ticket has subtasks (<code>SD-12.1</code>), it follows them instead.</p>
      <p v-if="settings?.tokenConfigured" class="muted small" style="margin-bottom: 0">Connected to {{ settings.apiBase }}</p>
    </section>

    <section class="panel">
      <h2>Sources</h2>
      <p class="muted">One GitHub organization, or a list of repositories.</p>
      <div v-if="!settings?.sources.length" class="empty">No sources yet</div>
      <div v-for="s in settings?.sources" :key="s.kind + s.name" class="row">
        <div>
          <b>{{ s.name }}</b> <span class="pill">{{ s.kind === 'org' ? 'Organization' : 'Repository' }}</span>
          <div class="muted small">
            <ClientOnly>{{ s.lastSyncedAt ? `Synced ${timeAgo(s.lastSyncedAt)}` : 'Never synced' }}</ClientOnly>
          </div>
          <div v-if="s.lastError" class="error small">{{ s.lastError }}</div>
        </div>
        <button v-if="canEdit" class="sm danger" @click="remove(s)">Remove</button>
      </div>

      <form v-if="canEdit" class="inline" style="margin-top: 16px" @submit.prevent="add">
        <select v-model="kind" aria-label="Kind"><option value="org">Organization</option><option value="repo">Repository</option></select>
        <input v-model="name" :placeholder="kind === 'org' ? 'acme' : 'acme/service'" required aria-label="Name">
        <button class="primary" :disabled="!name.trim()">Add source</button>
      </form>
      <p v-else class="muted small" style="margin-bottom: 0">Only owners can change sources.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>
