import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../../../db'
import { audit, requirePermission } from '../../../../utils/auth'
import { envelope } from '../../../../utils/envelope'
import { findStep, parseStepId } from '../../../../utils/steps'
import { isDryRun } from '../../../../utils/subtasks'
import { parseTicketRef } from '../../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'step', 'delete')
  const number = parseTicketRef(getRouterParam(event, 'id') ?? '')
  const step = await findStep(number, parseStepId(getRouterParam(event, 'stepId')))
  if (isDryRun(event)) return envelope({ deleted: step.id, title: step.title }, { dry_run: true })
  const db = await useDb()
  await db.delete(schema.ticketSteps).where(eq(schema.ticketSteps.id, step.id))
  await audit(actor, 'step.delete', `SD-${number}`, { step: step.id, title: step.title })
  return envelope({ deleted: step.id })
})
