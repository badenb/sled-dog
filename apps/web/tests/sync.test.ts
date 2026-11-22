import { beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { searchQuery, graphqlUrl, GitHubError } from '../server/utils/github'
import { syncSource, syncWorkspace } from '../server/utils/sync'

const config = { token: 'ghp_supersecret', apiBase: 'https://api.github.com' }
let db: ReturnType<typeof drizzle<typeof schema>>

const node = (over: Record<string, unknown> = {}) => ({
  number: 42, title: 'Add login', body: '', url: 'https://github.com/acme/web/pull/42', state: 'OPEN', isDraft: false, merged: false,
  mergedAt: null, createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-21T10:00:00Z', additions: 10, deletions: 2,
  headRefName: 'feature/SD-1-login', baseRefName: 'main', reviewDecision: 'APPROVED', author: { login: 'baden' },
  repository: { nameWithOwner: 'acme/web' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...over,
})
const reply = (nodes: unknown[], hasNextPage = false) =>
  async () => new Response(JSON.stringify({ data: { search: { pageInfo: { hasNextPage, endCursor: 'c' }, nodes } } }), { status: 200 })

async function seed() {
  const now = new Date().toISOString()
  await db.insert(schema.tickets).values({ title: 'Login', status: 'todo', priority: 'none', createdBy: 'x', createdAt: now, updatedAt: now })
  const [source] = await db.insert(schema.githubSources).values({ organizationId: 'org1', kind: 'org', name: 'acme', createdAt: now }).returning()
  return source!
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
})

describe('syncSource', () => {
  it('links a PR by branch name and moves the ticket through its lifecycle', async () => {
    const source = await seed()
    const first = await syncSource(db, config, source, { fetchImpl: reply([node()]) })
    expect(first).toMatchObject({ prsSeen: 1, linked: 1, error: null })
    expect(first.transitions).toEqual([{ ticket: 'SD-1', from: 'todo', to: 'in_review' }])

    const [fresh] = await db.select().from(schema.githubSources)
    await syncSource(db, config, fresh!, { fetchImpl: reply([node({ state: 'MERGED', merged: true, mergedAt: '2026-11-22T10:00:00Z' })]) })
    const ticket = await db.select().from(schema.tickets).where(eq(schema.tickets.number, 1)).get()
    expect(ticket?.status).toBe('done')
    const audit = await db.select().from(schema.auditLog)
    expect(audit.map(a => a.action)).toEqual(['ticket.auto_status', 'ticket.auto_status'])
    expect(audit[0]).toMatchObject({ actor: 'github-sync', actorKind: 'system', target: 'SD-1' })
  })

  it('stores PR details and CI/review state', async () => {
    const source = await seed()
    await syncSource(db, config, source, { fetchImpl: reply([node()]) })
    const pr = await db.select().from(schema.pullRequests).get()
    expect(pr).toMatchObject({ key: 'acme/web#42', state: 'open', checks: 'success', reviewDecision: 'approved', additions: 10, author: 'baden' })
  })

  it('ignores references to tickets that do not exist', async () => {
    const source = await seed()
    const result = await syncSource(db, config, source, { fetchImpl: reply([node({ headRefName: 'fix/SD-99-ghost', title: 'x' })]) })
    expect(result.linked).toBe(0)
    expect(await db.select().from(schema.ticketLinks)).toHaveLength(0)
  })

  it('removes a link when the reference is edited out', async () => {
    const source = await seed()
    await syncSource(db, config, source, { fetchImpl: reply([node()]) })
    const [fresh] = await db.select().from(schema.githubSources)
    await syncSource(db, config, fresh!, { fetchImpl: reply([node({ headRefName: 'feature/login' })]) })
    expect(await db.select().from(schema.ticketLinks)).toHaveLength(0)
  })

  it('records a token failure without leaking the token', async () => {
    const source = await seed()
    const result = await syncSource(db, config, source, { fetchImpl: async () => new Response('{"message":"Bad credentials ghp_supersecret"}', { status: 401 }) })
    expect(result.error).toBe('GitHub rejected SLED_DOG_GITHUB_TOKEN.')
    expect(JSON.stringify(result)).not.toContain('ghp_supersecret')
    expect((await db.select().from(schema.githubSources).get())?.lastError).toBe(result.error)
  })

  it('keeps the old cursor when the read was truncated so nothing is skipped', async () => {
    const source = await seed()
    const result = await syncSource(db, config, source, { fetchImpl: reply([node()], true) })
    expect(result.truncated).toBe(true)
    expect((await db.select().from(schema.githubSources).get())?.lastSyncedAt).toBeNull()
  })

  it('advances the cursor after a clean sync', async () => {
    const source = await seed()
    await syncSource(db, config, source, { fetchImpl: reply([]), now: new Date('2026-11-22T12:00:00Z') })
    expect((await db.select().from(schema.githubSources).get())?.lastSyncedAt).toBe('2026-11-22T12:00:00.000Z')
  })
})

describe('syncWorkspace', () => {
  it('refuses to run twice at once for the same workspace', async () => {
    await seed()
    let release: () => void = () => {}
    const slow = () => new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ data: { search: { pageInfo: {}, nodes: [] } } }))) })
    const first = syncWorkspace(db, 'org1', config, { fetchImpl: slow })
    await new Promise(r => setTimeout(r, 20))
    expect((await syncWorkspace(db, 'org1', config, { fetchImpl: slow })).skipped).toBe(true)
    release()
    expect((await first).skipped).toBe(false)
  })
})

describe('query building', () => {
  it('rejects names that could inject extra search qualifiers', () => {
    for (const bad of ['acme updated:>2000-01-01', 'acme org:other', 'a/b/c', '', 'acme\nrepo:x/y']) {
      expect(() => searchQuery('org', bad, '2026-01-01')).toThrow(GitHubError)
    }
    expect(() => searchQuery('org', 'acme/web', '2026-01-01')).toThrow(GitHubError) // repo name given as org
    expect(() => searchQuery('repo', 'acme', '2026-01-01')).toThrow(GitHubError) // org name given as repo
    expect(searchQuery('repo', 'acme/web', '2026-01-01')).toBe('is:pr repo:acme/web updated:>=2026-01-01 sort:updated-desc')
  })
  it('derives GraphQL URLs for github.com and Enterprise', () => {
    expect(graphqlUrl('https://api.github.com')).toBe('https://api.github.com/graphql')
    expect(graphqlUrl('https://git.corp.com/api/v3/')).toBe('https://git.corp.com/api/graphql')
  })
})
