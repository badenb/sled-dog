import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { archiveSettingInput } from '../shared/contract'
import { archiveCutoff, closedAtFor, describeSetting, isArchivable, isClosed, subtractBusinessDays } from '../shared/archive'
import { archiveDueTickets, archiveTicket, dueTickets, getArchiveSetting, saveArchiveSetting, unarchiveTicket } from '../server/utils/archive'
import { refreshTicketStatus } from '../server/utils/status'

// 2026 calendar used below: Thu Nov 19, Fri Nov 20, Sat Nov 21, Sun Nov 22, Mon Nov 23, Tue Nov 24, Wed Nov 25.
const at = (day: string, time = '10:00:00') => new Date(`2026-11-${day}T${time}Z`)

describe('closedAtFor', () => {
  const now = '2026-11-23T10:00:00.000Z'
  it('starts the clock when a ticket enters done or canceled', () => {
    expect(closedAtFor('in_review', 'done', null, now)).toBe(now)
    expect(closedAtFor('todo', 'canceled', null, now)).toBe(now)
    expect(closedAtFor(null, 'done', null, now)).toBe(now) // created already done
  })
  it('keeps the original time when moving between done and canceled: it never stopped being closed', () => {
    expect(closedAtFor('done', 'canceled', '2026-11-01T00:00:00.000Z', now)).toBe('2026-11-01T00:00:00.000Z')
  })
  it('clears the clock when a ticket is reopened, and for open statuses', () => {
    expect(closedAtFor('done', 'in_progress', '2026-11-01T00:00:00.000Z', now)).toBeNull()
    expect(closedAtFor('todo', 'in_review', null, now)).toBeNull()
  })
  it('starts a clock for a closed ticket that has none recorded (legacy rows)', () => {
    expect(closedAtFor('done', 'done', null, now)).toBe(now)
  })
  it('knows what is closed', () => {
    expect(['done', 'canceled'].every(s => isClosed(s as never))).toBe(true)
    expect(['backlog', 'todo', 'in_progress', 'in_review', 'test'].some(s => isClosed(s as never))).toBe(false)
  })
})

describe('subtractBusinessDays', () => {
  const iso = (d: Date) => d.toISOString()
  it('steps back over weekends without counting them', () => {
    expect(iso(subtractBusinessDays(at('25'), 3))).toBe('2026-11-20T10:00:00.000Z') // Wed - 3 business days = Fri
    expect(iso(subtractBusinessDays(at('23'), 1))).toBe('2026-11-20T10:00:00.000Z') // Mon - 1 = Fri
    expect(iso(subtractBusinessDays(at('23'), 5))).toBe('2026-11-16T10:00:00.000Z') // Mon - 5 = the Monday before
  })
  it('handles starting on a weekend', () => {
    expect(iso(subtractBusinessDays(at('21'), 1))).toBe('2026-11-20T10:00:00.000Z') // Sat - 1 = Fri
    expect(iso(subtractBusinessDays(at('22'), 1))).toBe('2026-11-20T10:00:00.000Z') // Sun - 1 = Fri
    expect(iso(subtractBusinessDays(at('22'), 2))).toBe('2026-11-19T10:00:00.000Z') // Sun - 2 = Thu
  })
  it('keeps the time of day, crosses month boundaries, and 0 is a no-op', () => {
    expect(iso(subtractBusinessDays(new Date('2026-12-01T17:45:30.000Z'), 1))).toBe('2026-11-30T17:45:30.000Z') // Tue -> Mon
    expect(iso(subtractBusinessDays(at('24'), 0))).toBe('2026-11-24T10:00:00.000Z')
  })
  it('does not mutate its input', () => {
    const from = at('25')
    subtractBusinessDays(from, 3)
    expect(from.toISOString()).toBe('2026-11-25T10:00:00.000Z')
  })
})

describe('archiveCutoff and isArchivable', () => {
  it('0 or less means never', () => {
    expect(archiveCutoff(at('23'), { value: 0, unit: 'days' })).toBeNull()
    expect(archiveCutoff(at('23'), { value: -1, unit: 'business_days' })).toBeNull()
  })
  it('calendar days and business days differ across a weekend', () => {
    expect(archiveCutoff(at('23'), { value: 3, unit: 'days' })!.toISOString()).toBe('2026-11-20T10:00:00.000Z') // Mon - 3 days = Fri
    expect(archiveCutoff(at('23'), { value: 3, unit: 'business_days' })!.toISOString()).toBe('2026-11-18T10:00:00.000Z') // Mon - 3 business days = Wed
  })
  it('a ticket is due only if it is closed, not archived, and closed at or before the cutoff', () => {
    const cutoff = at('20')
    const t = (over: object) => ({ status: 'done' as const, closedAt: '2026-11-19T00:00:00.000Z', archivedAt: null, ...over })
    expect(isArchivable(t({}), cutoff)).toBe(true)
    expect(isArchivable(t({ closedAt: cutoff.toISOString() }), cutoff)).toBe(true) // the boundary counts
    expect(isArchivable(t({ closedAt: '2026-11-21T00:00:00.000Z' }), cutoff)).toBe(false)
    expect(isArchivable(t({ status: 'in_review' }), cutoff)).toBe(false)
    expect(isArchivable(t({ archivedAt: '2026-11-20T00:00:00.000Z' }), cutoff)).toBe(false)
    expect(isArchivable(t({ closedAt: null }), cutoff)).toBe(false)
    expect(isArchivable(t({}), null)).toBe(false)
  })
  it('describes the setting in words', () => {
    expect(describeSetting({ value: 3, unit: 'business_days' })).toBe('3 business days')
    expect(describeSetting({ value: 1, unit: 'business_days' })).toBe('1 business day')
    expect(describeSetting({ value: 30, unit: 'days' })).toBe('30 days')
    expect(describeSetting({ value: 0, unit: 'days' })).toBe('never (manual only)')
  })
})

describe('archiveSettingInput', () => {
  it('accepts sensible values, including 0 for never', () => {
    expect(archiveSettingInput.parse({ value: 3, unit: 'business_days' })).toEqual({ value: 3, unit: 'business_days' })
    expect(archiveSettingInput.parse({ value: 0, unit: 'days' }).value).toBe(0)
    expect(archiveSettingInput.parse({ value: 365, unit: 'days' }).value).toBe(365)
  })
  it('rejects negatives, absurd values, fractions, strings and unknown units', () => {
    for (const bad of [{ value: -1, unit: 'days' }, { value: 366, unit: 'days' }, { value: 2.5, unit: 'days' }, { value: '3', unit: 'days' }, { value: 3, unit: 'weeks' }, { value: 3 }]) {
      expect(() => archiveSettingInput.parse(bad)).toThrow()
    }
  })
})

// ── against a real (in-memory) database ──────────────────────────────────────
let db: ReturnType<typeof drizzle<typeof schema>>
beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
})

async function ticket(over: Partial<typeof schema.tickets.$inferInsert> = {}) {
  const [row] = await db.insert(schema.tickets).values({
    title: 't', status: 'done', createdBy: 'x', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    closedAt: '2026-10-01T00:00:00.000Z', ...over, // by default closed long ago: 53 days before Nov 23
  }).returning()
  return row!
}
const days30 = { value: 30, unit: 'days' as const }
const row = (n: number) => db.select().from(schema.tickets).where(eq(schema.tickets.number, n)).get()

describe('archiveDueTickets', () => {
  it('archives old done and canceled tickets, and only those', async () => {
    const oldDone = await ticket()
    const oldCanceled = await ticket({ status: 'canceled' })
    const recent = await ticket({ closedAt: '2026-11-20T00:00:00.000Z' })
    const open = await ticket({ status: 'in_review', closedAt: null })
    const already = await ticket({ archivedAt: '2026-11-10T00:00:00.000Z' })
    const legacy = await ticket({ closedAt: null }) // closed but no time recorded: never archived blindly

    const archived = await archiveDueTickets(db, at('23'), days30)
    expect(archived.map(a => a.number).sort()).toEqual([oldDone.number, oldCanceled.number].sort())
    expect((await row(recent.number))!.archivedAt).toBeNull()
    expect((await row(open.number))!.archivedAt).toBeNull()
    expect((await row(already.number))!.archivedAt).toBe('2026-11-10T00:00:00.000Z') // untouched
    expect((await row(legacy.number))!.archivedAt).toBeNull()
  })

  it('never deletes anything, and leaves status alone', async () => {
    const t = await ticket()
    await archiveDueTickets(db, at('23'), days30)
    expect((await row(t.number))).toMatchObject({ status: 'done', title: 't' })
  })

  it('is idempotent: running again archives nothing more', async () => {
    await ticket()
    expect(await archiveDueTickets(db, at('23'), days30)).toHaveLength(1)
    expect(await archiveDueTickets(db, at('23', '11:00:00'), days30)).toEqual([])
  })

  it('0 means never', async () => {
    await ticket()
    expect(await archiveDueTickets(db, at('23'), { value: 0, unit: 'days' })).toEqual([])
  })

  it('audits each ticket as the archiver (a system actor)', async () => {
    const t = await ticket()
    await archiveDueTickets(db, at('23'), days30)
    const [entry] = await db.select().from(schema.auditLog)
    expect(entry).toMatchObject({ actor: 'archiver', actorKind: 'system', action: 'ticket.archive', target: `SD-${t.number}` })
    expect(JSON.parse(entry!.detail!)).toMatchObject({ closedAt: '2026-10-01T00:00:00.000Z', rule: '30 days' })
  })

  it('business days: weekends do not count towards "3 days"', async () => {
    // Closed Thursday noon. On Monday 10:00, 3 calendar days (cutoff Friday) have passed; 3 business days (cutoff Wednesday) have not.
    await ticket({ closedAt: '2026-11-19T12:00:00.000Z' })
    expect(await dueTickets(db, at('23'), { value: 3, unit: 'business_days' })).toHaveLength(0)
    expect(await dueTickets(db, at('23'), { value: 3, unit: 'days' })).toHaveLength(1)
    // By Tuesday morning 3 business days (Thu->Fri->Mon->Tue) have passed.
    expect(await dueTickets(db, at('25', '12:00:00'), { value: 3, unit: 'business_days' })).toHaveLength(1)
  })

  it('the cutoff is exact to the time of day', async () => {
    await ticket({ closedAt: '2026-11-20T15:00:00.000Z' }) // Friday 15:00
    expect(await dueTickets(db, at('23'), { value: 1, unit: 'business_days' })).toHaveLength(0) // Mon 10:00: cutoff Fri 10:00
    expect(await dueTickets(db, at('23', '15:00:00'), { value: 1, unit: 'business_days' })).toHaveLength(1) // Mon 15:00: cutoff Fri 15:00
  })
})

describe('archiving by hand, and bringing tickets back', () => {
  const who = { name: 'Olivia', kind: 'user' }
  it('only a done or canceled ticket can be archived, and not twice', async () => {
    const open = await ticket({ status: 'in_progress', closedAt: null })
    const done = await ticket({ closedAt: '2026-11-22T00:00:00.000Z' })
    expect(await archiveTicket(db, open.number, '2026-11-23T00:00:00.000Z', who)).toBe('not-closed')
    expect(await archiveTicket(db, 999, '2026-11-23T00:00:00.000Z', who)).toBe('missing')
    expect(await archiveTicket(db, done.number, '2026-11-23T00:00:00.000Z', who)).toBe('ok')
    expect(await archiveTicket(db, done.number, '2026-11-23T01:00:00.000Z', who)).toBe('already-archived')
    expect((await row(open.number))!.archivedAt).toBeNull()
  })

  it('unarchive restarts the clock, so the next run does not archive it again at once', async () => {
    const t = await ticket() // closed Oct 1: long overdue
    await archiveDueTickets(db, at('23'), days30)
    expect((await row(t.number))!.archivedAt).not.toBeNull()
    expect(await unarchiveTicket(db, t.number, '2026-11-23T10:00:00.000Z', who)).toBe('ok')
    expect(await row(t.number)).toMatchObject({ archivedAt: null, closedAt: '2026-11-23T10:00:00.000Z' })
    expect(await archiveDueTickets(db, at('23', '10:05:00'), days30)).toEqual([]) // a fresh grace period
    expect(await archiveDueTickets(db, new Date('2026-12-24T10:00:00Z'), days30)).toHaveLength(1) // ...which does expire (31 days on)
  })

  it('refuses to unarchive what is not archived, and audits real changes', async () => {
    const t = await ticket()
    expect(await unarchiveTicket(db, t.number, '2026-11-23T00:00:00.000Z', who)).toBe('not-archived')
    expect(await unarchiveTicket(db, 999, '2026-11-23T00:00:00.000Z', who)).toBe('missing')
    await archiveTicket(db, t.number, '2026-11-23T00:00:00.000Z', who)
    await unarchiveTicket(db, t.number, '2026-11-23T01:00:00.000Z', who)
    expect((await db.select().from(schema.auditLog)).map(a => a.action)).toEqual(['ticket.archive', 'ticket.unarchive'])
  })
})

describe('the workspace setting', () => {
  it('defaults to 30 days when nothing is saved', async () => {
    expect(await getArchiveSetting(db, 'org1')).toEqual({ value: 30, unit: 'days' })
  })
  it('saves and updates per workspace', async () => {
    await saveArchiveSetting(db, 'org1', { value: 3, unit: 'business_days' }, '2026-11-23T00:00:00.000Z')
    await saveArchiveSetting(db, 'org2', { value: 0, unit: 'days' }, '2026-11-23T00:00:00.000Z')
    expect(await getArchiveSetting(db, 'org1')).toEqual({ value: 3, unit: 'business_days' })
    await saveArchiveSetting(db, 'org1', { value: 5, unit: 'business_days' }, '2026-11-24T00:00:00.000Z')
    expect(await getArchiveSetting(db, 'org1')).toEqual({ value: 5, unit: 'business_days' })
    expect(await getArchiveSetting(db, 'org2')).toEqual({ value: 0, unit: 'days' })
  })
})

describe('closing time follows automatic status moves', () => {
  it('stamps closed_at when subtasks carry a ticket to done, and not for earlier statuses', async () => {
    const t = await ticket({ status: 'in_review', closedAt: null })
    for (const n of [1, 2]) await db.insert(schema.subtasks).values({ ticketNumber: t.number, number: n, title: `p${n}`, status: 'test', createdBy: 'x', createdAt: 'a', updatedAt: 'a' })
    const who = { name: 'github-sync', kind: 'system' }
    await refreshTicketStatus(db, t.number, '2026-11-23T10:00:00.000Z', who)
    expect(await row(t.number)).toMatchObject({ status: 'test', closedAt: null }) // test is not closed
    await db.update(schema.subtasks).set({ status: 'done' })
    await refreshTicketStatus(db, t.number, '2026-11-24T10:00:00.000Z', who)
    expect(await row(t.number)).toMatchObject({ status: 'done', closedAt: '2026-11-24T10:00:00.000Z' })
  })
})

describe('migration 0004 backfill', () => {
  it('gives already-closed tickets closed_at = updated_at, and leaves open ones null', async () => {
    const [done, canceled, open] = [
      await ticket({ status: 'done', closedAt: null, updatedAt: '2026-10-01T00:00:00.000Z' }),
      await ticket({ status: 'canceled', closedAt: null, updatedAt: '2026-10-02T00:00:00.000Z' }),
      await ticket({ status: 'todo', closedAt: null, updatedAt: '2026-10-03T00:00:00.000Z' }),
    ]
    const backfill = readFileSync('./drizzle/0004_archive.sql', 'utf8').split('--> statement-breakpoint').pop()!
    await db.run(sql.raw(backfill))
    expect((await row(done.number))!.closedAt).toBe('2026-10-01T00:00:00.000Z')
    expect((await row(canceled.number))!.closedAt).toBe('2026-10-02T00:00:00.000Z')
    expect((await row(open.number))!.closedAt).toBeNull()
  })
})
