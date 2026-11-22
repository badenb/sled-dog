import { useDb } from '../db'
import { audit, requirePermission } from '../utils/auth'
import { envelope } from '../utils/envelope'
import { githubConfigFromEnv, syncWorkspace } from '../utils/sync'

// Sync GitHub now (also runs on a timer). Engineers and owners may trigger it.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const config = githubConfigFromEnv()
  if (!config) throw createError({ statusCode: 409, statusMessage: 'The server has no SLED_DOG_GITHUB_TOKEN configured' })
  const db = await useDb()
  const result = await syncWorkspace(db, actor.organizationId, config)
  if (result.skipped) throw createError({ statusCode: 409, statusMessage: 'A sync is already running' })
  const failed = result.results.filter(r => r.error)
  await audit(actor, 'sync.run', 'github', { sources: result.results.length, failed: failed.length })
  return envelope(result.results, { complete: failed.length === 0, sources: result.results.length })
})
