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
/** No business time passes on a weekend, so a Saturday or Sunday counts as the very end of Friday. */
export function businessMoment(now: Date): Date {
  const day = now.getUTCDay()
  if (day !== 0 && day !== 6) return now
  const friday = new Date(now)
  friday.setUTCDate(friday.getUTCDate() - (day === 6 ? 1 : 2))
  friday.setUTCHours(23, 59, 59, 999)
  return friday
}

export function archiveCutoff(now: Date, setting: ArchiveSetting): Date | null {
  if (setting.value <= 0) return null
  // Without the weekend adjustment, Saturday stepped back one day lands on Friday and counts as a whole business
  // day, so tickets were archived up to two days early.
  if (setting.unit === 'business_days') return subtractBusinessDays(businessMoment(now), setting.value)
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - setting.value)
  return d
}

export function isArchivable(ticket: { status: Status, closedAt: string | null, archivedAt: string | null }, cutoff: Date | null): boolean {
  return !!cutoff && isClosed(ticket.status) && !ticket.archivedAt && !!ticket.closedAt && new Date(ticket.closedAt).getTime() <= cutoff.getTime()
}

export const describeSetting = (s: ArchiveSetting) =>
  s.value <= 0 ? 'never (manual only)' : `${s.value} ${s.unit === 'business_days' ? 'business day' : 'day'}${s.value === 1 ? '' : 's'}`

/**
 * The first moment a ticket closed at `closedAt` becomes due for archiving, or null if the rule is "never".
 * Found by searching on archiveCutoff itself (which only ever moves forward), so this can never disagree with
 * what the archiver does.
 */
export function archiveDueAt(closedAt: string, setting: ArchiveSetting): Date | null {
  if (setting.value <= 0) return null
  const closed = new Date(closedAt).getTime()
  if (Number.isNaN(closed)) return null
  const isDue = (t: number) => closed <= archiveCutoff(new Date(t), setting)!.getTime()
  let low = closed
  let high = closed + (setting.value * 2 + 14) * 86_400_000 // more than enough: n business days is at most about 1.4n + 4 calendar days
  if (!isDue(high)) return null
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (isDue(mid)) high = mid
    else low = mid
  }
  return new Date(high)
}

/** The choices offered in settings. Teams usually archive after a few business days; 30 days is the default. */
export const ARCHIVE_PRESETS: { label: string, setting: ArchiveSetting }[] = [
  { label: '3 business days', setting: { value: 3, unit: 'business_days' } },
  { label: '5 business days', setting: { value: 5, unit: 'business_days' } },
  { label: '2 weeks', setting: { value: 14, unit: 'days' } },
  { label: '30 days', setting: { value: 30, unit: 'days' } },
  { label: 'Never', setting: { value: 0, unit: 'days' } },
]

/** Which preset a setting is, if any (0 is "never" whatever its unit). */
export const presetFor = (s: ArchiveSetting) =>
  ARCHIVE_PRESETS.find(p => (s.value === 0 && p.setting.value === 0) || (p.setting.value === s.value && p.setting.unit === s.unit)) ?? null
