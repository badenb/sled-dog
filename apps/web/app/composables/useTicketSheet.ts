import type { OriginRect } from '~/components/TicketModal.vue'

/**
 * The open ticket lives in the URL (?ticket=SD-12), so it is shareable and Back closes it, and it works from any
 * page: the board, search results, the archive. The sheet itself is hosted once, in the app shell.
 */
export function useTicketSheet() {
  const route = useRoute()
  const router = useRouter()
  const openId = computed(() => (typeof route.query.ticket === 'string' ? route.query.ticket : null))
  const origin = useState<OriginRect | null>('sheet-origin', () => null)

  /** Pass the clicked element's rectangle and the sheet unfolds out of it. */
  function open(id: string, rect?: DOMRect) {
    origin.value = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
    router.push({ query: { ...route.query, ticket: id } })
  }
  function close() {
    origin.value = null
    const { ticket: _closed, ...rest } = route.query
    router.replace({ query: rest })
  }
  // Edits in the sheet arrive in bursts; refresh whatever is showing tickets once they settle.
  let timer: ReturnType<typeof setTimeout> | undefined
  function changed() {
    clearTimeout(timer)
    timer = setTimeout(() => refreshNuxtData(['tickets', 'search', 'archived-count']), 500)
  }
  return { openId, origin, open, close, changed }
}
