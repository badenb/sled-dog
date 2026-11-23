import { useDb } from '../db'
import { explainMigrationError } from '../db/migration-errors'

// Apply pending migrations before the server accepts requests. If that fails, say why in plain words
// before the error propagates, instead of leaving a stack trace and a half-working server.
export default defineNitroPlugin(async () => {
  try {
    await useDb()
  } catch (error) {
    console.error(explainMigrationError(error))
    throw error
  }
})
