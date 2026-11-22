export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const { data, refresh } = await useMe()
  if (import.meta.client) await refresh() // never trust a stale cached session on navigation
  if (!data.value) return navigateTo('/login')
})
