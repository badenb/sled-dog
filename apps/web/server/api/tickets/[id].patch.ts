import { eq } from 'drizzle-orm'
import { ticketUpdate } from '#shared/contract'
import { useDb, schema } from '../../db'
import { audit, requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { parseTicketRef, toTicket } from '../../utils/tickets'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const patch = await readValidatedBody(event, ticketUpdate.parse)
  const db = await useDb()
  const current = await db.select().from(schema.tickets).where(eq(schema.tickets.number, number)).get()
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })

  const changes = { ...patch, updatedAt: new Date().toISOString() }
  if (getQuery(event).dry_run === '1') return envelope(toTicket({ ...current, ...changes, assignee: patch.assignee === undefined ? current.assignee : patch.assignee ?? null }), { dry_run: true })

  const [row] = await db.update(schema.tickets)
    .set({ ...changes, ...(patch.assignee !== undefined && { assignee: patch.assignee ?? null }) })
    .where(eq(schema.tickets.number, number)).returning()
  const ticket = toTicket(row!)
  await audit(actor, 'ticket.update', ticket.id, patch)
  return envelope(ticket)
})
