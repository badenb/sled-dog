// Pure helpers for moving tickets between board columns. Immutable so the UI can
// apply a move optimistically and undo it exactly if the server refuses.
import type { Ticket } from './contract'

export interface Previous { status: Ticket['status'], updatedAt: string }

/** Returns the updated list and what to restore on failure, or null when there is nothing to do. */
export function moveTicket(list: Ticket[], id: string, status: Ticket['status'], now = new Date().toISOString()) {
  const current = list.find(t => t.id === id)
  if (!current || current.status === status) return null
  return {
    list: list.map(t => (t.id === id ? { ...t, status, updatedAt: now } : t)),
    previous: { status: current.status, updatedAt: current.updatedAt } satisfies Previous,
  }
}

export function revertMove(list: Ticket[], id: string, previous: Previous): Ticket[] {
  return list.map(t => (t.id === id ? { ...t, ...previous } : t))
}

/** Newest activity first, so a card you just moved lands at the top of its column. */
export const byRecent = (a: Ticket, b: Ticket) => b.updatedAt.localeCompare(a.updatedAt)
