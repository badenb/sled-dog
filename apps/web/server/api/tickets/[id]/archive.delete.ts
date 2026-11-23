import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../../db'
import { requirePermission } from '../../../utils/auth'
import { unarchiveTicket } from '../../../utils/archive'
import { envelope } from '../../../utils/envelope'
import { requireTicket } from '../../../utils/steps'
import { isDryRun } from '../../../utils/subtasks'
import { parseTicketRef, toTicket } from '../../../utils/tickets'

// Bring an archived ticket back to the board. Its closing time restarts so the next run does not archive it again at once.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const db = await useDb()
  const now = new Date().toISOString()
  if (isDryRun(event)) {
    const t = await requireTicket(number)
    if (!t.archivedAt) throw createError({ statusCode: 409, statusMessage: 'That ticket is not archived' })
    return envelope(toTicket({ ...t, archivedAt: null, closedAt: now }), { dry_run: true })
  }
  const outcome = await unarchiveTicket(db, number, now, { name: actor.name, kind: actor.kind })
  if (outcome === 'missing') throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  if (outcome === 'not-archived') throw createError({ statusCode: 409, statusMessage: 'That ticket is not archived' })
  return envelope(toTicket((await db.select().from(schema.tickets).where(eq(schema.tickets.number, number)).get())!))
})
