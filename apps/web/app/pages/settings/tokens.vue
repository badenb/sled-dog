<script setup lang="ts">
import { PERMISSIONS, type Envelope } from '#shared/contract'

const { data: me } = await useMe()
const toast = useToast()
const { data, refresh } = await useFetch<Envelope<{ id: number, name: string, kind: string, scopes: string[], createdAt: string }[]>>('/api/tokens')

// Only offer scopes the person actually holds, grouped by resource.
const groups = computed(() => {
  const out: Record<string, { scope: string, action: string }[]> = {}
  for (const scope of PERMISSIONS.filter(p => me.value?.can[p])) {
    const [resource, action] = scope.split(':') as [string, string]
    ;(out[resource] ??= []).push({ scope, action })
  }
  return Object.entries(out)
})

const name = ref('')
const kind = ref<'agent' | 'user'>('agent')
const scopes = ref<string[]>(['ticket:read'])
const created = ref('')
const error = ref('')

async function create() {
  error.value = ''
  try {
    const res = await $fetch<Envelope<{ token: string }>>('/api/tokens', { method: 'POST', body: { name: name.value, kind: kind.value, scopes: scopes.value } })
    created.value = res.data.token
    name.value = ''
    await refresh()
  } catch (e: any) { error.value = e?.data?.statusMessage || 'Could not create token' }
}
async function revoke(id: number) {
  await $fetch(`/api/tokens/${id}`, { method: 'DELETE' })
  await refresh()
  toast.push('Token revoked')
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.push('Copied') } catch { toast.push('Could not copy. Select and copy it manually.', 'error') }
}
const origin = useRequestURL().origin
</script>

<template>
  <div class="narrow">
    <div class="page-head">
      <div>
        <h1>API tokens</h1>
        <p class="muted small">For the CLI and agents. A token can never do more than you can, and stops working if your access is removed.</p>
      </div>
    </div>

    <section class="panel">
      <h2>Create a token</h2>
      <form class="stack" style="margin-top: 12px" @submit.prevent="create">
        <div class="inline">
          <input v-model="name" placeholder="Name, e.g. claude-code" required maxlength="80" aria-label="Token name">
          <select v-model="kind" aria-label="Kind"><option value="agent">Agent</option><option value="user">Personal (CLI)</option></select>
        </div>
        <div>
          <span class="field-label">Scopes</span>
          <div class="scopes">
            <div v-for="[resource, items] in groups" :key="resource" class="scope-row">
              <b>{{ resource }}</b>
              <label v-for="i in items" :key="i.scope" class="chip"><input v-model="scopes" type="checkbox" :value="i.scope">{{ i.action }}</label>
            </div>
          </div>
        </div>
        <div><button class="primary" :disabled="!name || !scopes.length">Create token</button></div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="created" class="reveal" style="margin-top: 16px">
        <b>Copy this now. It is shown once.</b>
        <div class="inline"><code style="flex: 1">{{ created }}</code><button class="sm" @click="copy(created)">Copy</button></div>
        <p class="muted small" style="margin: 0">Then connect the CLI:</p>
        <code>echo "{{ created }}" | sled-dog server login --url {{ origin }} --with-token</code>
      </div>
    </section>

    <section class="panel">
      <h2>Active tokens</h2>
      <div v-if="!data?.data.length" class="empty" style="margin-top: 8px">No tokens yet</div>
      <div v-for="t in data?.data" :key="t.id" class="row">
        <div>
          <b>{{ t.name }}</b> <span class="pill">{{ t.kind }}</span>
          <div class="muted small">{{ t.scopes.join(', ') }}</div>
        </div>
        <button class="sm danger" @click="revoke(t.id)">Revoke</button>
      </div>
    </section>
  </div>
</template>
