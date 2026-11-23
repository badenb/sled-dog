import { eq } from 'drizzle-orm'
import { stepUpdate } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission, requireStepComplete, type Actor } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { findStep, loadSteps, parseStepId, validateAssignment } from '../../../../utils/steps'
import { parseTicketRef } from '../../../../utils/tickets'

// Edit a checkpoint. Changing the title, assignee, or team needs step:update (engineers, owners).
// Marking it done or not done is also open to the assignee and their team, whatever their role.
export default defineEventHandler(async (event) => {
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const stepId = parseStepId(getRouterParam(event, 'stepId'))
  const patch = await readValidatedBody(event, stepUpdate.parse)
  const current = await findStep(number, stepId)

  let actor: Actor | undefined
  if (Object.keys(patch).some(k => k !== 'status')) actor = await requirePermission(event, 'step', 'update')
  if (patch.status !== undefined) actor = await requireStepComplete(event, current)
  actor!

  if (patch.assigneeId !== undefined || patch.teamId !== undefined) await validateAssignment(actor!.organizationId, patch.assigneeId, patch.teamId)
  const now = new Date().toISOString()
  const changes: Partial<typeof schema.ticketSteps.$inferInsert> = { updatedAt: now }
  if (patch.title !== undefined) changes.title = patch.title
  if (patch.assigneeId !== undefined) changes.assigneeId = patch.assigneeId
  if (patch.teamId !== undefined) changes.teamId = patch.teamId
  if (patch.status !== undefined && patch.status !== current.status) {
    changes.status = patch.status
    changes.completedAt = patch.status === 'done' ? now : null
    changes.completedBy = patch.status === 'done' ? actor!.name : null
  }
  const db = await useDb()
  await db.update(schema.ticketSteps).set(changes).where(eq(schema.ticketSteps.id, stepId))
  const action = patch.status !== undefined && patch.status !== current.status ? (patch.status === 'done' ? 'step.complete' : 'step.reopen') : 'step.update'
  await audit(actor!, action, `SD-${number}`, { step: stepId, title: current.title, ...patch })
  const step = (await loadSteps([number], actor!)).get(number)!.find(s => s.id === stepId)
  return envelope(step)
})
