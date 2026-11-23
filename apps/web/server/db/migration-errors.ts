// Turns a raw migration failure into something a person can act on. Pure, so it is unit-tested.
export function explainMigrationError(error: unknown): string {
  const e = error as { cause?: { message?: string }, message?: string } | null
  const reason = String(e?.cause?.message ?? e?.message ?? error)
  const lines = ['', '✖ Database migration failed, so the server cannot start safely.', `  Reason: ${reason}`, '']
  if (/already exists|duplicate column/i.test(reason)) {
    lines.push(
      '  This usually means a migration file was edited or regenerated after it had already run on this database.',
      '  Never rewrite an applied migration: restore the original file from git and add a NEW migration for the change.',
      '  Rule and checks: see "Database" in apps/web/README.md (npm run db:seal, tests/migrations.test.ts).',
    )
  } else {
    lines.push('  Check the migration SQL in apps/web/drizzle/ and the database at SLED_DOG_DB_URL.')
  }
  lines.push('')
  return lines.join('\n')
}
