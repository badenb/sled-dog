<script setup lang="ts">
const { toasts, dismiss } = useToast()
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" :class="['toast', t.kind]">
      <span>{{ t.text }}</span>
      <button class="ghost sm" style="color: inherit; height: auto; padding: 0 4px" aria-label="Dismiss" @click="dismiss(t.id)">✕</button>
    </div>
  </div>
</template>
