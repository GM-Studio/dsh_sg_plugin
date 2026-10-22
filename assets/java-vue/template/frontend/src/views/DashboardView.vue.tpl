<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElCard } from 'element-plus';
import { sysDashboardApi } from '../api/sys';
import { ApiError } from '../api/request';
import type { SysDashboard } from '../api/sys';
import type { User } from '../api/types';

defineProps<{ user?: User }>();

const { t } = useI18n();
const summary = ref<SysDashboard | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    summary.value = await sysDashboardApi.summary();
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : t('error.unexpected');
  }
}

onMounted(load);
</script>

<template>
  <div id="dashboard">
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ t('dashboard.eyebrow') }}</p>
        <h1>{{ t('dashboard.title') }}</h1>
        <p>{{ t('dashboard.description') }}</p>
      </div>
      <el-button :disabled="false" @click="load">
        {{ t('common.refresh') }}
      </el-button>
    </div>
    <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
    <div class="stats">
      <el-card shadow="never">
        <span>{{ t('dashboard.users') }}</span>
        <strong>{{ summary?.userCount ?? 0 }}</strong>
      </el-card>
      <el-card shadow="never">
        <span>{{ t('dashboard.roles') }}</span>
        <strong>{{ summary?.roleCount ?? 0 }}</strong>
      </el-card>
      <el-card shadow="never">
        <span>{{ t('dashboard.departments') }}</span>
        <strong>{{ summary?.departmentCount ?? 0 }}</strong>
      </el-card>
      <el-card shadow="never">
        <span>{{ t('dashboard.menus') }}</span>
        <strong>{{ summary?.menuCount ?? 0 }}</strong>
      </el-card>
    </div>
  </div>
</template>
