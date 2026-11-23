import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { findSubtask, isDryRun, loadSubtasks, predictTicketStatus, subtaskRef } from '../../../../utils/subtasks'
import { refreshTicketStatus } from '../../../../utils/status'
import { parseTicketRef } from '../../../../utils/tickets'

// Removing the slowest subtask can let the parent move forward, so recompute it. Its number is never reused.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const ticketNumber = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const current = await findSubtask(ticketNumber, getRouterParam(event, 'n'))
  const db = await useDb()
  if (isDryRun(event)) {
    const rest = (await loadSubtasks([ticketNumber])).get(ticketNumber)!.filter(s => s.id !== current.id)
    const predicted = await predictTicketStatus(ticketNumber, rest.map(s => s.status))
    return envelope({ deleted: current.number, ref: subtaskRef(ticketNumber, current.number) }, { dry_run: true, ticketStatus: predicted.current, wouldMoveTicket: predicted.moved })
  }
  await db.delete(schema.subtaskLinks).where(eq(schema.subtaskLinks.subtaskId, current.id))
  await db.delete(schema.subtasks).where(eq(schema.subtasks.id, current.id))
  await audit(actor, 'subtask.delete', subtaskRef(ticketNumber, current.number), { title: current.title })
  const moved = await refreshTicketStatus(db, ticketNumber, new Date().toISOString(), { name: actor.name, kind: actor.kind })
  const ticket = await db.select().from(schema.tickets).where(eq(schema.tickets.number, ticketNumber)).get()
  return envelope({ deleted: current.number }, { ticketStatus: ticket?.status, ticketMoved: moved })
})
