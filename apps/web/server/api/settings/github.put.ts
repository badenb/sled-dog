import { eq } from 'drizzle-orm'
import { githubSettingsInput } from '#shared/contract'
import { useDb, schema } from '../../db'
import { audit, memberCan, requireSession } from '../../utils/auth'
import { envelope } from '../../utils/envelope'

// Replace the workspace's GitHub sources (one org, or a list of repos).
// Owners only, and browser sessions only: an agent token must not be able to repoint what we sync.
export default defineEventHandler(async (event) => {
  const actor = await requireSession(event)
  if (!(await memberCan(actor.id, actor.organizationId, 'organization', 'update')))
    throw createError({ statusCode: 403, statusMessage: 'Only owners can change GitHub sources' })
  const { sources } = await readValidatedBody(event, githubSettingsInput.parse)
  const db = await useDb()
  const org = actor.organizationId
  const keep = sources.map(s => `${s.kind}:${s.name.toLowerCase()}`)
  const current = await db.select().from(schema.githubSources).where(eq(schema.githubSources.organizationId, org))
  for (const row of current) {
    if (!keep.includes(`${row.kind}:${row.name.toLowerCase()}`)) await db.delete(schema.githubSources).where(eq(schema.githubSources.id, row.id))
  }
  const have = new Set(current.map(r => `${r.kind}:${r.name.toLowerCase()}`))
  for (const s of sources) {
    if (!have.has(`${s.kind}:${s.name.toLowerCase()}`)) {
      await db.insert(schema.githubSources).values({ organizationId: org, kind: s.kind, name: s.name, createdAt: new Date().toISOString() })
    }
  }
  await audit(actor, 'settings.github.update', 'github_sources', sources)
  return envelope({ sources })
})
