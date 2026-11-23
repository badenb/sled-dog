// GitHub GraphQL client for PR sync. Standalone (no Nuxt imports) so it can be tested with a fake fetch.

export class GitHubError extends Error {}

export interface GitHubConfig { token: string, apiBase: string }
export type Fetch = typeof fetch

export interface PrRow {
  key: string, repo: string, number: number, title: string, url: string,
  state: 'open' | 'closed' | 'merged', draft: boolean, author: string | null,
  headBranch: string | null, baseBranch: string | null, additions: number | null, deletions: number | null,
  reviewDecision: string | null, checks: 'success' | 'failure' | 'pending' | 'none',
  createdAt: string, updatedAt: string, mergedAt: string | null, body: string
}

// The fields we read from a pull request, shared by both ways of listing them.
const PR_FIELDS = `number title body url state isDraft merged mergedAt createdAt updatedAt additions deletions
      headRefName baseRefName reviewDecision
      author { login }
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`

// Organizations: GitHub search. It is eventually consistent, so a brand-new pull request can take a few
// seconds to appear.
const SEARCH_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`

// One repository: its own pull-request list, newest-updated first. This is not a search index, so a pull request
// is there the moment it exists, and there is no 1,000-result ceiling.
const REPO_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PR_FIELDS} }
    }
  }
}`

/** https://api.github.com -> .../graphql ; https://host/api/v3 (Enterprise) -> https://host/api/graphql */
export const graphqlUrl = (apiBase: string) => apiBase.replace(/\/+$/, '').replace(/\/v3$/, '') + '/graphql'

export const SOURCE_NAME = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/

export function searchQuery(kind: 'org' | 'repo', name: string, since: string) {
  if (!SOURCE_NAME.test(name) || (kind === 'org') === name.includes('/')) throw new GitHubError(`Invalid ${kind} name: ${name}`)
  return `is:pr ${kind === 'org' ? 'org' : 'repo'}:${name} updated:>=${since} sort:updated-desc`
}

function checksOf(state: string | undefined): PrRow['checks'] {
  if (state === 'SUCCESS') return 'success'
  if (state === 'FAILURE' || state === 'ERROR') return 'failure'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return 'none'
}

export function mapPullRequest(node: any): PrRow | null {
  if (!node?.number || !node.repository?.nameWithOwner) return null // non-PR search hit
  const repo: string = node.repository.nameWithOwner
  return {
    key: `${repo}#${node.number}`, repo, number: node.number, title: String(node.title ?? ''), url: node.url,
    state: node.merged ? 'merged' : node.state === 'OPEN' ? 'open' : 'closed',
    draft: !!node.isDraft, author: node.author?.login ?? null,
    headBranch: node.headRefName ?? null, baseBranch: node.baseRefName ?? null,
    additions: node.additions ?? null, deletions: node.deletions ?? null,
    reviewDecision: node.reviewDecision ? String(node.reviewDecision).toLowerCase() : null,
    checks: checksOf(node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
    createdAt: node.createdAt, updatedAt: node.updatedAt, mergedAt: node.mergedAt ?? null, body: String(node.body ?? ''),
  }
}

/** One GraphQL request. Same handling for both queries; never logs or returns the token. */
async function post(config: GitHubConfig, query: string, variables: Record<string, unknown>, fetchImpl: Fetch): Promise<any> {
  let response: Response
  try {
    response = await fetchImpl(graphqlUrl(config.apiBase), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json', 'User-Agent': 'sled-dog' },
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    throw new GitHubError('Cannot reach GitHub. Check the API base URL, network and certificates.')
  }
  if (response.status === 401) throw new GitHubError('GitHub rejected SLED_DOG_GITHUB_TOKEN.')
  if (response.status === 403 || response.status === 429) throw new GitHubError('GitHub denied the request or the rate limit was reached.')
  if (!response.ok) throw new GitHubError(`GitHub request failed (HTTP ${response.status}).`)
  const payload: any = await response.json().catch(() => null)
  if (payload?.errors?.length) throw new GitHubError(`GitHub: ${String(payload.errors[0]?.message ?? 'query error').slice(0, 200)}`)
  return payload
}

type Options = { fetchImpl?: Fetch, maxPages?: number }

/** Pull requests updated since a time, newest first, up to maxPages*50. A repo is read directly; an org is searched. */
export async function fetchPullRequests(
  config: GitHubConfig, kind: 'org' | 'repo', name: string, since: string, options: Options = {},
): Promise<{ rows: PrRow[], truncated: boolean }> {
  return kind === 'repo' ? fetchRepoPullRequests(config, name, since, options) : searchPullRequests(config, name, since, options)
}

async function searchPullRequests(config: GitHubConfig, name: string, since: string, { fetchImpl = fetch, maxPages = 10 }: Options) {
  const q = searchQuery('org', name, since)
  const rows: PrRow[] = []
  let after: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const payload = await post(config, SEARCH_QUERY, { q, after }, fetchImpl)
    const search = payload?.data?.search
    if (!search) throw new GitHubError('GitHub returned an unexpected response.')
    for (const node of search.nodes ?? []) {
      const row = mapPullRequest(node)
      if (row) rows.push(row)
    }
    if (!search.pageInfo?.hasNextPage) return { rows, truncated: false }
    after = search.pageInfo.endCursor
  }
  return { rows, truncated: true }
}

async function fetchRepoPullRequests(config: GitHubConfig, name: string, since: string, { fetchImpl = fetch, maxPages = 10 }: Options) {
  if (!SOURCE_NAME.test(name) || !name.includes('/')) throw new GitHubError(`Invalid repo name: ${name}`)
  const [owner, repo] = name.split('/') as [string, string]
  const rows: PrRow[] = []
  let after: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const payload = await post(config, REPO_QUERY, { owner, name: repo, after }, fetchImpl)
    const list = payload?.data?.repository?.pullRequests
    if (payload?.data && payload.data.repository === null) throw new GitHubError(`Cannot see ${name}. Check the name, and that the token can read it.`)
    if (!list) throw new GitHubError('GitHub returned an unexpected response.')
    let reachedOlder = false
    for (const node of list.nodes ?? []) {
      const row = mapPullRequest(node)
      if (!row) continue
      // Newest-updated first, so the first PR older than the window means everything after it is older too.
      if (row.updatedAt < since) { reachedOlder = true; break }
      rows.push(row)
    }
    if (reachedOlder || !list.pageInfo?.hasNextPage) return { rows, truncated: false }
    after = list.pageInfo.endCursor
  }
  return { rows, truncated: true }
}
