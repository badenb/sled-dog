<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
const email = ref('')
const sent = ref(false)
const busy = ref(false)
// Hook failures surface as codes like unable_to_create_user; the only way sign-up fails today is the invite gate.
const friendly = (code: string) => /unable_to_create_user|invite|forbidden/i.test(code)
  ? 'This workspace is invite-only. Ask an owner to invite you.'
  : code.replaceAll('_', ' ')
const error = ref(typeof route.query.error === 'string' ? friendly(route.query.error) : '')

async function github() {
  await authClient.signIn.social({ provider: 'github', callbackURL: '/', errorCallbackURL: '/login' })
}

async function magic() {
  busy.value = true
  error.value = ''
  const { error: err } = await authClient.signIn.magicLink({ email: email.value, callbackURL: '/', errorCallbackURL: '/login' })
  busy.value = false
  if (err) error.value = err.message || 'Could not send the link'
  else sent.value = true
}
</script>

<template>
  <main class="login-wrap">
    <div class="login">
      <div class="logo" aria-hidden="true">🐕</div>
      <div>
        <h1>Sled Dog</h1>
        <p class="muted" style="margin: 4px 0 0">Sign in to your workspace</p>
      </div>
      <p v-if="error" class="notice" role="alert" style="margin: 0">{{ error }}</p>
      <button class="primary" @click="github">Continue with GitHub</button>
      <div class="divider">or</div>
      <form v-if="!sent" @submit.prevent="magic">
        <input v-model="email" type="email" required placeholder="you@company.com" aria-label="Email" autocomplete="email">
        <button :disabled="busy || !email">{{ busy ? 'Sending…' : 'Email me a sign-in link' }}</button>
      </form>
      <p v-else class="reveal" style="margin: 0">Check your inbox for the link. It expires in 10 minutes.</p>
      <p class="muted small" style="margin: 0">Access is by invitation.</p>
    </div>
  </main>
</template>
