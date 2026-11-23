/** True when the keyboard focus is somewhere text is being typed, so a single-key shortcut like "/" must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string, isContentEditable?: boolean } | null
  if (!el || !el.tagName) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName.toUpperCase()) || !!el.isContentEditable
}
