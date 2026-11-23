import { asc } from 'drizzle-orm'
import { useDb, schema } from '../db'
import { archiveDueTickets, getArchiveSetting } from '../utils/archive'

// Archive tickets that have sat closed past the workspace's threshold: shortly after startup, then every
// SLED_DOG_ARCHIVE_INTERVAL_SECONDS (default 3600; 0 turns it off). Idempotent, and overlapping runs are skipped.
// Tickets are not yet scoped to a workspace, so this applies the oldest workspace's setting to all of them.
export default defineNitroPlugin((nitro) => {
  const seconds = Number(process.env.SLED_DOG_ARCHIVE_INTERVAL_SECONDS ?? 3600)
  if (!(seconds > 0)) return
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const db = await useDb()
      const org = await db.select().from(schema.organization).orderBy(asc(schema.organization.createdAt)).get()
      if (!org) return
      const archived = await archiveDueTickets(db, new Date(), await getArchiveSetting(db, org.id))
      if (archived.length) console.info(`[sled-dog] archived ${archived.length} ticket(s): ${archived.map(t => `SD-${t.number}`).join(', ')}`)
    } catch (error) {
      console.error('[sled-dog] archiver failed', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }
  const first = setTimeout(run, 5000)
  const timer = setInterval(run, seconds * 1000)
  first.unref(); timer.unref()
  nitro.hooks.hook('close', () => { clearTimeout(first); clearInterval(timer) })
})
