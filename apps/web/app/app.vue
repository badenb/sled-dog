<script setup lang="ts">
const route = useRoute()
const { data: me } = await useMe()
const { canSync, ready, hint, lastSyncedAt, running, run } = await useSync()
const sheet = useTicketSheet()

// Search lives in the header on every page. "/" focuses it from anywhere you are not already typing.
const searchEl = ref<HTMLInputElement>()
const searchText = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch(() => route.query.q, q => { if (route.path === '/search') searchText.value = typeof q === 'string' ? q : '' })
function submitSearch() {
  const q = searchText.value.trim()
  navigateTo({ path: '/search', query: q ? { q } : {} })
  searchEl.value?.blur()
}
function onKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector('dialog[open]')) return
  e.preventDefault()
  searchEl.value?.focus()
  searchEl.value?.select()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <NuxtPage v-if="route.path === '/login' || !me" />
  <template v-else>
    <header class="topbar">
      <div class="topbar-inner">
        <NuxtLink to="/" class="brand"><span class="logo">🐕</span>Sled Dog</NuxtLink>
        <nav class="nav" aria-label="Main">
          <NuxtLink to="/">Tickets</NuxtLink>
          <NuxtLink v-if="me.can['team:invite']" to="/team">Team</NuxtLink>
          <NuxtLink to="/settings/github">GitHub</NuxtLink>
          <NuxtLink to="/settings/tokens">API tokens</NuxtLink>
          <NuxtLink to="/codex">Codex</NuxtLink>
        </nav>
        <form class="search" role="search" @submit.prevent="submitSearch">
          <input ref="searchEl" v-model="searchText" type="search" placeholder="Search tickets…" aria-label="Search tickets" aria-keyshortcuts="/" autocomplete="off" @keydown.esc="searchEl?.blur()">
          <kbd aria-hidden="true">/</kbd>
        </form>
        <div class="tools">
          <ClientOnly><span v-if="lastSyncedAt" class="sync-note">Synced {{ timeAgo(lastSyncedAt) }}</span></ClientOnly>
          <button v-if="canSync" class="sm" :disabled="!ready || running" :title="hint" @click="run">
            <span :class="{ spin: running }" aria-hidden="true">↻</span>{{ running ? 'Syncing…' : 'Sync' }}
          </button>
          <div class="me">
            <Avatar :name="me.name || me.email" :size="30" />
            <div class="who"><b>{{ me.name || me.email }}</b><span>{{ me.role }}</span></div>
            <button class="ghost sm" @click="signOut">Sign out</button>
          </div>
        </div>
      </div>
    </header>
    <main class="page"><NuxtPage /></main>
    <ClientOnly>
      <TicketModal v-if="sheet.openId.value" :id="sheet.openId.value" :key="sheet.openId.value" :from="sheet.origin.value" @close="sheet.close" @changed="sheet.changed" />
    </ClientOnly>
  </template>
  <ToastHost />
</template>
