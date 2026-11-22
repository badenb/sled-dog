import { eq } from 'drizzle-orm'
import { useDb, schema } from '../db'
import { githubConfigFromEnv, syncWorkspace } from '../utils/sync'

// Background sync. SLED_DOG_SYNC_INTERVAL_SECONDS=0 turns it off (default 300).
export default defineNitroPlugin((nitro) => {
  const seconds = Number(process.env.SLED_DOG_SYNC_INTERVAL_SECONDS ?? 300)
  if (!(seconds > 0)) return
  const timer = setInterval(async () => {
    const config = githubConfigFromEnv()
    if (!config) return
    try {
      const db = await useDb()
      const orgs = [...new Set((await db.select().from(schema.githubSources)).map(s => s.organizationId))]
      for (const org of orgs) await syncWorkspace(db, org, config)
    } catch (error) {
      console.error('[sled-dog] background sync failed', error instanceof Error ? error.message : error)
    }
  }, seconds * 1000)
  timer.unref()
  nitro.hooks.hook('close', () => clearInterval(timer))
})
