import { fileURLToPath } from 'node:url'

// Secrets live in the repo-root .env (shared by apps). Nuxt only reads apps/web/.env,
// so load the root file for local dev. In production the host provides real env vars.
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))) } catch { /* no root .env */ }

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@pinia/nuxt'],
  css: ['~/assets/main.css'],
  typescript: { strict: true },
})
