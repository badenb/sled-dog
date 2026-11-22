// Single source of truth for the API contract. Imported by the Nuxt app (UI)
// and the server (validation). The CLI consumes the same shapes via JSON.
import { z } from 'zod'

export const TICKET_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const
export const TICKET_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export const SCOPES = ['tickets:read', 'tickets:write'] as const

export const ticketStatus = z.enum(TICKET_STATUSES)
export const ticketPriority = z.enum(TICKET_PRIORITIES)

export const ticketCreate = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(''),
  status: ticketStatus.default('backlog'),
  priority: ticketPriority.default('none'),
  assignee: z.string().trim().max(100).nullish(),
})

// Deliberately NOT ticketCreate.partial(): partial() keeps .default() values, so a
// PATCH of one field would silently reset status/priority/body.
export const ticketUpdate = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000),
  status: ticketStatus,
  priority: ticketPriority,
  assignee: z.string().trim().max(100).nullable(),
}).partial().refine(v => Object.keys(v).length > 0, 'Nothing to update')

export const ticketListQuery = z.object({
  status: ticketStatus.optional(),
  assignee: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export interface Ticket {
  id: string // e.g. SD-12
  number: number
  title: string
  body: string
  status: (typeof TICKET_STATUSES)[number]
  priority: (typeof TICKET_PRIORITIES)[number]
  assignee: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  pullRequests?: PullRequestSummary[]
}

export interface PullRequestSummary {
  key: string // owner/repo#123
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  author: string | null
  checks: 'success' | 'failure' | 'pending' | 'none'
  reviewDecision: string | null
}

export interface Envelope<T> {
  schema_version: 1
  data: T
  meta: Record<string, unknown>
  errors: { message: string, code?: string }[]
}

export type TicketCreate = z.infer<typeof ticketCreate>
export type TicketUpdate = z.infer<typeof ticketUpdate>

export const PERMISSIONS = [
  'ticket:read', 'ticket:create', 'ticket:update', 'ticket:delete',
  'initiative:read', 'initiative:create', 'initiative:update', 'initiative:delete', 'report:read',
] as const
export const tokenCreate = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['user', 'agent']).default('agent'),
  scopes: z.array(z.enum(PERMISSIONS)).min(1),
})
export type TokenCreate = z.infer<typeof tokenCreate>

const sourceName = z.string().trim().regex(/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/, 'Use an org like "acme" or a repo like "acme/service"')
export const githubSourceInput = z.object({ kind: z.enum(['org', 'repo']), name: sourceName })
  .refine(s => (s.kind === 'repo') === s.name.includes('/'), 'An org has no slash; a repo is owner/name')
export const githubSettingsInput = z.object({ sources: z.array(githubSourceInput).max(25) })
