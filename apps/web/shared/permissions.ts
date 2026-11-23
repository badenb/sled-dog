// One place that defines who can do what. Imported by the server (auth config +
// can() checks) and the client (role-aware UI). No Nuxt auto-imports in here:
// the Better Auth CLI loads this file standalone.
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements, ownerAc } from 'better-auth/plugins/organization/access'

export const statements = {
  ...defaultStatements,
  ticket: ['read', 'create', 'update', 'delete'],
  initiative: ['read', 'create', 'update', 'delete'],
  report: ['read'],
  step: ['read', 'create', 'update', 'delete', 'complete'],
} as const

export const ac = createAccessControl(statements)

export const roles = {
  // Full control of the workspace, members and all work.
  owner: ac.newRole({
    ...ownerAc.statements,
    ticket: ['read', 'create', 'update', 'delete'],
    initiative: ['read', 'create', 'update', 'delete'],
    report: ['read'],
    step: ['read', 'create', 'update', 'delete', 'complete'],
  }),
  // Day-to-day delivery: works tickets and initiatives, can invite teammates.
  engineer: ac.newRole({
    invitation: ['create'],
    ticket: ['read', 'create', 'update'],
    initiative: ['read', 'create', 'update'],
    report: ['read'],
    step: ['read', 'create', 'update', 'delete', 'complete'],
  }),
  // Read-only window into progress and outcomes. Cannot change anything.
  stakeholder: ac.newRole({
    ticket: ['read'],
    initiative: ['read'],
    report: ['read'],
    // Stakeholders can see steps. They may still complete a step assigned to them or their team:
    // that is a relationship check (see shared/trail.ts mayComplete), not a role permission.
    step: ['read'],
  }),
}


export type RoleName = keyof typeof roles
export const ROLE_NAMES = Object.keys(roles) as RoleName[]
export type Resource = 'ticket' | 'initiative' | 'report' | 'organization' | 'step'
export type Action = 'read' | 'create' | 'update' | 'delete' | 'complete'
