import { sql } from 'drizzle-orm'
import { stepCreate } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { remember, replay } from '../../../../utils/idempotency'
import { describeParties, loadSteps, requireTicket, validateAssignment } from '../../../../utils/steps'
import { isDryRun } from '../../../../utils/subtasks'
import { parseTicketRef } from '../../../../utils/tickets'

// Add a checkpoint to the end of a ticket's trail.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'step', 'create')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const input = await readValidatedBody(event, stepCreate.parse)
  await requireTicket(number)
  await validateAssignment(actor.organizationId, input.assigneeId, input.teamId)
  const { key, hit } = await replay(event, actor) // a retry with the same key returns the original step
  if (hit) return hit
  const db = await useDb()
  const [last] = await db.select({ max: sql<number>`coalesce(max(${schema.ticketSteps.position}), 0)` })
    .from(schema.ticketSteps).where(sql`${schema.ticketSteps.ticketNumber} = ${number}`)
  const now = new Date().toISOString()
  if (isDryRun(event)) {
    return envelope({
      id: 0, ticketNumber: number, title: input.title, position: (last?.max ?? 0) + 1, status: 'todo',
      ...(await describeParties(input.assigneeId, input.teamId)), completedAt: null, completedBy: null, canComplete: true,
    }, { dry_run: true })
  }
  const [row] = await db.insert(schema.ticketSteps).values({
    ticketNumber: number, title: input.title, position: (last?.max ?? 0) + 1, status: 'todo',
    assigneeId: input.assigneeId ?? null, teamId: input.teamId ?? null, createdAt: now, updatedAt: now,
  }).returning()
  await audit(actor, 'step.create', `SD-${number}`, { step: row!.id, title: input.title })
  const step = (await loadSteps([number], actor)).get(number)!.find(s => s.id === row!.id)
  const response = envelope(step)
  await remember(key, actor, response)
  setResponseStatus(event, 201)
  return response
})
