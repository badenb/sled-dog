import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { ticketListQuery } from '#shared/contract'
import { useDb, schema } from '../../db'
import { requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { toTicket, withPullRequests } from '../../utils/tickets'
import { withSteps } from '../../utils/steps'
import { withSubtasks } from '../../utils/subtasks'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const q = await getValidatedQuery(event, ticketListQuery.parse)
  const db = await useDb()
  const filters = [q.status && eq(schema.tickets.status, q.status), q.assignee && eq(schema.tickets.assignee, q.assignee)].filter(Boolean) as ReturnType<typeof eq>[]
  // The board shows live tickets; archived ones are only returned when asked for (search, the archive view).
  if (q.archived === 'exclude') filters.push(isNull(schema.tickets.archivedAt) as never)
  if (q.archived === 'only') filters.push(isNotNull(schema.tickets.archivedAt) as never)
  const where = and(...filters)
  const rows = await db.select().from(schema.tickets).where(where).orderBy(desc(schema.tickets.updatedAt)).limit(q.limit)
  // Say so when the limit cut the list off, instead of letting a full page look like the whole picture.
  const total = rows.length < q.limit ? rows.length : (await db.select({ n: count() }).from(schema.tickets).where(where))[0]?.n ?? rows.length
  const result = await withSubtasks(await withSteps(await withPullRequests(rows.map(toTicket)), actor))
  return envelope(result, { limit: q.limit, total, truncated: total > rows.length, complete: true })
})
