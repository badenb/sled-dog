import { beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { sql } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { tokenize } from '../shared/search'
import { searchTickets } from '../server/utils/search'

let db: ReturnType<typeof drizzle<typeof schema>>
const N: Record<string, number> = {}

const ago = (days: number) => new Date(Date.UTC(2026, 10, 23) - days * 86_400_000).toISOString()
async function ticket(key: string, over: Partial<typeof schema.tickets.$inferInsert> & { title: string }) {
  const [row] = await db.insert(schema.tickets).values({ status: 'todo', createdBy: 'x', createdAt: ago(10), updatedAt: ago(1), ...over }).returning()
  N[key] = row!.number
  return row!
}
const pr = (key: string, title: string) => db.insert(schema.pullRequests).values({
  key, repo: key.split('#')[0]!, number: Number(key.split('#')[1]), title, url: `https://x/${key}`, state: 'open', draft: false,
  checks: 'none', createdAt: ago(2), updatedAt: ago(1), syncedAt: ago(1),
}).onConflictDoNothing()
const run = (query: string, extra: Partial<Parameters<typeof searchTickets>[1]> = {}) =>
  searchTickets(db, { terms: tokenize(query), archived: 'all', limit: 30, ...extra })
const names = async (query: string, extra = {}) => (await run(query, extra)).numbers.map(n => Object.entries(N).find(([, v]) => v === n)![0])

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  await ticket('login', { title: 'Fix login redirect loop', body: 'Safari blocks third-party cookies', assignee: 'baden', status: 'in_progress' })
  await ticket('email', { title: 'Email delivery for invitations', body: 'Use Resend. Login links need it.', assignee: 'dana', status: 'done', closedAt: ago(40), archivedAt: ago(10) })
  await ticket('checkout', { title: 'Checkout rewrite' })
  await ticket('pricing', { title: 'Pricing page 100% off banner', body: 'Handles the a_b test and c:\\dir' })
  await ticket('rate', { title: 'Rate limit tokens', status: 'canceled', closedAt: ago(50), archivedAt: ago(20) })

  const c = N.checkout!
  const [api] = await db.insert(schema.subtasks).values({ ticketNumber: c, number: 1, title: 'API changes', assignee: 'alex', createdBy: 'x', createdAt: ago(5), updatedAt: ago(5) }).returning()
  await db.insert(schema.subtasks).values({ ticketNumber: c, number: 2, title: 'Checkout UI', createdBy: 'x', createdAt: ago(5), updatedAt: ago(5) })
  await db.insert(schema.ticketSteps).values([
    { ticketNumber: c, title: 'Design review', position: 1, createdAt: ago(5), updatedAt: ago(5) },
    { ticketNumber: c, title: 'Legal approval', position: 2, createdAt: ago(5), updatedAt: ago(5) },
  ])
  await pr('acme/web#50', 'Add payments endpoint'); await pr('acme/web#41', 'Checkout epic')
  await db.insert(schema.subtaskLinks).values({ subtaskId: api!.id, prKey: 'acme/web#50' })
  await db.insert(schema.ticketLinks).values({ ticketNumber: c, prKey: 'acme/web#41' })
})

describe('what search looks at', () => {
  it('finds a term in the title, the description, or the assignee', async () => {
    expect(await names('redirect')).toEqual(['login'])
    expect(await names('cookies')).toEqual(['login'])
    expect(await names('baden')).toEqual(['login'])
  })
  it('ignores case', async () => {
    expect(await names('SAFARI')).toEqual(['login'])
    expect(await names('dAnA')).toEqual(['email'])
  })
  it('finds a ticket through its subtasks, steps, and pull requests', async () => {
    expect(await names('alex')).toEqual(['checkout']) // a subtask's assignee
    expect(await names('changes')).toEqual(['checkout']) // a subtask's title
    expect(await names('legal')).toEqual(['checkout']) // a trail step
    expect(await names('payments')).toEqual(['checkout']) // the PR on a subtask
    expect(await names('epic')).toEqual(['checkout']) // the PR on the ticket
    expect(await names('web#50')).toEqual(['checkout']) // a PR by repo and number
    expect(await names('#41')).toEqual(['checkout'])
  })
})

describe('terms and phrases', () => {
  it('requires every term (AND), in any order, in any field', async () => {
    expect(await names('login cookies')).toEqual(['login'])
    expect(await names('cookies login')).toEqual(['login'])
    expect(await names('login resend')).toEqual(['email']) // login (body) + resend (body)
    expect(await names('login zebra')).toEqual([])
  })
  it('keeps a "quoted phrase" together', async () => {
    expect(await names('"login redirect"')).toEqual(['login'])
    expect(await names('"redirect login"')).toEqual([]) // the words are not adjacent in that order
    expect(await names('redirect login')).toEqual(['login']) // as two terms, order does not matter
  })
  it('matches nothing, and does not error, with no terms', async () => {
    expect(await run('')).toEqual({ numbers: [], total: 0 })
  })
})

describe('references', () => {
  it('SD-n finds the ticket first, even when other tickets mention it in text', async () => {
    expect((await run(`SD-${N.checkout}`)).numbers[0]).toBe(N.checkout)
    expect((await run(String(N.checkout))).numbers[0]).toBe(N.checkout)
  })
  it('SD-n.m needs that subtask to exist', async () => {
    expect((await run(`SD-${N.checkout}.1`)).numbers).toEqual([N.checkout])
    expect((await run(`SD-${N.checkout}.2`)).numbers).toEqual([N.checkout])
    expect((await run(`SD-${N.checkout}.9`)).numbers).toEqual([])
    expect((await run('SD-999')).numbers).toEqual([])
  })
  it('a reference combines with words', async () => {
    expect((await run(`SD-${N.checkout} legal`)).numbers).toEqual([N.checkout])
    expect((await run(`SD-${N.login} legal`)).numbers).toEqual([])
  })
})

describe('safety: user input is only ever data', () => {
  it('% and _ and backslash match themselves, not as wildcards', async () => {
    expect(await names('100%')).toEqual(['pricing'])
    expect(await names('%')).toEqual(['pricing']) // alone it must not match everything
    expect(await names('a_b')).toEqual(['pricing'])
    expect(await names('_')).toEqual(['pricing']) // only the tickets that contain an underscore
    expect(await names('a%b')).toEqual([])
    expect(await names('a_c')).toEqual([]) // _ must not mean "any one character"
    expect(await names('c:\\dir')).toEqual(['pricing'])
    expect(await names('\\')).toEqual(['pricing']) // a lone backslash matches the one ticket that really contains one
  })
  it('SQL in a term is just text: it matches nothing, errors nothing, and drops nothing', async () => {
    for (const evil of [`' OR 1=1 --`, `"; DROP TABLE tickets; --`, `x' UNION SELECT number FROM tickets --`, `') OR ('1'='1`]) {
      expect((await run(evil)).numbers, evil).toEqual([])
    }
    expect((await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM tickets`))[0]!.n).toBe(5)
  })
  it('hostile filter values are bound too', async () => {
    expect((await run('login', { assignee: `x' OR '1'='1` })).numbers).toEqual([])
    expect((await run('login', { status: `done' OR '1'='1` })).numbers).toEqual([])
  })
})

describe('archived tickets, filters, and order', () => {
  it('searches archived tickets by default, since finding old work is the point', async () => {
    expect(await names('login')).toEqual(['login', 'email']) // both: one live, one archived
  })
  it('can hide or isolate archived tickets', async () => {
    expect(await names('login', { archived: 'exclude' })).toEqual(['login'])
    expect(await names('login', { archived: 'only' })).toEqual(['email'])
    expect(await names('limit', { archived: 'only' })).toEqual(['rate']) // an archived canceled ticket
  })
  it('filters by status and by assignee (ignoring case)', async () => {
    expect(await names('login', { status: 'done' })).toEqual(['email'])
    expect(await names('login', { assignee: 'BADEN' })).toEqual(['login'])
    expect(await names('login', { status: 'in_progress', assignee: 'dana' })).toEqual([])
  })
  it('ranks a title match above a description-only match', async () => {
    // "login" is in the title of one ticket and only in the description of the other
    expect((await run('login')).numbers).toEqual([N.login, N.email])
  })
  it('breaks ties by most recently updated', async () => {
    await ticket('old', { title: 'Shared word zebra', updatedAt: ago(30) })
    await ticket('new', { title: 'Shared word zebra', updatedAt: ago(1) })
    expect(await names('zebra')).toEqual(['new', 'old'])
  })
  it('reports the real total when the limit cuts the list off', async () => {
    for (let i = 0; i < 5; i++) await ticket(`filler${i}`, { title: `Filler ${i} unicorn` })
    const result = await run('unicorn', { limit: 2 })
    expect(result.numbers).toHaveLength(2)
    expect(result.total).toBe(5)
    expect((await run('unicorn', { limit: 50 })).total).toBe(5)
  })
})
