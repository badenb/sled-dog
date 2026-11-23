<script setup lang="ts">
import { TICKET_STATUSES, type Envelope, type SearchResult, type Ticket } from '#shared/contract'
import { highlightSegments } from '#shared/search'

interface Row { ticket: Ticket, matchedIn: string[], snippet: string | null }

const MODES = ['all', 'exclude', 'only'] as const
type Mode = (typeof MODES)[number]
const MODE_LABELS: Record<Mode, string> = { all: 'All tickets', exclude: 'Live only', only: 'Archive only' }

const route = useRoute()
const router = useRouter()
const sheet = useTicketSheet()
const fetcher = useRequestFetch()
const { data: me } = await useMe()

// The page is driven by the URL, so a search can be shared and Back works.
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''))
const mode = computed<Mode>(() => (MODES.includes(route.query.archived as Mode) ? (route.query.archived as Mode) : 'all'))
const status = computed(() => (TICKET_STATUSES.includes(route.query.status as never) ? String(route.query.status) : ''))
const limit = computed(() => (route.query.limit === '100' ? 100 : 30))
const browsingArchive = computed(() => !q.value && mode.value === 'only')

function go(patch: Record<string, string | undefined>) {
  const next = { ...route.query, ...patch }
  for (const key of Object.keys(next)) if (!next[key]) delete next[key]
  if (next.archived === 'all') delete next.archived
  if (next.limit === '30') delete next.limit
  router.replace({ query: next })
}

// Type here and results follow; the header box and this one stay in step.
const draft = ref(q.value)
let typing: ReturnType<typeof setTimeout> | undefined
watch(draft, (v) => { clearTimeout(typing); typing = setTimeout(() => go({ q: v.trim() || undefined, limit: undefined }), 250) })
watch(q, (v) => { if (v !== draft.value.trim()) draft.value = v })

const { data, error, status: loading } = await useAsyncData('search', async () => {
  if (!q.value && mode.value !== 'only') return null
  const common = { status: status.value || undefined, limit: limit.value }
  if (q.value) {
    const res = await fetcher<Envelope<SearchResult[]>>('/api/search', { query: { q: q.value, archived: mode.value, ...common } })
    return { rows: res.data.map(t => ({ ticket: t, matchedIn: t.matchedIn, snippet: t.snippet }) as Row), total: Number(res.meta.total), terms: (res.meta.terms as string[]) ?? [] }
  }
  // No words, just the archive: list it.
  const res = await fetcher<Envelope<Ticket[]>>('/api/tickets', { query: { archived: 'only', ...common } })
  return { rows: res.data.map(t => ({ ticket: t, matchedIn: [], snippet: null }) as Row), total: Number(res.meta.total), terms: [] as string[] }
}, { watch: [q, mode, status, limit] })

const { data: archiveSetting } = await useFetch<Envelope<{ summary: string }>>('/api/settings/archive', { key: 'archive-setting' })
const canConfigure = computed(() => !!me.value?.can['team:manage'])
const errorText = computed(() => (error.value as { data?: { statusMessage?: string } } | null)?.data?.statusMessage ?? (error.value ? 'The search did not work. Try again.' : ''))
const terms = computed(() => data.value?.terms ?? [])
const label = (s: string) => s.replace('_', ' ')
const open = (id: string, e: Event) => sheet.open(id, (e.currentTarget as HTMLElement).getBoundingClientRect())
</script>

<template>
  <div class="search-page">
    <div class="page-head">
      <div>
        <h1>{{ browsingArchive ? 'Archive' : 'Search' }}</h1>
        <p v-if="browsingArchive" class="muted small">
          Finished tickets leave the board after {{ archiveSetting?.data.summary ?? 'a while' }}. Nothing is deleted.
          <NuxtLink v-if="canConfigure" to="/settings/archive">Change this</NuxtLink>
        </p>
        <p v-else class="muted small">Looks at references, titles, descriptions, assignees, subtasks, trail steps and pull request titles.</p>
      </div>
    </div>

    <div class="search-bar">
      <input v-model="draft" type="search" class="search-input" placeholder="Search tickets, e.g. login redirect, SD-12, &quot;exact phrase&quot;" aria-label="Search" autocomplete="off" autofocus>
      <div class="filters">
        <select :value="status" aria-label="Status" @change="go({ status: ($event.target as HTMLSelectElement).value || undefined })">
          <option value="">Any status</option>
          <option v-for="s in TICKET_STATUSES" :key="s" :value="s">{{ label(s) }}</option>
        </select>
        <div class="segmented" role="radiogroup" aria-label="Which tickets">
          <button v-for="m in MODES" :key="m" role="radio" :aria-checked="mode === m" :class="{ on: mode === m }" @click="go({ archived: m })">{{ MODE_LABELS[m] }}</button>
        </div>
      </div>
    </div>

    <p v-if="errorText" class="notice" role="alert">{{ errorText }}</p>

    <template v-else-if="data">
      <p class="muted small count" role="status">
        <template v-if="!data.rows.length">No results</template>
        <template v-else-if="data.total > data.rows.length">Showing {{ data.rows.length }} of {{ data.total }}</template>
        <template v-else>{{ data.total }} result{{ data.total === 1 ? '' : 's' }}</template>
        <template v-if="loading === 'pending'"> · searching…</template>
      </p>

      <ul v-if="data.rows.length" class="results">
        <li v-for="r in data.rows" :key="r.ticket.id">
          <button class="result" @click="open(r.ticket.id, $event)">
            <span class="r-top">
              <span class="id">{{ r.ticket.id }}</span>
              <span class="pill"><span class="dot" :style="{ background: `var(--s-${r.ticket.status})` }" />{{ label(r.ticket.status) }}</span>
              <span v-if="r.ticket.archivedAt" class="pill archived">Archived</span>
              <Avatar v-if="r.ticket.assignee" :name="r.ticket.assignee" :size="20" class="r-who" />
            </span>
            <span class="r-title"><template v-for="(seg, i) in highlightSegments(r.ticket.title, terms)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
            <span v-if="r.matchedIn.length" class="r-why muted small">matched in {{ r.matchedIn.join(' · ') }}</span>
            <span v-if="r.snippet" class="r-snippet small"><template v-for="(seg, i) in highlightSegments(r.snippet, terms)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </button>
        </li>
      </ul>
      <div v-else class="empty">
        <template v-if="browsingArchive">Nothing is archived yet. Done and canceled tickets are archived after {{ archiveSetting?.data.summary ?? 'a while' }}.</template>
        <template v-else>No tickets match “{{ q }}”. Try fewer or different words{{ mode === 'exclude' ? ', or search all tickets' : '' }}.</template>
      </div>

      <p v-if="data.total > data.rows.length" class="more">
        <button v-if="limit < 100" @click="go({ limit: '100' })">Show more</button>
        <span v-else class="muted small">There are more matches than fit here. Add a word, or filter by status, to narrow it down.</span>
      </p>
    </template>

    <div v-else class="panel tips">
      <h2>Find anything</h2>
      <p class="muted">Every word must match, in any order. Quote words to keep them together.</p>
      <ul class="tip-list">
        <li><code>login redirect</code> tickets that mention both words</li>
        <li><code>"third-party cookies"</code> that exact phrase</li>
        <li><code>SD-12</code> or <code>SD-12.2</code> a ticket, or a subtask</li>
        <li><code>dana</code> a person, or <code>payments</code> a pull request title</li>
      </ul>
      <p class="muted small">Archived tickets are included, so old work is never lost. <NuxtLink :to="{ path: '/search', query: { archived: 'only' } }">Browse the archive →</NuxtLink></p>
    </div>
  </div>
</template>
