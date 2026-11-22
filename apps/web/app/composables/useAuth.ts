import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { ac, roles } from '#shared/permissions'
import type { Envelope } from '#shared/contract'

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), organizationClient({ ac, roles })],
})

export interface Me { name: string, email: string, role: string | null, organizationId: string, can: Record<string, boolean> }

/** Current user + permissions. Null when signed out. */
export function useMe() {
  const fetcher = useRequestFetch()
  return useAsyncData<Me | null>('me', async () => {
    try { return (await fetcher<Envelope<Me>>('/api/me')).data } catch { return null }
  })
}

export async function signOut() {
  await authClient.signOut()
  clearNuxtData('me')
  await navigateTo('/login')
}
