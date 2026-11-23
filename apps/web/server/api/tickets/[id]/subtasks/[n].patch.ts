import { eq } from 'drizzle-orm'
import { subtaskUpdate } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { findSubtask, isDryRun, loadSubtasks, predictTicketStatus, subtaskRef } from '../../../../utils/subtasks'
import { refreshTicketStatus } from '../../../../utils/status'
import { parseTicketRef } from '../../../../utils/tickets'

// Edit a subtask. Changing its status can carry the parent ticket forward (never backward), and the response says where it ended up.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'update')
  const ticketNumber = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const patch = await readValidatedBody(event, subtaskUpdate.parse)
  const current = await findSubtask(ticketNumber, getRouterParam(event, 'n'))
  const now = new Date().toISOString()
  const changes: Partial<typeof schema.subtasks.$inferInsert> = { updatedAt: now }
  if (patch.title !== undefined) changes.title = patch.title
  if (patch.status !== undefined) changes.status = patch.status
  if (patch.assignee !== undefined) changes.assignee = patch.assignee?.replace(/^@/, '') || null
  const db = await useDb()
  if (isDryRun(event)) {
    // Show exactly what would happen, including whether the parent ticket would move, and write nothing.
    const all = (await loadSubtasks([ticketNumber])).get(ticketNumber)!
    const preview = { ...all.find(s => s.id === current.id)!, ...(patch.title !== undefined && { title: patch.title }), ...(patch.status !== undefined && { status: patch.status }), ...(patch.assignee !== undefined && { assignee: patch.assignee?.replace(/^@/, '') || null }) }
    const predicted = await predictTicketStatus(ticketNumber, all.map(s => (s.id === current.id ? preview.status : s.status)))
    return envelope(preview, { dry_run: true, ticketStatus: predicted.current, wouldMoveTicket: predicted.moved })
  }
  await db.update(schema.subtasks).set(changes).where(eq(schema.subtasks.id, current.id))
  await audit(actor, 'subtask.update', subtaskRef(ticketNumber, current.number), patch)
  const moved = patch.status !== undefined && patch.status !== current.status
    ? await refreshTicketStatus(db, ticketNumber, now, { name: actor.name, kind: actor.kind }) : null
  const subtask = (await loadSubtasks([ticketNumber])).get(ticketNumber)!.find(s => s.id === current.id)
  const ticket = await db.select().from(schema.tickets).where(eq(schema.tickets.number, ticketNumber)).get()
  return envelope(subtask, { ticketStatus: ticket?.status, ticketMoved: moved })
})
