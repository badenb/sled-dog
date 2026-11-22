import { PERMISSIONS } from '#shared/contract'
import { eq } from 'drizzle-orm'
import { useDb, schema } from '../db'
import { memberCan, requireSession } from '../utils/auth'
import { envelope } from '../utils/envelope'
import type { Action, Resource } from '../../shared/permissions'

// Who am I, what's my role, and what may I do — the UI uses this to show only what's allowed.
export default defineEventHandler(async (event) => {
  const actor = await requireSession(event)
  const db = await useDb()
  const user = await db.select().from(schema.user).where(eq(schema.user.id, actor.id)).get()
  const member = await db.select().from(schema.member).where(eq(schema.member.userId, actor.id)).get()
  const can: Record<string, boolean> = {}
  for (const permission of PERMISSIONS) {
    const [resource, action] = permission.split(':') as [Resource, Action]
    can[permission] = await memberCan(actor.id, actor.organizationId, resource, action)
  }
  can['team:invite'] = (member?.role ?? '').split(',').some(r => ['owner', 'engineer'].includes(r.trim()))
  return envelope({ name: user?.name, email: user?.email, role: member?.role ?? null, organizationId: actor.organizationId, can })
})
