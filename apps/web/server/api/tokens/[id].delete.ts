import { and, eq, isNull } from 'drizzle-orm'
import { useDb, schema } from '../../db'
import { audit, requireSession } from '../../utils/auth'
import { envelope } from '../../utils/envelope'

export default defineEventHandler(async (event) => {
  const actor = await requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid token id' })
  const db = await useDb()
  const [row] = await db.update(schema.apiTokens).set({ revokedAt: new Date().toISOString() })
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, actor.id), isNull(schema.apiTokens.revokedAt))).returning()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Token not found' })
  await audit(actor, 'token.revoke', row.name)
  return envelope({ revoked: row.name })
})
