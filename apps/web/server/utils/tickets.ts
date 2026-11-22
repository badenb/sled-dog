import { inArray } from 'drizzle-orm'
import type { PullRequestSummary, Ticket } from '#shared/contract'
import { useDb, schema } from '../db'

export const ticketId = (number: number) => `SD-${number}`

export function toTicket(row: typeof schema.tickets.$inferSelect): Ticket {
  return { ...row, id: ticketId(row.number), status: row.status as Ticket['status'], priority: row.priority as Ticket['priority'] }
}

export function parseTicketRef(ref: string): number {
  const match = /^(?:SD-)?([1-9][0-9]*)$/i.exec(ref)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Ticket reference must look like SD-12' })
  return Number(match[1])
}

/** Attach linked pull requests (one extra query pair, not one per ticket). */
export async function withPullRequests(list: Ticket[]): Promise<Ticket[]> {
  if (!list.length) return list
  const db = await useDb()
  const links = await db.select().from(schema.ticketLinks).where(inArray(schema.ticketLinks.ticketNumber, list.map(t => t.number)))
  if (!links.length) return list.map(t => ({ ...t, pullRequests: [] }))
  const rows = await db.select().from(schema.pullRequests).where(inArray(schema.pullRequests.key, [...new Set(links.map(l => l.prKey))]))
  const byKey = new Map<string, PullRequestSummary>(rows.map(r => [r.key, {
    key: r.key, repo: r.repo, number: r.number, title: r.title, url: r.url, state: r.state as PullRequestSummary['state'],
    draft: r.draft, author: r.author, checks: r.checks as PullRequestSummary['checks'], reviewDecision: r.reviewDecision,
  }]))
  return list.map(t => ({ ...t, pullRequests: links.filter(l => l.ticketNumber === t.number).map(l => byKey.get(l.prKey)).filter((p): p is PullRequestSummary => !!p) }))
}
