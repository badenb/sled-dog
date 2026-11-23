import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { teamCreate } from '#shared/contract'
import { useDb, schema } from '../../db'
import { audit, requireOwnerSession } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { loadTeams } from '../../utils/teams'

export default defineEventHandler(async (event) => {
  const actor = await requireOwnerSession(event)
  const { name } = await readValidatedBody(event, teamCreate.parse)
  const db = await useDb()
  const clash = await db.select().from(schema.teams)
    .where(and(eq(schema.teams.organizationId, actor.organizationId), sql`lower(${schema.teams.name}) = ${name.toLowerCase()}`)).get()
  if (clash) throw createError({ statusCode: 409, statusMessage: `A team named "${clash.name}" already exists` })
  const id = randomUUID()
  await db.insert(schema.teams).values({ id, organizationId: actor.organizationId, name, createdAt: new Date().toISOString() })
  await audit(actor, 'team.create', name)
  setResponseStatus(event, 201)
  return envelope((await loadTeams(actor.organizationId)).find(t => t.id === id))
})
