<script setup lang="ts">
import { ElButton, ElTag } from 'element-plus';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';

defineProps<{ username: string; role: string; busy: boolean }>();
defineEmits<{ logout: []; toggleLocale: [] }>();

const { t } = useI18n();
</script>

<template>
  <div class="admin-shell">
    <aside class="sidebar" :aria-label="t('navigation.ariaLabel')">
      <a class="brand" href="#/dashboard">
        <b class="brand-mark">S</b>
        {{ t('common.appName') }}
      </a>
      <p class="nav-label">{{ t('navigation.workspace') }}</p>
      <RouterLink class="nav-link" to="/dashboard">
        ◱ {{ t('navigation.dashboard') }}
      </RouterLink>
      <RouterLink class="nav-link" to="/tasks">
        ▦ {{ t('navigation.tasks') }}
      </RouterLink>
      <div class="sidebar-note">
        {{ t('navigation.note') }}
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <span>
          {{ t('navigation.breadcrumb') }}
        </span>
        <div>
          <el-tag>{{ username }} · {{ role }}</el-tag>
          <el-button :disabled="busy" @click="$emit('toggleLocale')">
            {{ t('language.switch') }}
          </el-button>
          <el-button :disabled="busy" @click="$emit('logout')">
            {{ t('navigation.logout') }}
          </el-button>
        </div>
      </header>
      <main>
        <slot />
        <footer>
          {{ t('footer.product') }}
          <span>{{ t('footer.stack') }}</span>
        </footer>
      </main>
    </div>
  </div>
</template>
