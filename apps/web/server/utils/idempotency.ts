import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb, schema } from '../db'
import type { Actor } from './auth'

/** Replays the stored response when an agent retries a write with the same key. */
export async function replay(event: H3Event, actor: Actor) {
  const key = getHeader(event, 'idempotency-key')
  if (!key) return { key: null, hit: null }
  const db = await useDb()
  const row = await db.select().from(schema.idempotencyKeys)
    .where(and(eq(schema.idempotencyKeys.key, key), eq(schema.idempotencyKeys.actor, actor.name))).get()
  return { key, hit: row ? JSON.parse(row.response) : null }
}

export async function remember(key: string | null, actor: Actor, response: unknown) {
  if (!key) return
  const db = await useDb()
  await db.insert(schema.idempotencyKeys).values({
    key, actor: actor.name, response: JSON.stringify(response), createdAt: new Date().toISOString(),
  }).onConflictDoNothing()
}
