import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as schema from './schema'

const url = process.env.SLED_DOG_DB_URL || 'file:.data/sled-dog.db'
if (url.startsWith('file:.data')) mkdirSync('.data', { recursive: true })

// Created synchronously so Better Auth's adapter can use it at import time.
export const db = drizzle(createClient({ url }), { schema })

let migrated: Promise<void> | undefined

/** Applies pending SQL migrations once per process. Safe to call from anywhere. */
export function useDb() {
  migrated ??= migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') })
  return migrated.then(() => db)
}

export { schema }
