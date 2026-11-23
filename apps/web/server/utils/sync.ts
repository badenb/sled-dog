// Pull GitHub PRs into the workspace, link them to tickets, and advance ticket status.
// Takes the db and fetch as parameters so it can be tested against an in-memory database.
import { and, eq } from 'drizzle-orm'
import { extractRefs } from '../../shared/linking'
import { githubSources, pullRequests, subtaskLinks, subtasks, ticketLinks, tickets } from '../db/schema'
import { fetchPullRequests, GitHubError, type Fetch, type GitHubConfig } from './github'
import { refreshSubtaskStatus, refreshTicketStatus, type Db, type Transition } from './status'

export interface SourceResult { source: string, prsSeen: number, linked: number, transitions: Transition[], truncated: boolean, error: string | null }

const INITIAL_WINDOW_DAYS = 30
const OVERLAP_MS = 5 * 60_000 // re-read a little history so a slow webhook/clock skew can't drop updates

export const githubConfigFromEnv = (): GitHubConfig | null => {
  const token = process.env.SLED_DOG_GITHUB_TOKEN
  return token ? { token, apiBase: process.env.SLED_DOG_GITHUB_API_BASE || 'https://api.github.com' } : null
}

export async function syncSource(
  db: Db, config: GitHubConfig, source: typeof githubSources.$inferSelect,
  { fetchImpl, now = new Date() }: { fetchImpl?: Fetch, now?: Date } = {},
): Promise<SourceResult> {
  const label = source.name
  const startedAt = now.toISOString()
  const since = source.lastSyncedAt
    ? new Date(new Date(source.lastSyncedAt).getTime() - OVERLAP_MS).toISOString()
    : new Date(now.getTime() - INITIAL_WINDOW_DAYS * 86_400_000).toISOString()
  try {
    const { rows, truncated } = await fetchPullRequests(config, source.kind as 'org' | 'repo', source.name, since, { fetchImpl })
    const existing = new Set((await db.select({ n: tickets.number }).from(tickets)).map(t => t.n))
    // "12.2" -> subtask id, so a reference like SD-12.2 resolves without a query per PR.
    const subtaskIds = new Map((await db.select().from(subtasks)).map(s => [`${s.ticketNumber}.${s.number}`, s.id]))
    const affectedTickets = new Set<number>()
    const affectedSubtasks = new Set<number>()
    let linked = 0

    for (const pr of rows) {
      const { body, ...columns } = pr
      await db.insert(pullRequests).values({ ...columns, syncedAt: startedAt })
        .onConflictDoUpdate({ target: pullRequests.key, set: { ...columns, syncedAt: startedAt } })

      // Links are re-derived from the PR text each sync, so editing a title can both add and remove a link.
      // SD-12 links the ticket; SD-12.2 links only that subtask. A subtask that does not exist is ignored
      // (never silently attached to the parent, which could move the ticket early).
      const refs = extractRefs(pr.title, pr.headBranch, body)
      const wantedTickets = refs.filter(r => r.subtask === null && existing.has(r.ticket)).map(r => r.ticket)
      const wantedSubtasks = refs.flatMap(r => (r.subtask !== null && subtaskIds.has(`${r.ticket}.${r.subtask}`) ? [subtaskIds.get(`${r.ticket}.${r.subtask}`)!] : []))

      const currentTickets = (await db.select().from(ticketLinks).where(eq(ticketLinks.prKey, pr.key))).map(l => l.ticketNumber)
      for (const n of wantedTickets) {
        if (!currentTickets.includes(n)) { await db.insert(ticketLinks).values({ ticketNumber: n, prKey: pr.key }); linked++ }
        affectedTickets.add(n)
      }
      for (const n of currentTickets.filter(n => !wantedTickets.includes(n))) {
        await db.delete(ticketLinks).where(and(eq(ticketLinks.prKey, pr.key), eq(ticketLinks.ticketNumber, n)))
        affectedTickets.add(n)
      }

      const currentSubtasks = (await db.select().from(subtaskLinks).where(eq(subtaskLinks.prKey, pr.key))).map(l => l.subtaskId)
      for (const id of wantedSubtasks) {
        if (!currentSubtasks.includes(id)) { await db.insert(subtaskLinks).values({ subtaskId: id, prKey: pr.key }); linked++ }
        affectedSubtasks.add(id)
      }
      for (const id of currentSubtasks.filter(id => !wantedSubtasks.includes(id))) {
        await db.delete(subtaskLinks).where(and(eq(subtaskLinks.prKey, pr.key), eq(subtaskLinks.subtaskId, id)))
        affectedSubtasks.add(id)
      }
    }

    // Subtasks first, then the tickets they belong to, so a ticket sees its subtasks' new status.
    const who = { name: 'github-sync', kind: 'system' }
    const transitions: Transition[] = []
    for (const id of affectedSubtasks) {
      const parent = (await db.select().from(subtasks).where(eq(subtasks.id, id)).get())?.ticketNumber
      if (parent !== undefined) affectedTickets.add(parent)
      const moved = await refreshSubtaskStatus(db, id, startedAt, who)
      if (moved) transitions.push(moved)
    }
    for (const number of affectedTickets) {
      const moved = await refreshTicketStatus(db, number, startedAt, who)
      if (moved) transitions.push(moved)
    }

    // Only advance the cursor after a fully successful pass; a truncated read keeps the old cursor so nothing is skipped.
    await db.update(githubSources).set({ lastSyncedAt: truncated ? source.lastSyncedAt : startedAt, lastError: null }).where(eq(githubSources.id, source.id))
    return { source: label, prsSeen: rows.length, linked, transitions, truncated, error: null }
  } catch (error) {
    const message = error instanceof GitHubError ? error.message : 'Sync failed unexpectedly.'
    if (!(error instanceof GitHubError)) console.error('[sled-dog] sync error', error)
    await db.update(githubSources).set({ lastError: message }).where(eq(githubSources.id, source.id))
    return { source: label, prsSeen: 0, linked: 0, transitions: [], truncated: false, error: message }
  }
}

const running = new Set<string>()

/** Sync every source in a workspace. A second concurrent call for the same workspace is refused, not queued. */
export async function syncWorkspace(db: Db, organizationId: string, config: GitHubConfig, opts: { fetchImpl?: Fetch } = {}) {
  if (running.has(organizationId)) return { skipped: true as const, results: [] as SourceResult[] }
  running.add(organizationId)
  try {
    const sources = await db.select().from(githubSources).where(eq(githubSources.organizationId, organizationId))
    const results: SourceResult[] = []
    for (const source of sources) results.push(await syncSource(db, config, source, opts))
    return { skipped: false as const, results }
  } finally {
    running.delete(organizationId)
  }
}

