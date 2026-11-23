// Archiving: take finished tickets off the board without deleting anything. The db is a parameter and nothing
// here imports Nuxt, so it runs the same from a route, the scheduled job, and an in-memory test database.
import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { archiveCutoff, DEFAULT_ARCHIVE, isClosed, type ArchiveSetting, type ArchiveUnit, type Status } from '../../shared/archive'
import { auditLog, tickets, workspaceSettings } from '../db/schema'
import type { Db, Who } from './status'

export const ARCHIVER: Who = { name: 'archiver', kind: 'system' }

export async function getArchiveSetting(db: Db, organizationId: string): Promise<ArchiveSetting> {
  const row = await db.select().from(workspaceSettings).where(eq(workspaceSettings.organizationId, organizationId)).get()
  return row ? { value: row.archiveAfter, unit: row.archiveUnit as ArchiveUnit } : DEFAULT_ARCHIVE
}

export async function saveArchiveSetting(db: Db, organizationId: string, setting: ArchiveSetting, at: string) {
  await db.insert(workspaceSettings).values({ organizationId, archiveAfter: setting.value, archiveUnit: setting.unit, updatedAt: at })
    .onConflictDoUpdate({ target: workspaceSettings.organizationId, set: { archiveAfter: setting.value, archiveUnit: setting.unit, updatedAt: at } })
}

/** Closed tickets that are past the threshold and not yet archived. Pure read: used by the job and by dry runs. */
export async function dueTickets(db: Db, now: Date, setting: ArchiveSetting) {
  const cutoff = archiveCutoff(now, setting)
  if (!cutoff) return []
  // closed_at holds ISO-8601 UTC strings, which sort the same as the moments they name; NULL never matches.
  return db.select().from(tickets).where(and(
    isNull(tickets.archivedAt), inArray(tickets.status, ['done', 'canceled']), lte(tickets.closedAt, cutoff.toISOString())))
}

/** Archive everything that is due. Safe to run repeatedly: an archived ticket is never due again. */
export async function archiveDueTickets(db: Db, now: Date, setting: ArchiveSetting, who: Who = ARCHIVER) {
  const due = await dueTickets(db, now, setting)
  if (!due.length) return []
  const at = now.toISOString()
  await db.update(tickets).set({ archivedAt: at }).where(inArray(tickets.number, due.map(t => t.number)))
  await db.insert(auditLog).values(due.map(t => ({
    at, actor: who.name, actorKind: who.kind, tokenName: null, action: 'ticket.archive', target: `SD-${t.number}`,
    detail: JSON.stringify({ closedAt: t.closedAt, rule: `${setting.value} ${setting.unit}` }),
  })))
  return due.map(t => ({ number: t.number, closedAt: t.closedAt }))
}

export type ArchiveOutcome = 'ok' | 'missing' | 'not-closed' | 'already-archived' | 'not-archived'

/** Archive one ticket by hand. Only a done or canceled ticket can be archived. */
export async function archiveTicket(db: Db, number: number, at: string, who: Who): Promise<ArchiveOutcome> {
  const t = await db.select().from(tickets).where(eq(tickets.number, number)).get()
  if (!t) return 'missing'
  if (!isClosed(t.status as Status)) return 'not-closed'
  if (t.archivedAt) return 'already-archived'
  await db.update(tickets).set({ archivedAt: at }).where(eq(tickets.number, number))
  await db.insert(auditLog).values({ at, actor: who.name, actorKind: who.kind, tokenName: null, action: 'ticket.archive', target: `SD-${number}`, detail: JSON.stringify({ manual: true }) })
  return 'ok'
}

/** Bring a ticket back. Its closing time restarts, otherwise the next run would archive it again at once. */
export async function unarchiveTicket(db: Db, number: number, at: string, who: Who): Promise<ArchiveOutcome> {
  const t = await db.select().from(tickets).where(eq(tickets.number, number)).get()
  if (!t) return 'missing'
  if (!t.archivedAt) return 'not-archived'
  await db.update(tickets).set({ archivedAt: null, closedAt: at }).where(eq(tickets.number, number))
  await db.insert(auditLog).values({ at, actor: who.name, actorKind: who.kind, tokenName: null, action: 'ticket.unarchive', target: `SD-${number}`, detail: null })
  return 'ok'
}
