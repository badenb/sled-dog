<script setup lang="ts">
import type { Envelope, Member, Team } from '#shared/contract'
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
  stakeholder: 'Read-only view of progress. Can complete checkpoints assigned to them or their team.',
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

// ── Teams: named groups a checkpoint can be assigned to ──
const canManage = computed(() => !!me.value?.can['team:manage'])
const { data: teamsData, refresh: refreshTeams } = await useFetch<Envelope<Team[]>>('/api/teams', { key: 'teams' })
const { data: membersData } = await useFetch<Envelope<Member[]>>('/api/members', { key: 'members' })
const teams = computed(() => teamsData.value?.data ?? [])
const members = computed(() => membersData.value?.data ?? [])
const newTeam = ref('')
const teamError = ref('')

async function call(fn: () => Promise<unknown>, fallback: string) {
  teamError.value = ''
  try { await fn(); await refreshTeams() } catch (e: any) { teamError.value = e?.data?.statusMessage || fallback }
}
const createTeam = () => call(async () => { await $fetch('/api/teams', { method: 'POST', body: { name: newTeam.value } }); newTeam.value = '' }, 'Could not create the team')
const teamUrl = (t: Team, suffix = ''): string => `/api/teams/${t.id}${suffix}`
const deleteTeam = (t: Team) => confirm(`Delete the ${t.name} team? Its checkpoints become unassigned.`) && call(() => api(teamUrl(t), { method: 'DELETE' }), 'Could not delete the team')
const setMembers = (t: Team, ids: string[]) => call(() => api(teamUrl(t, '/members'), { method: 'PUT', body: { userIds: ids } }), 'Could not update the team')
const addMember = (t: Team, e: Event) => { const el = e.target as HTMLSelectElement; if (el.value) setMembers(t, [...t.members.map(m => m.id), el.value]); el.value = '' }
const removeMember = (t: Team, id: string) => setMembers(t, t.members.filter(m => m.id !== id).map(m => m.id))
const candidates = (t: Team) => members.value.filter(m => !t.members.some(x => x.id === m.id))
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
      <h2>Teams</h2>
      <p class="muted">Group people (Design, Copy, Legal) so a ticket's checkpoints can be assigned to a whole team. Anyone on the team can complete that checkpoint.</p>
      <div v-if="!teams.length" class="empty">No teams yet</div>
      <div v-for="t in teams" :key="t.id" class="team">
        <div class="row" style="border: 0; padding: 0 0 8px">
          <b>👥 {{ t.name }} <span class="muted small">· {{ t.members.length }} member{{ t.members.length === 1 ? '' : 's' }}</span></b>
          <button v-if="canManage" class="sm danger" @click="deleteTeam(t)">Delete</button>
        </div>
        <div class="member-chips">
          <span v-for="m in t.members" :key="m.id" class="member-chip">
            <Avatar :name="m.name" :size="20" />{{ m.name }}
            <button v-if="canManage" class="ghost sm icon" :aria-label="`Remove ${m.name} from ${t.name}`" @click="removeMember(t, m.id)">✕</button>
          </span>
          <span v-if="!t.members.length" class="muted small">No members yet</span>
          <select v-if="canManage && candidates(t).length" class="sm-select" :aria-label="`Add someone to ${t.name}`" @change="addMember(t, $event)">
            <option value="">+ Add person…</option>
            <option v-for="m in candidates(t)" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
      </div>
      <form v-if="canManage" class="inline" style="margin-top: 16px" @submit.prevent="createTeam">
        <input v-model="newTeam" placeholder="New team, e.g. Design" maxlength="60" aria-label="Team name">
        <button class="primary" :disabled="!newTeam.trim()">Create team</button>
      </form>
      <p v-else class="muted small" style="margin-bottom: 0">Only owners can create or change teams.</p>
      <p v-if="teamError" class="error">{{ teamError }}</p>
    </section>

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
