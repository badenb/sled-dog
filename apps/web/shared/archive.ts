// Pure rules for closing and archiving tickets. No framework imports: unit-tested directly.
import type { Ticket } from './contract'

export type Status = Ticket['status']
export type ArchiveUnit = 'days' | 'business_days'
/** How long a ticket sits closed before it leaves the board. value 0 means never archive automatically. */
export interface ArchiveSetting { value: number, unit: ArchiveUnit }

export const DEFAULT_ARCHIVE: ArchiveSetting = { value: 30, unit: 'days' }
export const MAX_ARCHIVE_VALUE = 365

/** A ticket is closed once it is done or canceled. */
export const isClosed = (status: Status) => status === 'done' || status === 'canceled'

/**
 * When a ticket closed. Entering done or canceled starts the clock; leaving them clears it (a reopened ticket
 * is live again). Moving between done and canceled keeps the original time: it never stopped being closed.
 * updated_at cannot do this job, because it changes on every edit.
 */
export function closedAtFor(previous: Status | null, next: Status, previousClosedAt: string | null, now: string): string | null {
  if (!isClosed(next)) return null
  if (previous && isClosed(previous) && previousClosedAt) return previousClosedAt
  return now
}

const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

/** Step back n business days (Monday to Friday, in UTC), keeping the time of day. Weekends do not count. */
export function subtractBusinessDays(from: Date, n: number): Date {
  const d = new Date(from)
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    if (isWeekday(d)) left--
  }
  return d
}

/** Tickets closed at or before this moment are due for archiving. null means "never". */
export function archiveCutoff(now: Date, setting: ArchiveSetting): Date | null {
  if (setting.value <= 0) return null
  if (setting.unit === 'business_days') return subtractBusinessDays(now, setting.value)
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - setting.value)
  return d
}

export function isArchivable(ticket: { status: Status, closedAt: string | null, archivedAt: string | null }, cutoff: Date | null): boolean {
  return !!cutoff && isClosed(ticket.status) && !ticket.archivedAt && !!ticket.closedAt && new Date(ticket.closedAt).getTime() <= cutoff.getTime()
}

export const describeSetting = (s: ArchiveSetting) =>
  s.value <= 0 ? 'never (manual only)' : `${s.value} ${s.unit === 'business_days' ? 'business day' : 'day'}${s.value === 1 ? '' : 's'}`
