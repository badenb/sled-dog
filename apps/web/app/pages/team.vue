<script setup lang="ts">
import { ROLE_NAMES } from '#shared/permissions'

const { data: me } = await useMe()
const email = ref('')
const role = ref<string>('stakeholder')
const status = ref('')
const error = ref('')

async function invite() {
  error.value = status.value = ''
  const { error: err } = await authClient.organization.inviteMember({ email: email.value, role: role.value as never, organizationId: me.value?.organizationId })
  if (err) error.value = err.message || 'Could not invite'
  else { status.value = `Invited ${email.value} as ${role.value}.`; email.value = '' }
}
</script>

<template>
  <section class="panel">
    <h2>Invite someone</h2>
    <p class="muted">Stakeholders get a read-only view of progress. Engineers can work tickets. Owners manage everything.</p>
    <form class="stack" @submit.prevent="invite">
      <input v-model="email" type="email" required placeholder="teammate@company.com" aria-label="Email">
      <select v-model="role" aria-label="Role">
        <option v-for="r in ROLE_NAMES.filter(r => r !== 'owner' || me?.role === 'owner')" :key="r" :value="r">{{ r }}</option>
      </select>
      <button class="primary" :disabled="!email">Send invitation</button>
    </form>
    <p v-if="status">{{ status }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>
