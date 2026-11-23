// Derives ticket and subtask status from linked pull requests and subtasks, and records the change.
// Takes the db as a parameter and imports no Nuxt auto-imports, so sync tests can run it on an in-memory database.
import { eq, inArray } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { nextStatus, statusFromSubtasks, type PrState, type Status } from '../../shared/linking'
import type * as schemaModule from '../db/schema'
import { auditLog, pullRequests, subtaskLinks, subtasks, ticketLinks, tickets } from '../db/schema'

export type Db = LibSQLDatabase<typeof schemaModule>
export interface Who { name: string, kind: string }
export interface Transition { ticket: string, from: string, to: string }

const asPrs = (rows: { state: string, draft: boolean }[]) => rows.map(p => ({ state: p.state as PrState, draft: p.draft }))

/** A ticket with subtasks follows them; otherwise it follows its own linked PRs. Forward only. */
export async function refreshTicketStatus(db: Db, ticketNumber: number, at: string, who: Who, reason = 'pull requests'): Promise<Transition | null> {
  const ticket = await db.select().from(tickets).where(eq(tickets.number, ticketNumber)).get()
  if (!ticket) return null
  const subs = await db.select().from(subtasks).where(eq(subtasks.ticketNumber, ticketNumber))
  let target: Status
  if (subs.length) {
    target = statusFromSubtasks(ticket.status as Status, subs.map(s => s.status as Status))
    reason = 'subtasks'
  } else {
    const keys = (await db.select().from(ticketLinks).where(eq(ticketLinks.ticketNumber, ticketNumber))).map(l => l.prKey)
    const prs = keys.length ? await db.select().from(pullRequests).where(inArray(pullRequests.key, keys)) : []
    target = nextStatus(ticket.status as Status, asPrs(prs))
  }
  if (target === ticket.status) return null
  await db.update(tickets).set({ status: target, updatedAt: at }).where(eq(tickets.number, ticketNumber))
  await db.insert(auditLog).values({
    at, actor: who.name, actorKind: who.kind, tokenName: null, action: 'ticket.auto_status', target: `SD-${ticketNumber}`,
    detail: JSON.stringify({ from: ticket.status, to: target, reason }),
  })
  return { ticket: `SD-${ticketNumber}`, from: ticket.status, to: target }
}

/** A subtask follows its own linked PRs, the same way a plain ticket does. */
export async function refreshSubtaskStatus(db: Db, subtaskId: number, at: string, who: Who): Promise<Transition | null> {
  const sub = await db.select().from(subtasks).where(eq(subtasks.id, subtaskId)).get()
  if (!sub) return null
  const keys = (await db.select().from(subtaskLinks).where(eq(subtaskLinks.subtaskId, subtaskId))).map(l => l.prKey)
  const prs = keys.length ? await db.select().from(pullRequests).where(inArray(pullRequests.key, keys)) : []
  const target = nextStatus(sub.status as Status, asPrs(prs))
  if (target === sub.status) return null
  const ref = `SD-${sub.ticketNumber}.${sub.number}`
  await db.update(subtasks).set({ status: target, updatedAt: at }).where(eq(subtasks.id, subtaskId))
  await db.insert(auditLog).values({
    at, actor: who.name, actorKind: who.kind, tokenName: null, action: 'subtask.auto_status', target: ref,
    detail: JSON.stringify({ from: sub.status, to: target, pullRequests: keys }),
  })
  return { ticket: ref, from: sub.status, to: target }
}
