import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../db'
import { audit, requireOwnerSession } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { requireTeam } from '../../utils/teams'

// Deleting a team un-assigns its steps (they keep their title and status) rather than deleting them.
export default defineEventHandler(async (event) => {
  const actor = await requireOwnerSession(event)
  const team = await requireTeam(actor.organizationId, getRouterParam(event, 'id'))
  const db = await useDb()
  await db.update(schema.ticketSteps).set({ teamId: null }).where(eq(schema.ticketSteps.teamId, team.id))
  await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id))
  await db.delete(schema.teams).where(eq(schema.teams.id, team.id))
  await audit(actor, 'team.delete', team.name)
  return envelope({ deleted: team.id })
})
