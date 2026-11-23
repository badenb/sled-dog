// Ticket search. One function, so a faster engine (SQLite FTS5 is available) can replace it later without
// touching the route. It runs LIKE across the tables at query time: there is no separate index to keep in sync,
// so there is no way for search to go stale. Measured on a laptop, worst case (nothing matches, every table scanned),
// with subtasks, steps and a PR on every ticket: about 15 ms at 2,000 tickets and 70 ms at 10,000. Revisit past that.
//
// Every value from the user is a bound parameter, and % _ \ in a term are escaped so they match themselves.
// The db is a parameter and nothing here imports Nuxt, so it is tested against an in-memory database.
import { sql, type SQL } from 'drizzle-orm'
import { likePattern, refOf } from '../../shared/search'
import type { Db } from './status'

export interface SearchParams {
  terms: string[]
  status?: string
  assignee?: string
  archived: 'exclude' | 'only' | 'all'
  limit: number
}

const ESCAPE = sql.raw(`ESCAPE '\\'`)
const like = (column: SQL, pattern: string) => sql`lower(${column}) LIKE ${pattern} ${ESCAPE}`

/** True if the pattern appears in the ticket, its subtasks, its steps, or the titles of its pull requests. */
function textMatch(pattern: string): SQL {
  return sql`(
    ${like(sql`t.title`, pattern)} OR ${like(sql`t.body`, pattern)} OR ${like(sql`coalesce(t.assignee, '')`, pattern)}
    OR EXISTS (SELECT 1 FROM subtasks s WHERE s.ticket_number = t.number AND (${like(sql`s.title`, pattern)} OR ${like(sql`coalesce(s.assignee, '')`, pattern)}))
    OR EXISTS (SELECT 1 FROM ticket_steps st WHERE st.ticket_number = t.number AND ${like(sql`st.title`, pattern)})
    OR EXISTS (SELECT 1 FROM ticket_links l JOIN pull_requests p ON p.key = l.pr_key WHERE l.ticket_number = t.number AND (${like(sql`p.title`, pattern)} OR ${like(sql`p.key`, pattern)}))
    OR EXISTS (SELECT 1 FROM subtasks s JOIN subtask_links sl ON sl.subtask_id = s.id JOIN pull_requests p ON p.key = sl.pr_key WHERE s.ticket_number = t.number AND (${like(sql`p.title`, pattern)} OR ${like(sql`p.key`, pattern)}))
  )`
}

/** SD-12.2 needs that subtask to exist; SD-12 or 12 matches the ticket OR text that contains it. */
function termCondition(term: string): SQL {
  const ref = refOf(term)
  if (ref && ref.subtask !== null) {
    return sql`(t.number = ${ref.ticket} AND EXISTS (SELECT 1 FROM subtasks s WHERE s.ticket_number = ${ref.ticket} AND s.number = ${ref.subtask}))`
  }
  return ref ? sql`(t.number = ${ref.ticket} OR ${textMatch(likePattern(term))})` : textMatch(likePattern(term))
}

/** Reference first, then title, assignee, then description; so the ticket you named, or titled, comes first. */
function termScore(term: string): SQL {
  const ref = refOf(term)
  const pattern = likePattern(term)
  return sql`(${ref ? sql`CASE WHEN t.number = ${ref.ticket} THEN 10 ELSE 0 END` : sql`0`}
    + CASE WHEN ${like(sql`t.title`, pattern)} THEN 4 ELSE 0 END
    + CASE WHEN ${like(sql`coalesce(t.assignee, '')`, pattern)} THEN 2 ELSE 0 END
    + CASE WHEN ${like(sql`t.body`, pattern)} THEN 1 ELSE 0 END)`
}

/** Matching ticket numbers, best first, plus how many tickets match in total. */
export async function searchTickets(db: Db, p: SearchParams): Promise<{ numbers: number[], total: number }> {
  if (!p.terms.length) return { numbers: [], total: 0 } // nothing to look for matches nothing (and would not be valid SQL)
  const filters: SQL[] = [sql`1 = 1`]
  if (p.archived === 'exclude') filters.push(sql`t.archived_at IS NULL`)
  if (p.archived === 'only') filters.push(sql`t.archived_at IS NOT NULL`)
  if (p.status) filters.push(sql`t.status = ${p.status}`)
  if (p.assignee) filters.push(sql`lower(coalesce(t.assignee, '')) = lower(${p.assignee})`)
  const where = sql`${sql.join(filters, sql` AND `)} AND ${sql.join(p.terms.map(termCondition), sql` AND `)}`
  const score = sql.join(p.terms.map(termScore), sql` + `)

  const rows = await db.all<{ number: number }>(sql`SELECT t.number AS number, (${score}) AS score FROM tickets t WHERE ${where} ORDER BY score DESC, t.updated_at DESC LIMIT ${p.limit}`)
  const numbers = rows.map(r => Number(r.number))
  const total = numbers.length < p.limit ? numbers.length
    : Number((await db.get<{ n: number }>(sql`SELECT count(*) AS n FROM tickets t WHERE ${where}`))?.n ?? numbers.length)
  return { numbers, total }
}
