<script setup lang="ts">
import { ROLE_NAMES } from '#shared/permissions'

const { data: me } = await useMe()
const toast = useToast()
const email = ref('')
const role = ref<string>('stakeholder')
const error = ref('')
const busy = ref(false)
const roleHelp: Record<string, string> = {
  owner: 'Everything, including members and GitHub sources',
  engineer: 'Works tickets and can invite teammates',
  stakeholder: 'Read-only view of progress',
}

async function invite() {
  error.value = ''
  busy.value = true
  const { error: err } = await authClient.organization.inviteMember({ email: email.value, role: role.value as never, organizationId: me.value?.organizationId })
  busy.value = false
  if (err) { error.value = err.message || 'Could not invite'; return }
  toast.push(`Invited ${email.value} as ${role.value}`)
  email.value = ''
}
</script>

<template>
  <div class="narrow">
    <div class="page-head">
      <div>
        <h1>Team</h1>
        <p class="muted small">Access is by invitation. Invitees sign in with the same email.</p>
      </div>
    </div>
    <section class="panel">
      <h2>Invite someone</h2>
      <form class="stack" style="margin-top: 12px" @submit.prevent="invite">
        <div class="inline">
          <input v-model="email" type="email" required placeholder="teammate@company.com" aria-label="Email">
          <select v-model="role" aria-label="Role">
            <option v-for="r in ROLE_NAMES.filter(r => r !== 'owner' || me?.role === 'owner')" :key="r" :value="r">{{ r }}</option>
          </select>
          <button class="primary" :disabled="busy || !email">Send invitation</button>
        </div>
        <p class="muted small" style="margin: 0">{{ roleHelp[role] }}</p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>
