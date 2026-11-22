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

const QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title body url state isDraft merged mergedAt createdAt updatedAt additions deletions
      headRefName baseRefName reviewDecision
      author { login }
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
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

/** Fetch PRs updated since a time, newest first, up to maxPages*50. Never logs or returns the token. */
export async function fetchPullRequests(
  config: GitHubConfig, kind: 'org' | 'repo', name: string, since: string,
  { fetchImpl = fetch, maxPages = 10 }: { fetchImpl?: Fetch, maxPages?: number } = {},
): Promise<{ rows: PrRow[], truncated: boolean }> {
  const q = searchQuery(kind, name, since)
  const rows: PrRow[] = []
  let after: string | null = null
  for (let page = 0; page < maxPages; page++) {
    let response: Response
    try {
      response = await fetchImpl(graphqlUrl(config.apiBase), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json', 'User-Agent': 'sled-dog' },
        body: JSON.stringify({ query: QUERY, variables: { q, after } }),
      })
    } catch {
      throw new GitHubError('Cannot reach GitHub. Check the API base URL, network and certificates.')
    }
    if (response.status === 401) throw new GitHubError('GitHub rejected SLED_DOG_GITHUB_TOKEN.')
    if (response.status === 403 || response.status === 429) throw new GitHubError('GitHub denied the request or the rate limit was reached.')
    if (!response.ok) throw new GitHubError(`GitHub request failed (HTTP ${response.status}).`)
    const payload: any = await response.json().catch(() => null)
    if (payload?.errors?.length) throw new GitHubError(`GitHub: ${String(payload.errors[0]?.message ?? 'query error').slice(0, 200)}`)
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
