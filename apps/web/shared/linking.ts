// Pure rules for connecting pull requests to tickets. No framework imports: unit-tested directly.
import type { Ticket } from './contract'

export type PrState = 'open' | 'closed' | 'merged'
export interface LinkablePr { state: PrState, draft: boolean }

/** Ticket numbers mentioned in any of the texts: SD-12, sd-12, feature/SD-12-login. Not XSD-12 or SD-123abc handled as 123. */
export function extractTicketNumbers(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>()
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/(?<![A-Za-z0-9])SD-(\d{1,9})(?!\d)/gi)) found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

const RANK: Record<Ticket['status'], number> = { backlog: 0, todo: 1, in_progress: 2, in_review: 3, done: 4, canceled: 5 }

/**
 * Status implied by a ticket's linked PRs. Only ever moves forward, and never
 * touches done/canceled, so a human decision is not overwritten by a late sync.
 *   draft PR open          -> in_progress
 *   non-draft PR open      -> in_review
 *   nothing open, >=1 merged -> done
 */
export function nextStatus(current: Ticket['status'], prs: LinkablePr[]): Ticket['status'] {
  if (current === 'done' || current === 'canceled') return current
  const open = prs.filter(p => p.state === 'open')
  let target: Ticket['status'] = current
  if (open.some(p => !p.draft)) target = 'in_review'
  else if (open.length) target = 'in_progress'
  else if (prs.some(p => p.state === 'merged')) target = 'done'
  return RANK[target] > RANK[current] ? target : current
}
