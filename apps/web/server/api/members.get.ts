import { eq } from 'drizzle-orm'
import type { Member } from '#shared/contract'
import { useDb, schema } from '../db'
import { requirePermission } from '../utils/auth'
import { envelope } from '../utils/envelope'

// People in this workspace, for assignee pickers.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const db = await useDb()
  const rows = await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.member.role })
    .from(schema.member).innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, actor.organizationId))
  return envelope<Member[]>(rows.map(r => ({ ...r, name: r.name || r.email })))
})
