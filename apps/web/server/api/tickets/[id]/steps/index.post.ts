import { sql } from 'drizzle-orm'
import { stepCreate } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { loadSteps, requireTicket, validateAssignment } from '../../../../utils/steps'
import { parseTicketRef } from '../../../../utils/tickets'

// Add a checkpoint to the end of a ticket's trail.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'step', 'create')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const input = await readValidatedBody(event, stepCreate.parse)
  await requireTicket(number)
  await validateAssignment(actor.organizationId, input.assigneeId, input.teamId)
  const db = await useDb()
  const [last] = await db.select({ max: sql<number>`coalesce(max(${schema.ticketSteps.position}), 0)` })
    .from(schema.ticketSteps).where(sql`${schema.ticketSteps.ticketNumber} = ${number}`)
  const now = new Date().toISOString()
  const [row] = await db.insert(schema.ticketSteps).values({
    ticketNumber: number, title: input.title, position: (last?.max ?? 0) + 1, status: 'todo',
    assigneeId: input.assigneeId ?? null, teamId: input.teamId ?? null, createdAt: now, updatedAt: now,
  }).returning()
  await audit(actor, 'step.create', `SD-${number}`, { step: row!.id, title: input.title })
  const step = (await loadSteps([number], actor)).get(number)!.find(s => s.id === row!.id)
  setResponseStatus(event, 201)
  return envelope(step)
})
