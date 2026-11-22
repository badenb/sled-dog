import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../db'
import { requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { githubConfigFromEnv } from '../../utils/sync'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const db = await useDb()
  const sources = await db.select().from(schema.githubSources).where(eq(schema.githubSources.organizationId, actor.organizationId))
  const config = githubConfigFromEnv()
  return envelope({
    tokenConfigured: !!config, // never the token itself
    apiBase: config?.apiBase ?? process.env.SLED_DOG_GITHUB_API_BASE ?? 'https://api.github.com',
    sources: sources.map(s => ({ kind: s.kind, name: s.name, lastSyncedAt: s.lastSyncedAt, lastError: s.lastError })),
  })
})
