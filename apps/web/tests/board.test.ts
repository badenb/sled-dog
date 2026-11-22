import { describe, expect, it } from 'vitest'
import type { Ticket } from '../shared/contract'
import { byRecent, moveTicket, revertMove } from '../shared/board'

const ticket = (n: number, status: Ticket['status'], updatedAt = '2026-11-20T00:00:00Z'): Ticket => ({
  id: `SD-${n}`, number: n, title: `t${n}`, body: '', status, priority: 'none', assignee: null, createdBy: 'x', createdAt: updatedAt, updatedAt,
})

describe('moveTicket', () => {
  it('moves one ticket and leaves the others and the original list untouched', () => {
    const list = [ticket(1, 'todo'), ticket(2, 'todo')]
    const result = moveTicket(list, 'SD-1', 'in_progress', '2026-11-22T00:00:00Z')!
    expect(result.list.map(t => t.status)).toEqual(['in_progress', 'todo'])
    expect(result.list[0]!.updatedAt).toBe('2026-11-22T00:00:00Z')
    expect(list[0]!.status).toBe('todo') // not mutated
  })
  it('does nothing when dropped on its own column or for an unknown ticket', () => {
    const list = [ticket(1, 'todo')]
    expect(moveTicket(list, 'SD-1', 'todo')).toBeNull()
    expect(moveTicket(list, 'SD-9', 'done')).toBeNull()
  })
  it('restores exactly what was there when the server refuses', () => {
    const list = [ticket(1, 'todo', '2026-11-20T00:00:00Z')]
    const moved = moveTicket(list, 'SD-1', 'done', '2026-11-22T00:00:00Z')!
    expect(revertMove(moved.list, 'SD-1', moved.previous)).toEqual(list)
  })
})

describe('byRecent', () => {
  it('puts the most recently touched ticket first', () => {
    const sorted = [ticket(1, 'todo', '2026-11-20T00:00:00Z'), ticket(2, 'todo', '2026-11-22T00:00:00Z')].sort(byRecent)
    expect(sorted.map(t => t.id)).toEqual(['SD-2', 'SD-1'])
  })
})
