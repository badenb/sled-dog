import { ticketCreate } from '#shared/contract'
import { closedAtFor } from '../../../shared/archive'
import { useDb, schema } from '../../db'
import { audit, requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { remember, replay } from '../../utils/idempotency'
import { toTicket } from '../../utils/tickets'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'create')
  const input = await readValidatedBody(event, ticketCreate.parse)
  const dryRun = getQuery(event).dry_run === '1'
  const { key, hit } = await replay(event, actor)
  if (hit) return hit

  const now = new Date().toISOString()
  if (dryRun) {
    // Show exactly what would be written, change nothing.
    return envelope({ ...input, assignee: input.assignee ?? null, createdBy: actor.name, createdAt: now, updatedAt: now, closedAt: closedAtFor(null, input.status, null, now), archivedAt: null }, { dry_run: true })
  }
  const db = await useDb()
  const [row] = await db.insert(schema.tickets).values({
    ...input, assignee: input.assignee ?? null, createdBy: actor.name, createdAt: now, updatedAt: now,
    closedAt: closedAtFor(null, input.status, null, now),
  }).returning()
  const ticket = toTicket(row!)
  await audit(actor, 'ticket.create', ticket.id, input)
  const response = envelope(ticket)
  await remember(key, actor, response)
  setResponseStatus(event, 201)
  return response
})
