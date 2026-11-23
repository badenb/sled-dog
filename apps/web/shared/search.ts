// Pure helpers for ticket search: turn what a person typed into terms, make them safe to use in a LIKE pattern,
// and explain why a result matched. No framework imports: unit-tested directly.

export const MAX_QUERY_LENGTH = 200
export const MAX_TERMS = 8

/**
 * Split a query into terms: words, or "quoted phrases" kept together. Terms are AND-ed by the search, so
 * `login redirect` finds tickets that mention both, and `"login redirect"` finds that exact phrase.
 * An unclosed quote just runs to the end. Duplicates (ignoring case) are dropped.
 */
export function tokenize(query: string): string[] {
  const terms: string[] = []
  for (const m of query.matchAll(/"([^"]*)"?|(\S+)/g)) {
    const term = (m[1] ?? m[2] ?? '').trim()
    if (term && !terms.some(t => t.toLowerCase() === term.toLowerCase())) terms.push(term)
  }
  return terms
}

/** Make a user's term safe inside a LIKE pattern: %, _ and \ must match themselves, not act as wildcards. */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, c => `\\${c}`)
export const likePattern = (term: string) => `%${escapeLike(term.toLowerCase())}%`

export interface TermRef { ticket: number, subtask: number | null }

/**
 * A term that names a ticket: SD-12, sd-12, or a bare 12; SD-12.2 names subtask 2 of ticket 12.
 * A bare number with a dot (3.14, a version) is text, not a subtask: subtasks need the SD- prefix.
 */
export function refOf(term: string): TermRef | null {
  const prefixed = /^sd-(\d{1,9})(?:\.(\d{1,4}))?$/i.exec(term)
  if (prefixed) return { ticket: Number(prefixed[1]), subtask: prefixed[2] ? Number(prefixed[2]) : null }
  const bare = /^(\d{1,9})$/.exec(term)
  return bare ? { ticket: Number(bare[1]), subtask: null } : null
}

/** A short excerpt of the text around the first term it contains, for showing why a result matched. */
export function snippet(text: string, terms: string[], width = 140): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const hits = terms.map(t => lower.indexOf(t.toLowerCase())).filter(i => i >= 0)
  if (!hits.length) return null
  const at = Math.min(...hits)
  const start = Math.max(0, at - Math.floor(width / 3))
  const end = Math.min(flat.length, start + width)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

export interface Searchable {
  number: number
  title: string
  body: string
  assignee: string | null
  subtasks?: { ref: string, title: string, assignee: string | null, pullRequests?: { number: number, title: string, key: string }[] }[]
  steps?: { title: string }[]
  pullRequests?: { number: number, title: string, key: string }[]
}

/** Which parts of a ticket contain at least one of the terms. Order: the ticket itself first, then what is inside it. */
export function matchedIn(ticket: Searchable, terms: string[]): string[] {
  const has = (text: string | null | undefined) => !!text && terms.some(t => text.toLowerCase().includes(t.toLowerCase()))
  const found: string[] = []
  if (terms.some(t => { const r = refOf(t); return r && r.ticket === ticket.number && (r.subtask === null || ticket.subtasks?.some(s => s.ref === `SD-${r.ticket}.${r.subtask}`)) })) found.push('reference')
  if (has(ticket.title)) found.push('title')
  if (has(ticket.body)) found.push('description')
  if (has(ticket.assignee)) found.push('assignee')
  for (const s of ticket.subtasks ?? []) if (has(s.title) || has(s.assignee) || (s.pullRequests ?? []).some(p => has(p.title) || has(p.key))) found.push(`subtask ${s.ref}`)
  for (const s of ticket.steps ?? []) if (has(s.title)) found.push(`step "${s.title}"`)
  for (const p of ticket.pullRequests ?? []) if (has(p.title) || has(p.key)) found.push(`pull request #${p.number}`)
  return found
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Split text into pieces, marking the ones that match a search term, so the page can highlight them. It returns
 * plain text segments to render with <mark>, never HTML, so user-written titles cannot inject anything.
 * Matching ignores case and uses the original text's own positions (lowercasing can change a string's length).
 */
export function highlightSegments(text: string, terms: string[]): { text: string, hit: boolean }[] {
  const needles = terms.map(t => t.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!text || !needles.length) return [{ text, hit: false }]
  const pattern = new RegExp(needles.map(escapeRegExp).join('|'), 'gi')
  const segments: { text: string, hit: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(pattern)) {
    const start = m.index!
    if (m[0].length === 0) continue
    if (start > last) segments.push({ text: text.slice(last, start), hit: false })
    segments.push({ text: m[0], hit: true })
    last = start + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false })
  return segments.length ? segments : [{ text, hit: false }]
}
