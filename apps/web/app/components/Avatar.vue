<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string, size?: number }>(), { size: 22 })
// Stable colour per person, from a small friendly palette.
const palette = ['#7c3aed', '#2563eb', '#0d9488', '#c2410c', '#be185d', '#4d7c0f', '#b45309']
const color = computed(() => palette[[...props.name].reduce((n, c) => n + c.charCodeAt(0), 0) % palette.length])
</script>

<template>
  <span class="avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px`, background: color }" :title="name" aria-hidden="true">{{ initials(name) }}</span>
</template>
