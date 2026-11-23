/**
 * Fetch for URLs built at runtime (e.g. /api/teams/<id>). Nuxt's typed $fetch tries to match every
 * route literal and overflows TypeScript on some dynamic ones; callers here type the response themselves.
 */
export const api = <T = unknown>(url: string, options?: { method?: string, body?: unknown }): Promise<T> =>
  (($fetch as unknown) as (url: string, options?: object) => Promise<T>)(url, options)
