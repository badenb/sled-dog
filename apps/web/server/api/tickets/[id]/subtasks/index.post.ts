import { eq, sql } from 'drizzle-orm'
import { subtaskCreate } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { requireTicket } from '../../../../utils/steps'
import { loadSubtasks, subtaskRef } from '../../../../utils/subtasks'
import { parseTicketRef } from '../../../../utils/tickets'

// Add a subtask. Numbers are per ticket (SD-12.1, SD-12.2, ...) and never reused, so a reference in an old PR stays meaningful.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const ticketNumber = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const input = await readValidatedBody(event, subtaskCreate.parse)
  await requireTicket(ticketNumber)
  const db = await useDb()
  const now = new Date().toISOString()
  const row = await db.transaction(async (tx) => {
    const [last] = await tx.select({ max: sql<number>`coalesce(max(${schema.subtasks.number}), 0)` }).from(schema.subtasks).where(sql`${schema.subtasks.ticketNumber} = ${ticketNumber}`)
    const ticket = await tx.select({ seq: schema.tickets.subtaskSeq }).from(schema.tickets).where(eq(schema.tickets.number, ticketNumber)).get()
    const number = Math.max(ticket?.seq ?? 0, last?.max ?? 0) + 1 // a counter that never goes down, so numbers are not reused
    await tx.update(schema.tickets).set({ subtaskSeq: number }).where(eq(schema.tickets.number, ticketNumber))
    const [created] = await tx.insert(schema.subtasks).values({
      ticketNumber, number, title: input.title, status: 'todo',
      assignee: input.assignee?.replace(/^@/, '') || null, createdBy: actor.name, createdAt: now, updatedAt: now,
    }).returning()
    return created!
  })
  await audit(actor, 'subtask.create', subtaskRef(ticketNumber, row.number), { title: input.title })
  setResponseStatus(event, 201)
  return envelope((await loadSubtasks([ticketNumber])).get(ticketNumber)!.find(s => s.id === row.id))
})
