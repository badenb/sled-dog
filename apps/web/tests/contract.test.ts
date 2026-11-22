import { describe, expect, it } from 'vitest'
import { ticketCreate, ticketUpdate } from '#shared/contract'

describe('ticket contract', () => {
  it('applies defaults and trims', () => {
    expect(ticketCreate.parse({ title: '  Fix login  ' })).toMatchObject({ title: 'Fix login', status: 'backlog', priority: 'none', body: '' })
  })
  it('rejects empty titles and unknown statuses', () => {
    expect(() => ticketCreate.parse({ title: '   ' })).toThrow()
    expect(() => ticketCreate.parse({ title: 'x', status: 'wat' })).toThrow()
  })
  it('requires at least one field to update', () => {
    expect(() => ticketUpdate.parse({})).toThrow()
    expect(ticketUpdate.parse({ status: 'done' })).toEqual({ status: 'done' })
  })
})

describe('ticketUpdate', () => {
  it('does not inject defaults into a partial patch', () => {
    expect(ticketUpdate.parse({ title: 'New title' })).toEqual({ title: 'New title' })
  })
})
