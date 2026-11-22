import { describe, expect, it } from 'vitest'
import { roles } from '../shared/permissions'

const can = (role: keyof typeof roles, resource: string, action: string) =>
  roles[role].authorize({ [resource]: [action] } as never).success

describe('role permissions', () => {
  it('stakeholders are strictly read-only', () => {
    expect(can('stakeholder', 'ticket', 'read')).toBe(true)
    expect(can('stakeholder', 'report', 'read')).toBe(true)
    for (const action of ['create', 'update', 'delete']) expect(can('stakeholder', 'ticket', action)).toBe(false)
    expect(can('stakeholder', 'invitation', 'create')).toBe(false)
  })
  it('engineers work tickets but cannot delete them or manage members', () => {
    expect(can('engineer', 'ticket', 'create')).toBe(true)
    expect(can('engineer', 'ticket', 'update')).toBe(true)
    expect(can('engineer', 'ticket', 'delete')).toBe(false)
    expect(can('engineer', 'member', 'update')).toBe(false)
  })
  it('owners can do everything', () => {
    expect(can('owner', 'ticket', 'delete')).toBe(true)
    expect(can('owner', 'member', 'delete')).toBe(true)
  })
})
