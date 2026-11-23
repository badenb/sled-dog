import { inArray } from 'drizzle-orm'
import { searchQuery, type SearchResult } from '#shared/contract'
import { MAX_TERMS, matchedIn, snippet, tokenize } from '../../shared/search'
import { useDb, schema } from '../db'
import { requirePermission } from '../utils/auth'
import { envelope } from '../utils/envelope'
import { searchTickets } from '../utils/search'
import { toLite, withSteps } from '../utils/steps'
import { toSubtaskLite, withSubtasks } from '../utils/subtasks'
import { toTicket, withPullRequests } from '../utils/tickets'

// Find tickets by reference, title, description, assignee, or anything inside them (subtasks, trail steps, pull
// request titles). Terms are AND-ed; "quoted phrases" stay together. Archived tickets are included unless asked
// otherwise. Anyone who can read tickets can search them: this exposes nothing the list does not.
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const q = await getValidatedQuery(event, searchQuery.parse)
  const terms = tokenize(q.q)
  if (!terms.length) throw createError({ statusCode: 400, statusMessage: 'Type something to search for' })
  if (terms.length > MAX_TERMS) throw createError({ statusCode: 400, statusMessage: `Use at most ${MAX_TERMS} search terms` })

  const db = await useDb()
  const { numbers, total } = await searchTickets(db, { terms, status: q.status, assignee: q.assignee, archived: q.archived, limit: q.limit })
  const rows = numbers.length ? await db.select().from(schema.tickets).where(inArray(schema.tickets.number, numbers)) : []
  const ordered = numbers.map(n => rows.find(r => r.number === n)!).filter(Boolean)

  // Load the detail to explain each match, then send the compact shape the board uses.
  const detailed = await withSubtasks(await withSteps(await withPullRequests(ordered.map(toTicket)), actor, true), true)
  const results: SearchResult[] = detailed.map((t) => {
    const full = t as typeof t & { steps: Parameters<typeof toLite>[0][], subtasks: Parameters<typeof toSubtaskLite>[0][] }
    return {
      ...t, steps: full.steps.map(toLite), subtasks: full.subtasks.map(toSubtaskLite),
      matchedIn: matchedIn({ ...t, steps: full.steps, subtasks: full.subtasks, pullRequests: t.pullRequests }, terms),
      snippet: snippet(t.body, terms),
    }
  })
  return envelope(results, { q: q.q, terms, limit: q.limit, total, truncated: total > results.length, archived: q.archived, complete: true })
})
