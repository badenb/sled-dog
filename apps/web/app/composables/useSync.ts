import type { Envelope } from '#shared/contract'

interface GhSettings { tokenConfigured: boolean, apiBase: string, sources: { kind: 'org' | 'repo', name: string, lastSyncedAt: string | null, lastError: string | null }[] }
interface SyncRow { source: string, prsSeen: number, error: string | null, transitions: unknown[] }

/** GitHub sync state shared by the header button and the GitHub settings page. */
export async function useSync() {
  // All composables first: Nuxt context is lost after the first await.
  const meRequest = useMe()
  const fetcher = useRequestFetch()
  const toast = useToast()
  const running = useState('sync-running', () => false)
  const settingsRequest = useAsyncData('gh-settings', async () => {
    const { data: me } = await meRequest
    if (!me.value) return null
    try { return (await fetcher<Envelope<GhSettings>>('/api/settings/github')).data } catch { return null }
  })
  const [{ data: me }, { data: settings, refresh }] = await Promise.all([meRequest, settingsRequest])

  const canSync = computed(() => !!me.value?.can['ticket:update'])
  const ready = computed(() => !!settings.value?.tokenConfigured && !!settings.value.sources.length)
  const lastSyncedAt = computed(() => settings.value?.sources.map(s => s.lastSyncedAt).filter((v): v is string => !!v).sort().at(-1) ?? null)
  const hint = computed(() => !settings.value?.tokenConfigured ? 'The server has no GitHub token set' : !settings.value.sources.length ? 'Add a GitHub org or repos first' : 'Pull the latest pull requests from GitHub')

  async function run() {
    if (running.value || !ready.value) return
    running.value = true
    try {
      const res = await $fetch<Envelope<SyncRow[]>>('/api/sync', { method: 'POST' })
      const failed = res.data.filter(r => r.error)
      const moved = res.data.reduce((n, r) => n + r.transitions.length, 0)
      const seen = res.data.reduce((n, r) => n + r.prsSeen, 0)
      if (failed.length) toast.push(failed.map(r => `${r.source}: ${r.error}`).join(' · '), 'error')
      else toast.push(`Synced ${seen} pull request${seen === 1 ? '' : 's'}${moved ? ` · ${moved} ticket${moved === 1 ? '' : 's'} moved` : ''}`)
    } catch (e: any) {
      toast.push(e?.data?.statusMessage || 'Sync failed', 'error')
    } finally {
      running.value = false
      await refreshNuxtData(['gh-settings', 'tickets'])
    }
  }
  return { settings, refresh, canSync, ready, hint, lastSyncedAt, running, run }
}
