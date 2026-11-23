import { and, eq, inArray } from 'drizzle-orm'
import { teamMembers as teamMembersInput } from '#shared/contract'
import { useDb, schema } from '../../../db'
import { audit, requireOwnerSession } from '../../../utils/auth'
import { envelope } from '../../../utils/envelope'
import { loadTeams, requireTeam } from '../../../utils/teams'

// Replace a team's membership. Everyone listed must already be a member of this workspace.
export default defineEventHandler(async (event) => {
  const actor = await requireOwnerSession(event)
  const team = await requireTeam(actor.organizationId, getRouterParam(event, 'id'))
  const { userIds } = await readValidatedBody(event, teamMembersInput.parse)
  const unique = [...new Set(userIds)]
  const db = await useDb()
  if (unique.length) {
    const valid = await db.select().from(schema.member)
      .where(and(eq(schema.member.organizationId, actor.organizationId), inArray(schema.member.userId, unique)))
    if (valid.length !== unique.length) throw createError({ statusCode: 400, statusMessage: 'Everyone on a team must be a member of this workspace' })
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, team.id))
    if (unique.length) await tx.insert(schema.teamMembers).values(unique.map(userId => ({ teamId: team.id, userId })))
  })
  await audit(actor, 'team.members', team.name, { count: unique.length })
  return envelope((await loadTeams(actor.organizationId)).find(t => t.id === team.id))
})
