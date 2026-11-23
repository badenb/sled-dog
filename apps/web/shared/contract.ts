// Single source of truth for the API contract. Imported by the Nuxt app (UI)
// and the server (validation). The CLI consumes the same shapes via JSON.
import { z } from 'zod'

export const TICKET_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'test', 'done', 'canceled'] as const
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
  steps?: StepLite[]
  subtasks?: SubtaskLite[]
}

export const STEP_STATUSES = ['todo', 'done'] as const
export interface StepLite { id: number, title: string, status: (typeof STEP_STATUSES)[number] }
/** One checkpoint on a ticket's trail. `canComplete` is computed for the viewer. */
export interface Step extends StepLite {
  ticketNumber: number
  position: number
  assignee: { id: string, name: string } | null
  team: { id: string, name: string } | null
  completedAt: string | null
  completedBy: string | null
  canComplete: boolean
}
/** A chunk of engineering work inside a ticket, with its own status and pull requests. Referenced as SD-12.2. */
export interface SubtaskLite { number: number, status: Ticket['status'] }
export interface Subtask extends SubtaskLite {
  id: number
  ticketNumber: number
  ref: string // e.g. SD-12.2, what you write in a branch name or PR title
  title: string
  assignee: string | null
  pullRequests: PullRequestSummary[]
  createdAt: string
  updatedAt: string
}
export interface TicketDetail extends Ticket { steps: Step[], subtasks: Subtask[] }
export interface Team { id: string, name: string, members: { id: string, name: string }[] }
export interface Member { id: string, name: string, email: string, role: string }

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
  'step:read', 'step:create', 'step:update', 'step:delete', 'step:complete',
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

export const stepCreate = z.object({
  title: z.string().trim().min(1).max(120),
  assigneeId: z.string().min(1).nullish(),
  teamId: z.string().min(1).nullish(),
})
// Not stepCreate.partial(): same trap as tickets, partial() would keep any defaults.
export const stepUpdate = z.object({
  title: z.string().trim().min(1).max(120),
  status: z.enum(STEP_STATUSES),
  assigneeId: z.string().min(1).nullable(),
  teamId: z.string().min(1).nullable(),
}).partial().refine(v => Object.keys(v).length > 0, 'Nothing to update')
export const stepOrder = z.object({ order: z.array(z.number().int().positive()).min(1).max(200) })
export const teamCreate = z.object({ name: z.string().trim().min(1).max(60) })
export const teamMembers = z.object({ userIds: z.array(z.string().min(1)).max(500) })

export const subtaskCreate = z.object({
  title: z.string().trim().min(1).max(200),
  assignee: z.string().trim().max(100).nullish(),
})
// Explicit schema, not subtaskCreate.partial(): same defaults trap as tickets.
export const subtaskUpdate = z.object({
  title: z.string().trim().min(1).max(200),
  status: ticketStatus,
  assignee: z.string().trim().max(100).nullable(),
}).partial().refine(v => Object.keys(v).length > 0, 'Nothing to update')
