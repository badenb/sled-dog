import { describe, expect, it } from 'vitest'
import { mayComplete, reorder, trailProgress } from '../shared/trail'
import { stepUpdate } from '../shared/contract'
import { roles } from '../shared/permissions'

const s = (id: number, status: 'todo' | 'done') => ({ id, status })

describe('trailProgress', () => {
  it('finds where you are: the first checkpoint not done', () => {
    expect(trailProgress([s(1, 'done'), s(2, 'todo'), s(3, 'todo')])).toEqual({ total: 3, done: 1, percent: 33, currentId: 2, complete: false })
  })
  it('is current at the earliest unfinished step even if a later one is already done', () => {
    expect(trailProgress([s(1, 'todo'), s(2, 'done')]).currentId).toBe(1)
  })
  it('is complete only when every checkpoint is done', () => {
    expect(trailProgress([s(1, 'done'), s(2, 'done')])).toMatchObject({ percent: 100, currentId: null, complete: true })
  })
  it('an empty trail is not complete', () => {
    expect(trailProgress([])).toEqual({ total: 0, done: 0, percent: 0, currentId: null, complete: false })
  })
})

describe('reorder', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  it('moves an item without mutating the original', () => {
    expect(reorder(list, 1, 2).map(i => i.id)).toEqual([2, 3, 1, 4])
    expect(list.map(i => i.id)).toEqual([1, 2, 3, 4])
  })
  it('moves up as well as down, and clamps out-of-range targets', () => {
    expect(reorder(list, 4, 0).map(i => i.id)).toEqual([4, 1, 2, 3])
    expect(reorder(list, 1, 99).map(i => i.id)).toEqual([2, 3, 4, 1])
    expect(reorder(list, 2, -5).map(i => i.id)).toEqual([2, 1, 3, 4])
  })
  it('ignores unknown ids and no-ops', () => {
    expect(reorder(list, 9, 0)).toBe(list)
    expect(reorder(list, 2, 1)).toBe(list)
  })
})

describe('mayComplete', () => {
  const base = { roleCanComplete: false, userId: 'u1', assigneeId: null, teamId: null, userTeamIds: [] as string[] }
  it('lets roles that can complete steps complete any step', () => {
    expect(mayComplete({ ...base, roleCanComplete: true })).toBe(true)
  })
  it('lets the assigned person complete their own step even with a read-only role', () => {
    expect(mayComplete({ ...base, assigneeId: 'u1' })).toBe(true)
    expect(mayComplete({ ...base, assigneeId: 'u2' })).toBe(false)
  })
  it('lets any member of the assigned team complete it, and nobody else', () => {
    expect(mayComplete({ ...base, teamId: 't1', userTeamIds: ['t1', 't2'] })).toBe(true)
    expect(mayComplete({ ...base, teamId: 't3', userTeamIds: ['t1', 't2'] })).toBe(false)
  })
  it('denies an unassigned step to a read-only user', () => {
    expect(mayComplete(base)).toBe(false)
  })
})

describe('role model for steps', () => {
  const can = (role: keyof typeof roles, action: string) => roles[role].authorize({ step: [action] } as never).success
  it('stakeholders can read steps but have no role-level write, so completion is relational only', () => {
    expect(can('stakeholder', 'read')).toBe(true)
    for (const a of ['create', 'update', 'delete', 'complete']) expect(can('stakeholder', a)).toBe(false)
  })
  it('engineers and owners can manage and complete steps', () => {
    for (const r of ['engineer', 'owner'] as const) for (const a of ['read', 'create', 'update', 'delete', 'complete']) expect(can(r, a)).toBe(true)
  })
})

describe('stepUpdate', () => {
  it('does not inject anything into a partial patch, and rejects an empty one', () => {
    expect(stepUpdate.parse({ status: 'done' })).toEqual({ status: 'done' })
    expect(() => stepUpdate.parse({})).toThrow()
  })
  it('allows clearing the assignee and team with null', () => {
    expect(stepUpdate.parse({ assigneeId: null, teamId: null })).toEqual({ assigneeId: null, teamId: null })
  })
})
