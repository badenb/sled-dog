import { tokenCreate } from '#shared/contract'
import { useDb, schema } from '../../db'
import { audit, hashToken, memberCan, newToken, requireSession } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import type { Action, Resource } from '../../../shared/permissions'

// Mint a CLI/agent token. Scopes you don't hold yourself are refused: a token can only narrow its owner.
export default defineEventHandler(async (event) => {
  const actor = await requireSession(event)
  const input = await readValidatedBody(event, tokenCreate.parse)
  for (const scope of input.scopes) {
    const [resource, action] = scope.split(':') as [Resource, Action]
    if (!(await memberCan(actor.id, actor.organizationId, resource, action)))
      throw createError({ statusCode: 403, statusMessage: `You cannot grant ${scope}: your role does not allow it` })
  }
  const token = newToken()
  const db = await useDb()
  await db.insert(schema.apiTokens).values({
    name: input.name, hash: hashToken(token), scopes: input.scopes.join(','), actor: actor.name,
    userId: actor.id, organizationId: actor.organizationId, kind: input.kind, createdAt: new Date().toISOString(),
  })
  await audit(actor, 'token.create', input.name, { kind: input.kind, scopes: input.scopes })
  setResponseStatus(event, 201)
  return envelope({ token, name: input.name, kind: input.kind, scopes: input.scopes }, { shown_once: true })
})
