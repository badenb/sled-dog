import { eq } from 'drizzle-orm'
import { isClosed, type Status } from '../../../../shared/archive'
import { useDb, schema } from '../../../db'
import { requirePermission } from '../../../utils/auth'
import { archiveTicket } from '../../../utils/archive'
import { envelope } from '../../../utils/envelope'
import { requireTicket } from '../../../utils/steps'
import { isDryRun } from '../../../utils/subtasks'
import { parseTicketRef, toTicket } from '../../../utils/tickets'

// Take a finished ticket off the board by hand. Nothing is deleted: it stays searchable and keeps its subtasks and trail.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const db = await useDb()
  const now = new Date().toISOString()
  if (isDryRun(event)) {
    const t = await requireTicket(number)
    if (!isClosed(t.status as Status)) throw createError({ statusCode: 409, statusMessage: 'Only done or canceled tickets can be archived' })
    if (t.archivedAt) throw createError({ statusCode: 409, statusMessage: 'That ticket is already archived' })
    return envelope(toTicket({ ...t, archivedAt: now }), { dry_run: true })
  }
  const outcome = await archiveTicket(db, number, now, { name: actor.name, kind: actor.kind })
  if (outcome === 'missing') throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  if (outcome === 'not-closed') throw createError({ statusCode: 409, statusMessage: 'Only done or canceled tickets can be archived' })
  if (outcome === 'already-archived') throw createError({ statusCode: 409, statusMessage: 'That ticket is already archived' })
  return envelope(toTicket((await db.select().from(schema.tickets).where(eq(schema.tickets.number, number)).get())!))
})
