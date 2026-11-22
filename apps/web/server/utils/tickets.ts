import type { Ticket } from '#shared/contract'
import type { schema } from '../db'

export const ticketId = (number: number) => `SD-${number}`

export function toTicket(row: typeof schema.tickets.$inferSelect): Ticket {
  return { ...row, id: ticketId(row.number), status: row.status as Ticket['status'], priority: row.priority as Ticket['priority'] }
}

export function parseTicketRef(ref: string): number {
  const match = /^(?:SD-)?([1-9][0-9]*)$/i.exec(ref)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Ticket reference must look like SD-12' })
  return Number(match[1])
}
