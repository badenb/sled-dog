// Structure checks for the Codex data. The CLI-side test (apps/cli/tests/test_codex.py) checks that every
// example is valid CLI syntax and that every CLI command is covered; this checks the page can render it.
import { describe, expect, it } from 'vitest'
import codex from '../app/data/codex.json'

const items = codex.sections.flatMap(s => s.items.map(item => ({ section: s.id, ...item })))

describe('codex data', () => {
  it('has uniquely identified, titled sections with an introduction', () => {
    const ids = codex.sections.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of codex.sections) {
      expect(s.title.trim(), s.id).not.toBe('')
      expect(s.intro.trim(), s.id).not.toBe('')
      expect(s.items.length, s.id).toBeGreaterThan(0)
    }
  })

  it('titles every item once per section (they are used as keys)', () => {
    for (const s of codex.sections) {
      const titles = s.items.map(i => i.title)
      expect(new Set(titles).size, s.id).toBe(titles.length)
      for (const t of titles) expect(t.trim()).not.toBe('')
    }
  })

  it('uses only the {origin} placeholder', () => {
    for (const i of items) {
      for (const text of [i.title, i.note, i.command]) {
        const placeholders = (text ?? '').match(/\{[^}]*\}/g) ?? []
        for (const p of placeholders) expect(p, `${i.section}/${i.title}`).toBe('{origin}')
      }
    }
  })

  it('every verified command invokes sled-dog (optionally after a pipe or env settings)', () => {
    for (const i of items.filter(i => i.command && (i as { verify?: boolean }).verify !== false)) {
      expect(i.command, `${i.section}/${i.title}`).toMatch(/(^|\| |^([A-Z_]+=\S+ )+)sled-dog /)
    }
  })

  it('documents exit codes, each with a meaning', () => {
    expect(codex.exitCodes.map(c => c.code)).toEqual(expect.arrayContaining(['0', '1', '2', '3']))
    for (const c of codex.exitCodes) expect(c.meaning.trim()).not.toBe('')
  })

  it('never contains a token-shaped secret', () => {
    expect(JSON.stringify(codex)).not.toMatch(/ghp_[A-Za-z0-9]{10,}|github_pat_|\bsd_[A-Za-z0-9_-]{20,}/)
  })
})
