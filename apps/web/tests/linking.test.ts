import { describe, expect, it } from 'vitest'
import { extractTicketNumbers, nextStatus } from '../shared/linking'

describe('extractTicketNumbers', () => {
  it('finds refs in branches, titles and bodies, case-insensitively', () => {
    expect(extractTicketNumbers('feature/SD-12-login', 'Fixes sd-7 and SD-12', null)).toEqual([7, 12])
  })
  it('ignores lookalikes', () => {
    expect(extractTicketNumbers('XSD-12', 'SD-', 'SD12', 'password-SD-x')).toEqual([])
  })
  it('does not read a longer number as a shorter ticket', () => {
    expect(extractTicketNumbers('SD-1234')).toEqual([1234])
  })
})

describe('nextStatus', () => {
  const open = { state: 'open', draft: false } as const
  const draft = { state: 'open', draft: true } as const
  const merged = { state: 'merged', draft: false } as const
  const closed = { state: 'closed', draft: false } as const

  it('follows the PR lifecycle forward', () => {
    expect(nextStatus('todo', [draft])).toBe('in_progress')
    expect(nextStatus('in_progress', [open])).toBe('in_review')
    expect(nextStatus('in_review', [merged])).toBe('done')
  })
  it('waits for every open PR before done', () => {
    expect(nextStatus('in_review', [merged, open])).toBe('in_review')
  })
  it('never moves backward or overrides done/canceled', () => {
    expect(nextStatus('in_review', [draft])).toBe('in_review')
    expect(nextStatus('done', [open])).toBe('done')
    expect(nextStatus('canceled', [merged])).toBe('canceled')
  })
  it('does nothing for no PRs or only abandoned PRs', () => {
    expect(nextStatus('todo', [])).toBe('todo')
    expect(nextStatus('todo', [closed])).toBe('todo')
  })
})
