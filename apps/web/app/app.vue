<script setup lang="ts">
const route = useRoute()
const { data: me } = await useMe()
const { canSync, ready, hint, lastSyncedAt, running, run } = await useSync()
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
        </nav>
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
  </template>
  <ToastHost />
</template>
