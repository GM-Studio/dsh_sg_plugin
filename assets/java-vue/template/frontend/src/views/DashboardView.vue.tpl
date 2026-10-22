<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElCard } from 'element-plus';
import { taskApi } from '../api/tasks';
import { ApiError } from '../api/request';
import type { User } from '../api/types';

defineProps<{ user?: User }>();

const { t } = useI18n();
const total = ref(0);
const completed = ref(0);
const pending = ref(0);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const first = await taskApi.list({ page: 1, pageSize: 1 });
    total.value = first.total;
    const sample = await taskApi.list({ page: 1, pageSize: 100 });
    completed.value = sample.records.filter((item) => item.completed).length;
    pending.value = sample.records.length - completed.value;
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
        <span>{{ t('dashboard.totalTasks') }}</span>
        <strong>{{ total }}</strong>
      </el-card>
      <el-card shadow="never">
        <span>{{ t('dashboard.completedTasks') }}</span>
        <strong class="success">{{ completed }}</strong>
      </el-card>
      <el-card shadow="never">
        <span>{{ t('dashboard.pendingTasks') }}</span>
        <strong>{{ pending }}</strong>
      </el-card>
    </div>
  </div>
</template>
