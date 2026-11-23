// Guards the rule that cost us a broken dev server: a migration that has been committed must never change.
// Databases remember each migration by hash, so editing or regenerating one makes the next startup try to
// re-run it and fail. To change the schema, add a NEW migration, then run `npm run db:seal`.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('../drizzle/', import.meta.url))
const journal = JSON.parse(readFileSync(`${dir}meta/_journal.json`, 'utf8')) as { entries: { idx: number, tag: string, when: number }[] }
const sealed = JSON.parse(readFileSync(`${dir}meta/checksums.json`, 'utf8')) as Record<string, string>
const sha = (tag: string) => createHash('sha256').update(readFileSync(`${dir}${tag}.sql`, 'utf8')).digest('hex')

describe('migrations are append-only', () => {
  it('every journal entry has its SQL file, and every SQL file is in the journal', () => {
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, '')).sort()
    expect(journal.entries.map(e => e.tag).sort()).toEqual(files)
    for (const e of journal.entries) expect(existsSync(`${dir}${e.tag}.sql`)).toBe(true)
  })

  it('timestamps strictly increase (drizzle applies by timestamp)', () => {
    const whens = journal.entries.map(e => e.when)
    expect(whens).toEqual([...whens].sort((a, b) => a - b))
    expect(new Set(whens).size).toBe(whens.length)
  })

  it('every migration is sealed, and none has changed since it was', () => {
    for (const { tag } of journal.entries) {
      expect(sealed[tag], `${tag} is not sealed. Run: npm run db:seal`).toBeTruthy()
      expect(sha(tag), `${tag}.sql changed after it was sealed. Restore it and add a NEW migration instead.`).toBe(sealed[tag])
    }
  })

  it('no sealed migration has been removed', () => {
    const tags = new Set(journal.entries.map(e => e.tag))
    for (const tag of Object.keys(sealed)) expect(tags.has(tag), `${tag} was sealed but is gone from the journal`).toBe(true)
  })
})
