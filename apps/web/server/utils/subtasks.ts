import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Subtask, SubtaskLite, Ticket } from '#shared/contract'
import { useDb, schema } from '../db'
import { toPrSummary } from './tickets'

export const subtaskRef = (ticket: number, number: number) => `SD-${ticket}.${number}`
export const toSubtaskLite = (s: Subtask): SubtaskLite => ({ number: s.number, status: s.status })

export async function loadSubtasks(ticketNumbers: number[]): Promise<Map<number, Subtask[]>> {
  const out = new Map<number, Subtask[]>(ticketNumbers.map(n => [n, []]))
  if (!ticketNumbers.length) return out
  const db = await useDb()
  const rows = await db.select().from(schema.subtasks).where(inArray(schema.subtasks.ticketNumber, ticketNumbers))
    .orderBy(asc(schema.subtasks.ticketNumber), asc(schema.subtasks.number))
  if (!rows.length) return out
  const links = await db.select().from(schema.subtaskLinks).where(inArray(schema.subtaskLinks.subtaskId, rows.map(r => r.id)))
  const prs = links.length ? await db.select().from(schema.pullRequests).where(inArray(schema.pullRequests.key, [...new Set(links.map(l => l.prKey))])) : []
  const prByKey = new Map(prs.map(p => [p.key, toPrSummary(p)]))
  for (const r of rows) {
    out.get(r.ticketNumber)!.push({
      id: r.id, ticketNumber: r.ticketNumber, number: r.number, ref: subtaskRef(r.ticketNumber, r.number), title: r.title,
      status: r.status as Subtask['status'], assignee: r.assignee,
      pullRequests: links.filter(l => l.subtaskId === r.id).map(l => prByKey.get(l.prKey)).filter((p): p is NonNullable<typeof p> => !!p),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    })
  }
  return out
}

/** Lite for the board (cheap), full for the open ticket. */
export async function withSubtasks(list: Ticket[], full = false): Promise<Ticket[]> {
  const map = await loadSubtasks(list.map(t => t.number))
  return list.map(t => ({ ...t, subtasks: full ? map.get(t.number) : map.get(t.number)!.map(toSubtaskLite) }) as Ticket)
}

export async function findSubtask(ticketNumber: number, number: string | undefined) {
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid subtask number' })
  const db = await useDb()
  const row = await db.select().from(schema.subtasks).where(and(eq(schema.subtasks.ticketNumber, ticketNumber), eq(schema.subtasks.number, n))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Subtask not found' })
  return row
}
