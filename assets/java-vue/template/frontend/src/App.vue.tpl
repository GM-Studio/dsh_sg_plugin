<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElCard, ElInput } from 'element-plus';
import { RouterView } from 'vue-router';
import AppLayout from './layout/AppLayout.vue';
import { authApi } from './api/auth';
import { ApiError } from './api/request';
import type { User } from './api/types';
import { setLocale, type AppLocale } from './i18n';

const { t, locale } = useI18n();
const user = ref<User | null>(null);
const username = ref('admin');
const password = ref('');
const busy = ref(false);
const error = ref('');

function expired() {
  user.value = null;
}
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : t('error.unexpected');
    if (cause instanceof ApiError && cause.traceId)
      error.value += ` (${t('error.trace')}: ${cause.traceId})`;
  } finally {
    busy.value = false;
  }
}
async function login() {
  await run(async () => {
    user.value = await authApi.login(username.value, password.value);
    password.value = '';
  });
}
async function logout() {
  await run(async () => {
    await authApi.logout();
    expired();
  });
}
function toggleLocale() {
  const next: AppLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
  setLocale(next);
}
onMounted(async () => {
  window.addEventListener('session-expired', expired);
  await run(async () => {
    try {
      user.value = await authApi.me();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return;
      throw cause;
    }
  });
});
onUnmounted(() => window.removeEventListener('session-expired', expired));
</script>

<template>
  <div v-if="!user" class="login-shell">
    <el-card class="login-card" shadow="never">
      <p class="eyebrow">{{ t('login.eyebrow') }}</p>
      <h1>{{ t('login.title') }}</h1>
      <p>{{ t('login.description') }}</p>
      <form @submit.prevent="login">
        <label for="username">{{ t('login.username') }}</label>
        <el-input
          id="username"
          v-model="username"
          autocomplete="username"
          :disabled="busy"
        />
        <label for="password">{{ t('login.password') }}</label>
        <el-input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
        />
        <el-button type="primary" native-type="submit" :disabled="busy">
          {{ t('login.submit') }}
        </el-button>
      </form>
      <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
    </el-card>
  </div>
  <AppLayout
    v-else
    :username="user.username"
    :role="user.role"
    :busy="busy"
    @logout="logout"
    @toggle-locale="toggleLocale"
  >
    <RouterView v-slot="{ Component }">
      <component :is="Component" :user="user" />
    </RouterView>
  </AppLayout>
</template>
