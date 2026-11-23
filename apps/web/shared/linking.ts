// Pure rules for connecting pull requests to tickets and subtasks. No framework imports: unit-tested directly.
import type { Ticket } from './contract'

export type PrState = 'open' | 'closed' | 'merged'
export interface LinkablePr { state: PrState, draft: boolean }
export type Status = Ticket['status']
export interface Ref { ticket: number, subtask: number | null }

/**
 * References in text: SD-12 (a ticket) or SD-12.2 (subtask 2 of ticket 12), also in branch names like
 * feature/SD-12.2-login. Case-insensitive; not XSD-12; a trailing sentence period ("fixes SD-12.") is not a subtask.
 */
export function extractRefs(...texts: (string | null | undefined)[]): Ref[] {
  const found = new Map<string, Ref>()
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(/(?<![A-Za-z0-9])SD-(\d{1,9})(?:\.(\d{1,4}))?(?!\d)/gi)) {
      const ref = { ticket: Number(m[1]), subtask: m[2] ? Number(m[2]) : null }
      found.set(`${ref.ticket}.${ref.subtask ?? ''}`, ref)
    }
  }
  return [...found.values()].sort((a, b) => a.ticket - b.ticket || (a.subtask ?? 0) - (b.subtask ?? 0))
}

// ── What links a PR ───────────────────────────────────────────────────────────
// The branch name and title are deliberate: any reference there links. The description is prose, where people
// mention related work ("see SD-3", "follow-up in SD-4.2"), so it links only when a reference FOLLOWS a keyword:
//   closes/fixes/resolves SD-12      part of SD-12      refs SD-12      Fixes SD-12, SD-13 and SD-14.2
const REF = String.raw`SD-\d{1,9}(?:\.\d{1,4})?`
const KEYWORD = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\s+of|refs?|references?)`
const KEYWORD_REFS = new RegExp(String.raw`(?<![A-Za-z0-9])${KEYWORD}\b[\s:*_\x60]*((?:${REF}(?!\d)[\s,*_\x60]*(?:(?:and|&)[\s*_\x60]*)?)+)`, 'gi')

/** Only the references in a description that follow a link keyword. */
export const keywordRefsText = (body: string | null | undefined): string[] => [...(body ?? '').matchAll(KEYWORD_REFS)].map(m => m[1]!)

/** Every reference that should link a PR: anything in the branch or title, plus keyworded ones in the description. */
export function extractLinkRefs(pr: { title?: string | null, branch?: string | null, body?: string | null }): Ref[] {
  return extractRefs(pr.title, pr.branch, ...keywordRefsText(pr.body))
}

const RANK: Record<Status, number> = { backlog: 0, todo: 1, in_progress: 2, in_review: 3, test: 4, done: 5, canceled: 6 }
export const rank = (s: Status) => RANK[s]

/**
 * Status implied by a ticket's (or subtask's) linked PRs. Only ever moves forward, and never touches
 * done/canceled, so a human decision is not overwritten by a late sync. Nothing reaches done on its own:
 *   draft PR open            -> in progress
 *   non-draft PR open        -> in review
 *   nothing open, >=1 merged -> test   (merged code still needs verifying; a person moves it to done)
 */
export function nextStatus(current: Status, prs: LinkablePr[]): Status {
  if (current === 'done' || current === 'canceled') return current
  const open = prs.filter(p => p.state === 'open')
  let target: Status = current
  if (open.some(p => !p.draft)) target = 'in_review'
  else if (open.length) target = 'in_progress'
  else if (prs.some(p => p.state === 'merged')) target = 'test'
  return RANK[target] > RANK[current] ? target : current
}

/**
 * A ticket with subtasks follows them, so several PRs on one ticket cannot push it to review by themselves:
 *   - work started on ANY subtask                -> in progress
 *   - EVERY (non-canceled) subtask in review+    -> as far along as the slowest one (in review, test, or done)
 * Forward only, and never touches a ticket that is already done or canceled.
 */
export function statusFromSubtasks(current: Status, subtasks: Status[]): Status {
  if (current === 'done' || current === 'canceled') return current
  const live = subtasks.filter(s => s !== 'canceled')
  if (!live.length) return current
  const slowest = live.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b))
  const fastest = live.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b))
  let target: Status = current
  if (RANK[slowest] >= RANK.in_review) target = slowest
  else if (RANK[fastest] >= RANK.in_progress) target = 'in_progress'
  return RANK[target] > RANK[current] ? target : current
}
