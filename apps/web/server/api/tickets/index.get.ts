import { and, desc, eq } from 'drizzle-orm'
import { ticketListQuery } from '#shared/contract'
import { useDb, schema } from '../../db'
import { requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { toTicket, withPullRequests } from '../../utils/tickets'
import { withSteps } from '../../utils/steps'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const q = await getValidatedQuery(event, ticketListQuery.parse)
  const db = await useDb()
  const filters = [q.status && eq(schema.tickets.status, q.status), q.assignee && eq(schema.tickets.assignee, q.assignee)].filter(Boolean) as ReturnType<typeof eq>[]
  const rows = await db.select().from(schema.tickets).where(and(...filters)).orderBy(desc(schema.tickets.updatedAt)).limit(q.limit)
  return envelope(await withSteps(await withPullRequests(rows.map(toTicket)), actor), { limit: q.limit, complete: true })
})
