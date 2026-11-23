import { describe, expect, it } from 'vitest'
import { extractLinkRefs, extractRefs, nextStatus, statusFromSubtasks } from '../shared/linking'

const t = (ticket: number, subtask: number | null = null) => ({ ticket, subtask })

describe('extractRefs', () => {
  it('finds tickets in branches, titles and bodies, case-insensitively', () => {
    expect(extractRefs('feature/SD-12-login', 'Fixes sd-7 and SD-12', null)).toEqual([t(7), t(12)])
  })
  it('reads subtask references like SD-12.2, including in branch names', () => {
    expect(extractRefs('feature/SD-12.2-login')).toEqual([t(12, 2)])
    expect(extractRefs('Part of SD-12', 'SD-12.1 and sd-12.3')).toEqual([t(12), t(12, 1), t(12, 3)])
  })
  it('does not mistake a sentence period for a subtask', () => {
    expect(extractRefs('This fixes SD-12. Next we...')).toEqual([t(12)])
    expect(extractRefs('See SD-12.')).toEqual([t(12)])
  })
  it('ignores lookalikes', () => {
    expect(extractRefs('XSD-12', 'SD-', 'SD12', 'password-SD-x')).toEqual([])
  })
  it('does not read a longer number as a shorter ticket', () => {
    expect(extractRefs('SD-1234')).toEqual([t(1234)])
  })
  it('lists each reference once, sorted', () => {
    expect(extractRefs('SD-2.1 SD-2.1 SD-1', 'sd-2.1')).toEqual([t(1), t(2, 1)])
  })
})

describe('extractLinkRefs: what links a PR', () => {
  const link = (body: string, extra: { title?: string, branch?: string } = {}) => extractLinkRefs({ body, ...extra })

  it('branch and title always link', () => {
    expect(extractLinkRefs({ branch: 'feature/SD-12.2-api' })).toEqual([t(12, 2)])
    expect(extractLinkRefs({ title: 'SD-7: Add login', branch: 'x' })).toEqual([t(7)])
    expect(extractLinkRefs({ title: 'Part of SD-12: API', body: 'Nothing special' })).toEqual([t(12)])
  })
  it('a plain mention in the description does not link (the bug that moved a ticket early)', () => {
    expect(link('The second PR is SD-4.2 and it follows this one.')).toEqual([])
    expect(link('See SD-3 for background. Related to SD-9.1.')).toEqual([])
    expect(link('Follow-up in SD-4.2 (step commands)')).toEqual([])
    expect(link('Depends on SD-1 and blocks SD-2')).toEqual([])
  })
  it('a description links after a keyword', () => {
    expect(link('Closes SD-12')).toEqual([t(12)])
    expect(link('this fixes sd-12.2.')).toEqual([t(12, 2)])
    expect(link('Resolves: SD-5')).toEqual([t(5)])
    expect(link('Part of **SD-4**')).toEqual([t(4)])
    expect(link('Refs `SD-7`')).toEqual([t(7)])
    expect(link('Reference SD-8')).toEqual([t(8)])
  })
  it('one keyword covers a list of references', () => {
    expect(link('Fixes SD-1, SD-2 and SD-3.1')).toEqual([t(1), t(2), t(3, 1)])
    expect(link('Closes SD-1 & SD-2')).toEqual([t(1), t(2)])
  })
  it('only the references right after the keyword link, not later mentions', () => {
    expect(link('Closes SD-1. Also see SD-2 and the notes in SD-3.1')).toEqual([t(1)])
    expect(link('Part of SD-4\n\nThe other half is SD-4.2')).toEqual([t(4)])
  })
  it('a keyword that is not followed by a reference links nothing', () => {
    expect(link('This closes the loop on SD-5')).toEqual([])
    expect(link('It fixes things. SD-5 is related')).toEqual([])
  })
  it('does not match keywords inside other words', () => {
    expect(link('prefixes SD-3')).toEqual([])
    expect(link('unfixes SD-3 and disclose SD-4')).toEqual([])
  })
  it('combines branch, title and keyworded references once each, sorted', () => {
    expect(extractLinkRefs({ branch: 'SD-2.1-x', title: 'SD-2.1 thing', body: 'Closes SD-1 and fixes SD-2.1' })).toEqual([t(1), t(2, 1)])
  })
  it('handles an empty or missing description', () => {
    expect(extractLinkRefs({ title: 'x', branch: 'y', body: null })).toEqual([])
    expect(extractLinkRefs({})).toEqual([])
  })
})

describe('nextStatus', () => {
  const open = { state: 'open', draft: false } as const
  const draft = { state: 'open', draft: true } as const
  const merged = { state: 'merged', draft: false } as const
  const closed = { state: 'closed', draft: false } as const

  it('follows the PR lifecycle forward, landing merged work in test (never done by itself)', () => {
    expect(nextStatus('todo', [draft])).toBe('in_progress')
    expect(nextStatus('in_progress', [open])).toBe('in_review')
    expect(nextStatus('in_review', [merged])).toBe('test')
    expect(nextStatus('test', [merged])).toBe('test')
  })
  it('waits for every open PR before test', () => {
    expect(nextStatus('in_review', [merged, open])).toBe('in_review')
  })
  it('never moves backward or overrides done/canceled', () => {
    expect(nextStatus('in_review', [draft])).toBe('in_review')
    expect(nextStatus('test', [open])).toBe('test') // a fix found in test needs a person to move it back
    expect(nextStatus('done', [open])).toBe('done')
    expect(nextStatus('canceled', [merged])).toBe('canceled')
  })
  it('does nothing for no PRs or only abandoned PRs', () => {
    expect(nextStatus('todo', [])).toBe('todo')
    expect(nextStatus('todo', [closed])).toBe('todo')
  })
})

describe('statusFromSubtasks', () => {
  it('does not move to review just because ONE subtask has a PR in review', () => {
    expect(statusFromSubtasks('todo', ['in_review', 'todo'])).toBe('in_progress')
    expect(statusFromSubtasks('in_progress', ['in_review', 'in_progress'])).toBe('in_progress')
  })
  it('moves to review only when every subtask is in review or beyond, then follows the slowest', () => {
    expect(statusFromSubtasks('in_progress', ['in_review', 'in_review'])).toBe('in_review')
    expect(statusFromSubtasks('in_review', ['test', 'in_review'])).toBe('in_review')
    expect(statusFromSubtasks('in_review', ['test', 'test'])).toBe('test')
    expect(statusFromSubtasks('test', ['done', 'test'])).toBe('test')
  })
  it('is done only when every subtask is done', () => {
    expect(statusFromSubtasks('test', ['done', 'done'])).toBe('done')
  })
  it('starts work when any subtask starts, but not for merely planned subtasks', () => {
    expect(statusFromSubtasks('backlog', ['in_progress', 'todo'])).toBe('in_progress')
    expect(statusFromSubtasks('backlog', ['todo', 'todo'])).toBe('backlog')
  })
  it('ignores canceled subtasks, and does nothing when all are canceled or there are none', () => {
    expect(statusFromSubtasks('in_progress', ['test', 'canceled'])).toBe('test')
    expect(statusFromSubtasks('todo', ['canceled'])).toBe('todo')
    expect(statusFromSubtasks('todo', [])).toBe('todo')
  })
  it('never moves backward or touches done/canceled tickets', () => {
    expect(statusFromSubtasks('test', ['in_review', 'todo'])).toBe('test')
    expect(statusFromSubtasks('done', ['todo'])).toBe('done')
    expect(statusFromSubtasks('canceled', ['done'])).toBe('canceled')
  })
})
