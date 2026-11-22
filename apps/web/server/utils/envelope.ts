import type { Envelope } from '#shared/contract'

export function envelope<T>(data: T, meta: Record<string, unknown> = {}): Envelope<T> {
  return { schema_version: 1, data, meta, errors: [] }
}
