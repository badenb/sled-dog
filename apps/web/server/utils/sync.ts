// Pull GitHub PRs into the workspace, link them to tickets, and advance ticket status.
// Takes the db and fetch as parameters so it can be tested against an in-memory database.
import { and, eq, inArray } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { extractTicketNumbers, nextStatus } from '../../shared/linking'
import type { Ticket } from '../../shared/contract'
import type * as schemaModule from '../db/schema'
import { githubSources, pullRequests, ticketLinks, tickets, auditLog } from '../db/schema'
import { fetchPullRequests, GitHubError, type Fetch, type GitHubConfig } from './github'

type Db = LibSQLDatabase<typeof schemaModule>

export interface SourceResult { source: string, prsSeen: number, linked: number, transitions: { ticket: string, from: string, to: string }[], truncated: boolean, error: string | null }

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
    const affected = new Set<number>()
    let linked = 0

    for (const pr of rows) {
      const { body, ...columns } = pr
      await db.insert(pullRequests).values({ ...columns, syncedAt: startedAt })
        .onConflictDoUpdate({ target: pullRequests.key, set: { ...columns, syncedAt: startedAt } })

      // Links are re-derived from the PR text each sync, so editing a title can both add and remove a link.
      const wanted = extractTicketNumbers(pr.title, pr.headBranch, body).filter(n => existing.has(n))
      const current = (await db.select().from(ticketLinks).where(eq(ticketLinks.prKey, pr.key))).map(l => l.ticketNumber)
      for (const n of wanted) {
        if (!current.includes(n)) { await db.insert(ticketLinks).values({ ticketNumber: n, prKey: pr.key }); linked++ }
        affected.add(n)
      }
      for (const n of current.filter(n => !wanted.includes(n))) {
        await db.delete(ticketLinks).where(and(eq(ticketLinks.prKey, pr.key), eq(ticketLinks.ticketNumber, n)))
        affected.add(n)
      }
    }

    const transitions: SourceResult['transitions'] = []
    for (const number of affected) {
      const ticket = await db.select().from(tickets).where(eq(tickets.number, number)).get()
      if (!ticket) continue
      const keys = (await db.select().from(ticketLinks).where(eq(ticketLinks.ticketNumber, number))).map(l => l.prKey)
      const prs = keys.length ? await db.select().from(pullRequests).where(inArray(pullRequests.key, keys)) : []
      const target = nextStatus(ticket.status as Ticket['status'], prs.map(p => ({ state: p.state as 'open' | 'closed' | 'merged', draft: p.draft })))
      if (target === ticket.status) continue
      await db.update(tickets).set({ status: target, updatedAt: startedAt }).where(eq(tickets.number, number))
      await db.insert(auditLog).values({
        at: startedAt, actor: 'github-sync', actorKind: 'system', tokenName: null, action: 'ticket.auto_status',
        target: `SD-${number}`, detail: JSON.stringify({ from: ticket.status, to: target, pullRequests: keys }),
      })
      transitions.push({ ticket: `SD-${number}`, from: ticket.status, to: target })
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

