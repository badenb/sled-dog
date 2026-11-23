import { eq } from 'drizzle-orm'
import { stepOrder } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { loadSteps, requireTicket } from '../../../../utils/steps'
import { parseTicketRef } from '../../../../utils/tickets'

// Reorder the trail. The list must contain exactly the ticket's current steps, so a stale client can't drop or invent any.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'step', 'update')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const { order } = await readValidatedBody(event, stepOrder.parse)
  await requireTicket(number)
  const db = await useDb()
  const existing = (await db.select().from(schema.ticketSteps).where(eq(schema.ticketSteps.ticketNumber, number))).map(s => s.id)
  const same = order.length === existing.length && new Set(order).size === order.length && order.every(id => existing.includes(id))
  if (!same) throw createError({ statusCode: 409, statusMessage: 'The trail changed. Reload and try again.' })
  await db.transaction(async (tx) => {
    for (const [index, id] of order.entries()) await tx.update(schema.ticketSteps).set({ position: index + 1 }).where(eq(schema.ticketSteps.id, id))
  })
  await audit(actor, 'step.reorder', `SD-${number}`, { order })
  return envelope((await loadSteps([number], actor)).get(number))
})
