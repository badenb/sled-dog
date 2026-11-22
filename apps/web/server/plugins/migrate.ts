import { useDb } from '../db'

// Apply pending migrations before the server accepts requests.
export default defineNitroPlugin(async () => {
  await useDb()
})
