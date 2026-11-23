import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../db'
import { requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { parseTicketRef, toTicket, withPullRequests } from '../../utils/tickets'
import { withSteps } from '../../utils/steps'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const db = await useDb()
  const row = await db.select().from(schema.tickets).where(eq(schema.tickets.number, number)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  return envelope((await withSteps(await withPullRequests([toTicket(row)]), actor, true))[0])
})
