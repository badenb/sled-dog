import { describe, expect, it } from 'vitest'
import { explainMigrationError } from '../server/db/migration-errors'

describe('explainMigrationError', () => {
  it('explains the "table already exists" case: a migration edited after it ran', () => {
    const out = explainMigrationError(Object.assign(new Error('batch failed'), { cause: new Error('table `subtask_links` already exists') }))
    expect(out).toContain('table `subtask_links` already exists') // the real reason is kept
    expect(out).toContain('edited or regenerated after it had already run')
    expect(out).toContain('add a NEW migration')
    expect(out).toContain('apps/web/README.md')
  })
  it('also recognises a duplicate column', () => {
    expect(explainMigrationError(new Error('duplicate column name: subtask_seq'))).toContain('edited or regenerated')
  })
  it('gives generic guidance, without the edited-migration hint, for other failures', () => {
    const out = explainMigrationError(new Error('SQLITE_CANTOPEN: unable to open database file'))
    expect(out).toContain('unable to open database file')
    expect(out).toContain('SLED_DOG_DB_URL')
    expect(out).not.toContain('edited or regenerated')
  })
  it('survives things that are not Errors', () => {
    expect(explainMigrationError('boom')).toContain('boom')
    expect(explainMigrationError(undefined)).toContain('Database migration failed')
  })
})
