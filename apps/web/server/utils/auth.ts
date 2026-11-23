import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { auth } from '../auth'
import { useDb, schema } from '../db'
import { roles, type Action, type Resource, type RoleName } from '../../shared/permissions'
import { mayComplete } from '../../shared/trail'

export interface Actor {
  id: string
  name: string
  kind: 'user' | 'agent'
  organizationId: string
  token: string | null
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => 'sd_' + randomBytes(24).toString('base64url')
export const permissionString = (resource: Resource, action: Action) => `${resource}:${action}`

/**
 * The single answer to "may this person do this?". Every route goes through it,
 * so role rules live in shared/permissions.ts and nowhere else.
 * Roles may be comma-separated (Better Auth allows several per member).
 */
export async function memberCan(userId: string, organizationId: string, resource: Resource, action: Action) {
  const db = await useDb()
  const member = await db.select().from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId))).get()
  if (!member) return false
  return member.role.split(',').some((name) => {
    const role = roles[name.trim() as RoleName]
    return !!role && role.authorize({ [resource]: [action] } as never).success
  })
}

async function fromSession(event: H3Event): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) return null
  const organizationId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId
  if (!organizationId) throw createError({ statusCode: 403, statusMessage: 'You are not a member of a workspace' })
  return { id: session.user.id, name: session.user.name || session.user.email, kind: 'user', organizationId, token: null }
}

async function fromToken(event: H3Event, resource: Resource, action: Action): Promise<Actor | null> {
  const header = getHeader(event, 'authorization')
  if (!header) return null
  const match = /^Bearer (\S+)$/.exec(header)
  if (!match) throw createError({ statusCode: 401, statusMessage: 'Malformed Authorization header' })
  const db = await useDb()
  const row = await db.select().from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.hash, hashToken(match[1]!)), isNull(schema.apiTokens.revokedAt))).get()
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Invalid or revoked token' })
  // Effective rights = token scopes ∩ the owner's CURRENT role. A token never outlives its owner's access.
  if (!row.scopes.split(',').includes(permissionString(resource, action)))
    throw createError({ statusCode: 403, statusMessage: `Token lacks scope ${permissionString(resource, action)}` })
  return { id: row.userId, name: row.actor, kind: row.kind === 'agent' ? 'agent' : 'user', organizationId: row.organizationId, token: row.name }
}

/** Who is calling, checking a token's scope but not the role. Role/relationship checks happen after. */
async function resolveActor(event: H3Event, resource: Resource, action: Action): Promise<Actor> {
  const actor = (await fromToken(event, resource, action)) ?? (await fromSession(event))
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in or provide a bearer token' })
  return actor
}

export async function requirePermission(event: H3Event, resource: Resource, action: Action): Promise<Actor> {
  const actor = await resolveActor(event, resource, action)
  if (!(await memberCan(actor.id, actor.organizationId, resource, action)))
    throw createError({ statusCode: 403, statusMessage: `Your role cannot ${action} ${resource}` })
  return actor
}

export async function teamIdsOf(userId: string): Promise<string[]> {
  const db = await useDb()
  return (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId))).map(r => r.teamId)
}

/**
 * Completing a step is allowed by role (owner, engineer) OR by relationship: the step is assigned to you
 * or to a team you are in. That lets a designer or approver with a read-only role tick their own checkpoint.
 */
export async function requireStepComplete(event: H3Event, step: { assigneeId: string | null, teamId: string | null }): Promise<Actor> {
  const actor = await resolveActor(event, 'step', 'complete')
  const allowed = mayComplete({
    roleCanComplete: await memberCan(actor.id, actor.organizationId, 'step', 'complete'),
    userId: actor.id, assigneeId: step.assigneeId, teamId: step.teamId, userTeamIds: await teamIdsOf(actor.id),
  })
  if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Only the assignee, their team, or an engineer can complete this step' })
  return actor
}

/** Browser-session only. API tokens must not be able to mint more tokens. */
export async function requireSession(event: H3Event) {
  const actor = await fromSession(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  return actor
}

/** Owners only, and browser sessions only: workspace structure is not something an agent token should change. */
export async function requireOwnerSession(event: H3Event) {
  const actor = await requireSession(event)
  if (!(await memberCan(actor.id, actor.organizationId, 'organization', 'update')))
    throw createError({ statusCode: 403, statusMessage: 'Only owners can do this' })
  return actor
}

export async function audit(actor: Actor, action: string, target: string, detail?: unknown) {
  const db = await useDb()
  await db.insert(schema.auditLog).values({
    at: new Date().toISOString(), actor: actor.name, actorKind: actor.kind, tokenName: actor.token,
    action, target, detail: detail === undefined ? null : JSON.stringify(detail),
  })
}
