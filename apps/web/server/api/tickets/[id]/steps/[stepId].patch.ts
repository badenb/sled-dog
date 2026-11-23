import { eq } from 'drizzle-orm'
import { stepUpdate } from '#shared/contract'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission, requireStepComplete, type Actor } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { describeParties, findStep, loadSteps, parseStepId, validateAssignment } from '../../../../utils/steps'
import { isDryRun } from '../../../../utils/subtasks'
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
  if (isDryRun(event)) {
    // Show what the step would look like, write nothing (and so audit nothing).
    const now = new Date().toISOString()
    const shown = (await loadSteps([number], actor!)).get(number)!.find(s => s.id === stepId)!
    const parties = patch.assigneeId !== undefined || patch.teamId !== undefined
      ? await describeParties(patch.assigneeId !== undefined ? patch.assigneeId : current.assigneeId, patch.teamId !== undefined ? patch.teamId : current.teamId)
      : { assignee: shown.assignee, team: shown.team }
    const status = patch.status ?? shown.status
    return envelope({
      ...shown, ...parties, title: patch.title ?? shown.title, status,
      completedAt: status === 'done' ? (shown.status === 'done' ? shown.completedAt : now) : null,
      completedBy: status === 'done' ? (shown.status === 'done' ? shown.completedBy : actor!.name) : null,
    }, { dry_run: true })
  }
  const db = await useDb()
  await db.update(schema.ticketSteps).set(changes).where(eq(schema.ticketSteps.id, stepId))
  const action = patch.status !== undefined && patch.status !== current.status ? (patch.status === 'done' ? 'step.complete' : 'step.reopen') : 'step.update'
  await audit(actor!, action, `SD-${number}`, { step: stepId, title: current.title, ...patch })
  const step = (await loadSteps([number], actor!)).get(number)!.find(s => s.id === stepId)
  return envelope(step)
})
