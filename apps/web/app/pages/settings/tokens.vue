<script setup lang="ts">
import { PERMISSIONS, type Envelope } from '#shared/contract'

const { data: me } = await useMe()
const { data, refresh } = await useFetch<Envelope<{ id: number, name: string, kind: string, scopes: string[], createdAt: string }[]>>('/api/tokens')
const allowed = computed(() => PERMISSIONS.filter(p => me.value?.can[p]))

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
}
</script>

<template>
  <section class="panel">
    <h2>API tokens</h2>
    <p class="muted">For the CLI and agents. A token can never do more than you can, and stops working if your access is removed.</p>

    <form class="stack" @submit.prevent="create">
      <input v-model="name" placeholder="Token name (e.g. claude-code)" required maxlength="80" aria-label="Token name">
      <select v-model="kind" aria-label="Kind"><option value="agent">Agent</option><option value="user">Personal (CLI)</option></select>
      <fieldset>
        <legend class="muted">Scopes</legend>
        <label v-for="p in allowed" :key="p" class="check"><input v-model="scopes" type="checkbox" :value="p"> {{ p }}</label>
      </fieldset>
      <button class="primary" :disabled="!name || !scopes.length">Create token</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="created" class="reveal">
      <strong>Copy this now. It is shown once.</strong>
      <code>{{ created }}</code>
      <p class="muted small">Then: <code>echo "{{ created }}" | sled-dog server login --url {{ useRequestURL().origin }} --with-token</code></p>
    </div>

    <h3>Active tokens</h3>
    <p v-if="!data?.data.length" class="muted">None yet.</p>
    <div v-for="t in data?.data" :key="t.id" class="row">
      <div><strong>{{ t.name }}</strong> <span class="muted">{{ t.kind }} · {{ t.scopes.join(', ') }}</span></div>
      <button @click="revoke(t.id)">Revoke</button>
    </div>
  </section>
</template>
