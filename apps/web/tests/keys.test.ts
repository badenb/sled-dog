import { describe, expect, it } from 'vitest'
import { isTypingTarget } from '../app/utils/keys'

describe('isTypingTarget (when a single-key shortcut must not fire)', () => {
  it('is true where text is typed', () => {
    for (const el of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(isTypingTarget(el as never), JSON.stringify(el)).toBe(true)
    }
  })
  it('is false everywhere else, and for nothing', () => {
    for (const el of [{ tagName: 'BODY' }, { tagName: 'BUTTON' }, { tagName: 'A' }, { tagName: 'DIV', isContentEditable: false }, null, {}]) {
      expect(isTypingTarget(el as never), JSON.stringify(el)).toBe(false)
    }
  })
})
