import { and, eq, inArray } from 'drizzle-orm'
import type { Team } from '#shared/contract'
import { useDb, schema } from '../db'

export async function loadTeams(organizationId: string): Promise<Team[]> {
  const db = await useDb()
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.organizationId, organizationId)).orderBy(schema.teams.name)
  if (!teams.length) return []
  const links = await db.select().from(schema.teamMembers).where(inArray(schema.teamMembers.teamId, teams.map(t => t.id)))
  const users = links.length ? await db.select().from(schema.user).where(inArray(schema.user.id, [...new Set(links.map(l => l.userId))])) : []
  const name = new Map(users.map(u => [u.id, u.name || u.email]))
  return teams.map(t => ({
    id: t.id, name: t.name,
    members: links.filter(l => l.teamId === t.id).map(l => ({ id: l.userId, name: name.get(l.userId) ?? 'Unknown' })),
  }))
}

export async function requireTeam(organizationId: string, id: string | undefined) {
  const db = await useDb()
  const team = id ? await db.select().from(schema.teams).where(and(eq(schema.teams.id, id), eq(schema.teams.organizationId, organizationId))).get() : undefined
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  return team
}
