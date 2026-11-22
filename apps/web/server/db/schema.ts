export * from './auth-schema'
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

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
}, t => [index('tickets_status_idx').on(t.status)])

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
