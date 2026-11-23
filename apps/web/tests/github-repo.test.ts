// A repository is read from its own pull-request list, not from GitHub's search index (which is eventually
// consistent and can miss a brand-new PR for a few seconds). These tests fake GitHub and check which query is sent.
import { beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { fetchPullRequests, GitHubError } from '../server/utils/github'
import { ORG_LAG_NOTE, syncSource } from '../server/utils/sync'

const config = { token: 'ghp_supersecret', apiBase: 'https://api.github.com' }
const SINCE = '2026-11-01T00:00:00.000Z'

const node = (n: number, over: Record<string, unknown> = {}) => ({
  number: n, title: `PR ${n}`, body: '', url: `https://github.com/acme/web/pull/${n}`, state: 'OPEN', isDraft: false, merged: false, mergedAt: null,
  createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-22T10:00:00Z', additions: 1, deletions: 0, headRefName: `feature/SD-1-x${n}`, baseRefName: 'main',
  reviewDecision: null, author: { login: 'baden' }, repository: { nameWithOwner: 'acme/web' }, commits: { nodes: [] }, ...over,
})

/** A fake GitHub that records every request, and answers a repository query and a search query differently. */
function fakeGitHub(opts: { repoPages?: unknown[][], searchNodes?: unknown[], repoMissing?: boolean } = {}) {
  const requests: { query: string, variables: Record<string, any> }[] = []
  let repoCall = 0
  const fetchImpl = async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    if (body.query.includes('repository(owner')) {
      if (opts.repoMissing) return new Response(JSON.stringify({ data: { repository: null } }))
      const pages = opts.repoPages ?? [[]]
      const nodes = pages[Math.min(repoCall, pages.length - 1)]
      const hasNextPage = repoCall < pages.length - 1
      repoCall++
      return new Response(JSON.stringify({ data: { repository: { pullRequests: { pageInfo: { hasNextPage, endCursor: `c${repoCall}` }, nodes } } } }))
    }
    return new Response(JSON.stringify({ data: { search: { pageInfo: { hasNextPage: false }, nodes: opts.searchNodes ?? [] } } }))
  }
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests }
}

describe('reading a repository directly', () => {
  it('asks the repository for its pull requests, and does not use search at all', async () => {
    const gh = fakeGitHub({ repoPages: [[node(7)]] })
    const { rows } = await fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: gh.fetchImpl })
    expect(gh.requests).toHaveLength(1)
    expect(gh.requests[0]!.query).toContain('repository(owner: $owner, name: $name)')
    expect(gh.requests[0]!.query).not.toContain('search(')
    expect(gh.requests[0]!.variables).toMatchObject({ owner: 'acme', name: 'web' })
    expect(gh.requests[0]!.variables).not.toHaveProperty('q')
    expect(rows.map(r => r.key)).toEqual(['acme/web#7'])
  })

  it('returns the same fields a search would (so everything downstream is unchanged)', async () => {
    const gh = fakeGitHub({ repoPages: [[node(7, { isDraft: true, reviewDecision: 'APPROVED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } })]] })
    const [row] = (await fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: gh.fetchImpl })).rows
    expect(row).toMatchObject({ key: 'acme/web#7', state: 'open', draft: true, reviewDecision: 'approved', checks: 'success', headBranch: 'feature/SD-1-x7', author: 'baden' })
  })

  it('stops reading as soon as it reaches a pull request older than the window', async () => {
    const gh = fakeGitHub({ repoPages: [[node(9), node(8, { updatedAt: '2026-11-10T00:00:00Z' }), node(1, { updatedAt: '2026-10-01T00:00:00Z' })], [node(0)]] })
    const { rows, truncated } = await fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: gh.fetchImpl })
    expect(rows.map(r => r.number)).toEqual([9, 8]) // #1 is older than the window
    expect(truncated).toBe(false)
    expect(gh.requests).toHaveLength(1) // it did not even ask for the second page
  })

  it('follows pages while everything is still inside the window, passing the cursor', async () => {
    const gh = fakeGitHub({ repoPages: [[node(3)], [node(2)], [node(1)]] })
    const { rows } = await fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: gh.fetchImpl })
    expect(rows.map(r => r.number)).toEqual([3, 2, 1])
    expect(gh.requests.map(r => r.variables.after)).toEqual([null, 'c1', 'c2'])
  })

  it('says it was cut off when it hits the page limit with more still in the window', async () => {
    const gh = fakeGitHub({ repoPages: [[node(5)], [node(4)], [node(3)]] })
    const result = await fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: gh.fetchImpl, maxPages: 2 })
    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(2)
  })

  it('explains a repository it cannot see, without leaking the token', async () => {
    const gh = fakeGitHub({ repoMissing: true })
    await expect(fetchPullRequests(config, 'repo', 'acme/secret', SINCE, { fetchImpl: gh.fetchImpl })).rejects.toThrow('Cannot see acme/secret. Check the name, and that the token can read it.')
    await expect(fetchPullRequests(config, 'repo', 'acme/secret', SINCE, { fetchImpl: gh.fetchImpl })).rejects.not.toThrow(/ghp_/)
  })

  it('treats the repository name as data: a name that is not owner/repo is refused before any request', async () => {
    const gh = fakeGitHub()
    for (const bad of ['acme', 'acme/web updated:>1', 'a/b/c', '', 'acme/web\nrepo:x/y', 'acme/we"b']) {
      await expect(fetchPullRequests(config, 'repo', bad, SINCE, { fetchImpl: gh.fetchImpl }), bad).rejects.toBeInstanceOf(GitHubError)
    }
    expect(gh.requests).toHaveLength(0)
    // and an allowed name travels as a GraphQL variable, never spliced into the query text
    await fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: gh.fetchImpl })
    expect(gh.requests[0]!.query).not.toContain('acme')
  })

  it('shares one error path with search: bad token, rate limit, server error, GraphQL error', async () => {
    const respond = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    await expect(fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: respond(401) })).rejects.toThrow('GitHub rejected SLED_DOG_GITHUB_TOKEN.')
    await expect(fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: respond(429) })).rejects.toThrow('rate limit')
    await expect(fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: respond(502) })).rejects.toThrow('HTTP 502')
    await expect(fetchPullRequests(config, 'repo', 'acme/web', SINCE, { fetchImpl: respond(200, { errors: [{ message: 'Bad thing' }] }) })).rejects.toThrow('GitHub: Bad thing')
  })
})

describe('organizations still use search', () => {
  it('sends a search query with the org qualifier, not a repository query', async () => {
    const gh = fakeGitHub({ searchNodes: [node(4)] })
    const { rows } = await fetchPullRequests(config, 'org', 'acme', SINCE, { fetchImpl: gh.fetchImpl })
    expect(gh.requests[0]!.query).toContain('search(')
    expect(gh.requests[0]!.variables.q).toBe(`is:pr org:acme updated:>=${SINCE} sort:updated-desc`)
    expect(rows).toHaveLength(1)
  })
})

describe('syncing a repository source end to end', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>
  beforeEach(async () => {
    db = drizzle(createClient({ url: ':memory:' }), { schema })
    await migrate(db, { migrationsFolder: './drizzle' })
    const now = new Date().toISOString()
    await db.insert(schema.tickets).values({ title: 'Login', status: 'todo', createdBy: 'x', createdAt: now, updatedAt: now })
  })
  const source = async (kind: 'org' | 'repo', name: string) =>
    (await db.insert(schema.githubSources).values({ organizationId: 'org1', kind, name, createdAt: new Date().toISOString() }).returning())[0]!

  it('sees a brand-new pull request on the first sync and moves its ticket', async () => {
    const gh = fakeGitHub({ repoPages: [[node(7, { headRefName: 'SD-1-login', updatedAt: new Date().toISOString() })]] })
    const result = await syncSource(db, config, await source('repo', 'acme/web'), { fetchImpl: gh.fetchImpl })
    expect(result).toMatchObject({ prsSeen: 1, linked: 1, error: null, note: null })
    expect((await db.select().from(schema.tickets).where(eq(schema.tickets.number, 1)).get())!.status).toBe('in_review')
    expect(gh.requests.every(r => !r.query.includes('search('))).toBe(true)
  })

  it('a repository that has nothing new carries no lag note: nothing was missed', async () => {
    const result = await syncSource(db, config, await source('repo', 'acme/web'), { fetchImpl: fakeGitHub({ repoPages: [[]] }).fetchImpl })
    expect(result).toMatchObject({ prsSeen: 0, note: null, error: null })
  })

  it('an organization that finds nothing says GitHub search may be lagging', async () => {
    const result = await syncSource(db, config, await source('org', 'acme'), { fetchImpl: fakeGitHub({ searchNodes: [] }).fetchImpl })
    expect(result).toMatchObject({ prsSeen: 0, note: ORG_LAG_NOTE })
    expect(ORG_LAG_NOTE).toContain('run sync again')
  })

  it('an organization that found pull requests carries no note, and an error carries none either', async () => {
    const found = await syncSource(db, config, await source('org', 'acme'), { fetchImpl: fakeGitHub({ searchNodes: [node(7)] }).fetchImpl })
    expect(found.note).toBeNull()
    const broken = await syncSource(db, config, await source('repo', 'acme/gone'), { fetchImpl: fakeGitHub({ repoMissing: true }).fetchImpl })
    expect(broken).toMatchObject({ note: null, error: 'Cannot see acme/gone. Check the name, and that the token can read it.' })
    expect((await db.select().from(schema.githubSources).where(eq(schema.githubSources.name, 'acme/gone')).get())!.lastError).toContain('Cannot see')
  })
})
