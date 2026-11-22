import { describe, expect, it } from 'vitest'
import { initials, timeAgo } from '../app/utils/time'

describe('timeAgo', () => {
  const now = Date.parse('2026-11-22T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()
  it('reads naturally across ranges', () => {
    expect(timeAgo(ago(20_000), now)).toBe('just now')
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m ago')
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h ago')
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe('2d ago')
  })
  it('never shows negative time for a clock-skewed future date', () => {
    expect(timeAgo(ago(-60_000), now)).toBe('just now')
  })
  it('returns empty for garbage instead of "NaNm ago"', () => {
    expect(timeAgo('not a date', now)).toBe('')
  })
})

describe('initials', () => {
  it('takes first and last initial', () => {
    expect(initials('Baden Bennett')).toBe('BB')
    expect(initials('Mary Jane Watson')).toBe('MW')
  })
  it('handles logins and handles', () => {
    expect(initials('dana')).toBe('D')
    expect(initials('@claude-code')).toBe('CC')
    expect(initials('')).toBe('?')
  })
})
