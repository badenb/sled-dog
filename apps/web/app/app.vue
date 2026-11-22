<script setup lang="ts">
const route = useRoute()
const { data: me } = await useMe()
</script>

<template>
  <div class="shell">
    <header v-if="route.path !== '/login' && me" class="top">
      <h1>🐕 Sled Dog</h1>
      <nav class="nav">
        <NuxtLink to="/">Tickets</NuxtLink>
        <NuxtLink v-if="me.can['team:invite']" to="/team">Team</NuxtLink>
        <NuxtLink to="/settings/github">GitHub</NuxtLink>
        <NuxtLink to="/settings/tokens">API tokens</NuxtLink>
        <span class="muted">{{ me.name || me.email }} · {{ me.role }}</span>
        <button @click="signOut">Sign out</button>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>
