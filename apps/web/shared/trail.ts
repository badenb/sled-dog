// Pure rules for a ticket's trail (its checkpoints). No framework imports: unit-tested directly.
import type { StepLite } from './contract'

export const PRESETS = ['Design', 'Copy', 'Review', 'Approval', 'QA'] as const

export interface Progress { total: number, done: number, percent: number, currentId: number | null, complete: boolean }

/** "You are here" is the first checkpoint not yet done. An empty trail is neither complete nor in progress. */
export function trailProgress(steps: Pick<StepLite, 'id' | 'status'>[]): Progress {
  const done = steps.filter(s => s.status === 'done').length
  const current = steps.find(s => s.status !== 'done')
  return {
    total: steps.length, done,
    percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
    currentId: current?.id ?? null,
    complete: steps.length > 0 && done === steps.length,
  }
}

/** Move one item to a new index. Returns the same list for a no-op or unknown id; never mutates. */
export function reorder<T extends { id: number }>(list: T[], id: number, toIndex: number): T[] {
  const from = list.findIndex(i => i.id === id)
  if (from === -1) return list
  const to = Math.max(0, Math.min(list.length - 1, toIndex))
  if (from === to) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/**
 * Who may tick a checkpoint: anyone whose role allows completing steps, or the person it is assigned to,
 * or any member of the team it is assigned to. This is what lets a designer or approver with a read-only
 * role complete their own step without being able to edit anything else.
 */
export function mayComplete(p: { roleCanComplete: boolean, userId: string, assigneeId: string | null, teamId: string | null, userTeamIds: string[] }): boolean {
  if (p.roleCanComplete) return true
  if (p.assigneeId && p.assigneeId === p.userId) return true
  return !!p.teamId && p.userTeamIds.includes(p.teamId)
}
