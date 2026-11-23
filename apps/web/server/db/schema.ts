export * from './auth-schema'
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'

export const tickets = sqliteTable('tickets', {
  number: integer('number').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  status: text('status').notNull().default('backlog'),
  priority: text('priority').notNull().default('none'),
  assignee: text('assignee'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // Highest subtask number ever issued for this ticket. Only goes up, so SD-12.4 can never be reused after a delete.
  subtaskSeq: integer('subtask_seq').notNull().default(0),
  // When it entered done/canceled (null while open), and when it was archived off the board (null = on the board).
  closedAt: text('closed_at'),
  archivedAt: text('archived_at'),
}, t => [index('tickets_status_idx').on(t.status), index('tickets_archived_idx').on(t.archivedAt)])

// Tokens are stored hashed. `kind` separates humans from agents so every
// mutation can be attributed ("agent X acting for user Y").
export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  hash: text('hash').notNull().unique(),
  scopes: text('scopes').notNull(), // comma-separated
  actor: text('actor').notNull(), // display name of the owning user, for audit
  userId: text('user_id').notNull(),
  organizationId: text('organization_id').notNull(),
  kind: text('kind').notNull().default('user'), // user | agent
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
})

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  actor: text('actor').notNull(),
  actorKind: text('actor_kind').notNull(),
  tokenName: text('token_name'),
  action: text('action').notNull(),
  target: text('target').notNull(),
  detail: text('detail'),
})

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  actor: text('actor').notNull(),
  response: text('response').notNull(),
  createdAt: text('created_at').notNull(),
})

// ── GitHub sync ─────────────────────────────────────────────────────────────
// One org, or a list of repos, per workspace. The token itself lives in server env, not here.
export const githubSources = sqliteTable('github_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  organizationId: text('organization_id').notNull(),
  kind: text('kind').notNull(), // 'org' | 'repo'
  name: text('name').notNull(), // 'acme' or 'acme/service'
  createdAt: text('created_at').notNull(),
  lastSyncedAt: text('last_synced_at'),
  lastError: text('last_error'),
}, t => [uniqueIndex('github_sources_unique').on(t.organizationId, t.kind, t.name)])

export const pullRequests = sqliteTable('pull_requests', {
  key: text('key').primaryKey(), // 'owner/repo#123'
  repo: text('repo').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  state: text('state').notNull(), // open | closed | merged
  draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
  author: text('author'),
  headBranch: text('head_branch'),
  baseBranch: text('base_branch'),
  additions: integer('additions'),
  deletions: integer('deletions'),
  reviewDecision: text('review_decision'), // approved | changes_requested | review_required | null
  checks: text('checks').notNull().default('none'), // success | failure | pending | none
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  mergedAt: text('merged_at'),
  syncedAt: text('synced_at').notNull(),
})

export const ticketLinks = sqliteTable('ticket_links', {
  ticketNumber: integer('ticket_number').notNull(),
  prKey: text('pr_key').notNull(),
}, t => [primaryKey({ columns: [t.ticketNumber, t.prKey] }), index('ticket_links_pr_idx').on(t.prKey)])

// ── Teams and ticket trails ─────────────────────────────────────────────────
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('teams_org_name_uidx').on(t.organizationId, t.name)])

export const teamMembers = sqliteTable('team_members', {
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
}, t => [primaryKey({ columns: [t.teamId, t.userId] }), index('team_members_user_idx').on(t.userId)])

// A ticket's trail: ordered checkpoints, each assignable to a person and/or a team.
export const ticketSteps = sqliteTable('ticket_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketNumber: integer('ticket_number').notNull(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
  status: text('status').notNull().default('todo'), // todo | done
  assigneeId: text('assignee_id'),
  teamId: text('team_id'),
  completedAt: text('completed_at'),
  completedBy: text('completed_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('ticket_steps_ticket_idx').on(t.ticketNumber, t.position)])

// ── Subtasks: engineering work chunks inside a ticket, each with its own status and PRs (SD-12.2) ──
export const subtasks = sqliteTable('subtasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketNumber: integer('ticket_number').notNull(),
  number: integer('number').notNull(), // per-ticket sequence: the "2" in SD-12.2
  title: text('title').notNull(),
  status: text('status').notNull().default('todo'),
  assignee: text('assignee'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('subtasks_ticket_number_uidx').on(t.ticketNumber, t.number)])

export const subtaskLinks = sqliteTable('subtask_links', {
  subtaskId: integer('subtask_id').notNull(),
  prKey: text('pr_key').notNull(),
}, t => [primaryKey({ columns: [t.subtaskId, t.prKey] }), index('subtask_links_pr_idx').on(t.prKey)])

// ── Workspace settings ──────────────────────────────────────────────────────
// One row per workspace; a missing row means the defaults (archive after 30 days).
export const workspaceSettings = sqliteTable('workspace_settings', {
  organizationId: text('organization_id').primaryKey(),
  archiveAfter: integer('archive_after').notNull().default(30), // 0 = never archive automatically
  archiveUnit: text('archive_unit').notNull().default('days'), // 'days' | 'business_days'
  updatedAt: text('updated_at').notNull(),
})
