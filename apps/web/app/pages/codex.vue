<script setup lang="ts">
import codex from '~/data/codex.json'

interface Item { title: string, note?: string, command?: string, link?: { to: string, label: string } }
const toast = useToast()
const origin = useRequestURL().origin
// {origin} is this server's own URL, so examples work if pasted as they are.
const show = (text: string) => text.replaceAll('{origin}', origin)

const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())
const matches = (item: Item) => !q.value || [item.title, item.note, item.command].some(t => t && show(t).toLowerCase().includes(q.value))
const sections = computed(() => (codex.sections as { id: string, title: string, intro: string, items: Item[] }[])
  .map(s => ({ ...s, items: s.items.filter(matches) }))
  .filter(s => s.items.length || (!q.value)))
const nothing = computed(() => !!q.value && !sections.value.some(s => s.items.length))

async function copy(command: string) {
  try {
    await navigator.clipboard.writeText(show(command))
    toast.push('Copied')
  } catch {
    toast.push('Could not copy. Select the command and copy it manually.', 'error')
  }
}
</script>

<template>
  <div class="codex">
    <aside class="toc" aria-label="On this page">
      <nav>
        <a v-for="s in codex.sections" :key="s.id" :href="`#${s.id}`">{{ s.title }}</a>
        <a href="#exit-codes">Exit codes</a>
      </nav>
    </aside>

    <div class="codex-body">
      <div class="page-head">
        <div>
          <h1>Codex</h1>
          <p class="muted small">Everything you need to drive Sled Dog from a terminal, by people and by agents. Click any command to copy it.</p>
        </div>
        <input v-model="query" type="search" class="codex-filter" placeholder="Filter commands…" aria-label="Filter the Codex">
      </div>

      <p v-if="nothing" class="empty">Nothing matches “{{ query }}”.</p>

      <section v-for="s in sections" :id="s.id" :key="s.id" class="panel codex-section">
        <h2>{{ s.title }}</h2>
        <p v-if="!q" class="muted">{{ s.intro }}</p>
        <article v-for="item in s.items" :key="item.title" class="codex-item">
          <h3>{{ item.title }}</h3>
          <p v-if="item.note" class="muted small">{{ show(item.note) }}</p>
          <div v-if="item.command" class="cmd">
            <code>{{ show(item.command) }}</code>
            <button class="sm" :aria-label="`Copy: ${show(item.command)}`" @click="copy(item.command)">Copy</button>
          </div>
          <NuxtLink v-if="item.link" :to="item.link.to" class="codex-link">{{ item.link.label }} →</NuxtLink>
        </article>
      </section>

      <section v-if="!q" id="exit-codes" class="panel codex-section">
        <h2>Exit codes</h2>
        <p class="muted">Every command ends with one of these, so a script can react without parsing text.</p>
        <table class="codes">
          <tbody>
            <tr v-for="c in codex.exitCodes" :key="c.code"><th scope="row"><code>{{ c.code }}</code></th><td>{{ c.meaning }}</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
