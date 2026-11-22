export interface Toast { id: number, kind: 'info' | 'error', text: string }

/** Tiny shared toast queue. Messages dismiss themselves after a few seconds. */
export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])
  function dismiss(id: number) { toasts.value = toasts.value.filter(t => t.id !== id) }
  function push(text: string, kind: Toast['kind'] = 'info') {
    const id = Date.now() + Math.random()
    toasts.value = [...toasts.value, { id, kind, text }]
    if (import.meta.client) setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000)
  }
  return { toasts, push, dismiss }
}
