import { and, eq, isNull } from 'drizzle-orm'
import { useDb, schema } from '../../db'
import { requireSession } from '../../utils/auth'
import { envelope } from '../../utils/envelope'

export default defineEventHandler(async (event) => {
  const actor = await requireSession(event)
  const db = await useDb()
  const rows = await db.select({ id: schema.apiTokens.id, name: schema.apiTokens.name, kind: schema.apiTokens.kind, scopes: schema.apiTokens.scopes, createdAt: schema.apiTokens.createdAt })
    .from(schema.apiTokens).where(and(eq(schema.apiTokens.userId, actor.id), isNull(schema.apiTokens.revokedAt)))
  return envelope(rows.map(r => ({ ...r, scopes: r.scopes.split(',') })))
})
