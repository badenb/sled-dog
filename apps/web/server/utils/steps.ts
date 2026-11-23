import { asc, eq, inArray, and } from 'drizzle-orm'
import type { Ticket } from '#shared/contract'
import type { Step, StepLite } from '#shared/contract'
import { useDb, schema } from '../db'
import { memberCan, teamIdsOf, type Actor } from './auth'
import { mayComplete } from '../../shared/trail'

export const toLite = (s: Step): StepLite => ({ id: s.id, title: s.title, status: s.status })

/** Steps for several tickets in one pass: names resolved and `canComplete` computed for this viewer. */
export async function loadSteps(ticketNumbers: number[], viewer: Actor): Promise<Map<number, Step[]>> {
  const out = new Map<number, Step[]>(ticketNumbers.map(n => [n, []]))
  if (!ticketNumbers.length) return out
  const db = await useDb()
  const rows = await db.select().from(schema.ticketSteps)
    .where(inArray(schema.ticketSteps.ticketNumber, ticketNumbers))
    .orderBy(asc(schema.ticketSteps.ticketNumber), asc(schema.ticketSteps.position))
  if (!rows.length) return out

  const userIds = [...new Set(rows.map(r => r.assigneeId).filter((v): v is string => !!v))]
  const teamIds = [...new Set(rows.map(r => r.teamId).filter((v): v is string => !!v))]
  const users = userIds.length ? await db.select().from(schema.user).where(inArray(schema.user.id, userIds)) : []
  const teams = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : []
  const userName = new Map(users.map(u => [u.id, u.name || u.email]))
  const teamName = new Map(teams.map(t => [t.id, t.name]))
  const roleCanComplete = await memberCan(viewer.id, viewer.organizationId, 'step', 'complete')
  const myTeams = await teamIdsOf(viewer.id)

  for (const r of rows) {
    out.get(r.ticketNumber)!.push({
      id: r.id, ticketNumber: r.ticketNumber, title: r.title, position: r.position, status: r.status as Step['status'],
      assignee: r.assigneeId ? { id: r.assigneeId, name: userName.get(r.assigneeId) ?? 'Unknown' } : null,
      team: r.teamId && teamName.has(r.teamId) ? { id: r.teamId, name: teamName.get(r.teamId)! } : null,
      completedAt: r.completedAt, completedBy: r.completedBy,
      canComplete: mayComplete({ roleCanComplete, userId: viewer.id, assigneeId: r.assigneeId, teamId: r.teamId, userTeamIds: myTeams }),
    })
  }
  return out
}

/** An assignee must be a member of this workspace and a team must belong to it; anything else is a 400, not a silent link. */
export async function validateAssignment(organizationId: string, assigneeId?: string | null, teamId?: string | null) {
  const db = await useDb()
  if (assigneeId) {
    const member = await db.select().from(schema.member)
      .where(and(eq(schema.member.userId, assigneeId), eq(schema.member.organizationId, organizationId))).get()
    if (!member) throw createError({ statusCode: 400, statusMessage: 'That person is not a member of this workspace' })
  }
  if (teamId) {
    const team = await db.select().from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.organizationId, organizationId))).get()
    if (!team) throw createError({ statusCode: 400, statusMessage: 'That team does not exist in this workspace' })
  }
}

/** Attach steps to tickets: lite for the board (cheap), full for the open ticket. */
export async function withSteps(list: Ticket[], viewer: Actor, full = false): Promise<Ticket[]> {
  const map = await loadSteps(list.map(t => t.number), viewer)
  return list.map(t => ({ ...t, steps: full ? map.get(t.number) : map.get(t.number)!.map(toLite) }) as Ticket)
}

export async function findStep(ticketNumber: number, stepId: number) {
  const db = await useDb()
  const step = await db.select().from(schema.ticketSteps)
    .where(and(eq(schema.ticketSteps.id, stepId), eq(schema.ticketSteps.ticketNumber, ticketNumber))).get()
  if (!step) throw createError({ statusCode: 404, statusMessage: 'Step not found' })
  return step
}

export async function requireTicket(ticketNumber: number) {
  const db = await useDb()
  const ticket = await db.select().from(schema.tickets).where(eq(schema.tickets.number, ticketNumber)).get()
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  return ticket
}

export function parseStepId(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid step id' })
  return id
}
