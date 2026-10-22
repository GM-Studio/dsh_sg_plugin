<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElCard, ElInput, ElPagination, ElTag } from 'element-plus';
import { sysAuditApi } from '../../api/sys';
import { ApiError } from '../../api/request';
import type { SysAuditLog, SysAuditQuery } from '../../api/sys';

const props = defineProps<{ user?: { username: string; role: string } }>();
const { t } = useI18n();
const admin = computed(() => props.user?.role === 'ADMIN');
const busy = ref(false);
const error = ref('');
const records = ref<SysAuditLog[]>([]);
const total = ref(0);
const query = ref<SysAuditQuery>({
  page: 1,
  pageSize: 20,
  actor: '',
  action: '',
});

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
async function refresh() {
  const page = await sysAuditApi.list(query.value);
  records.value = page.records;
  total.value = page.total;
}
async function pageChanged(page: number) {
  query.value.page = page;
  await run(refresh);
}
async function search() {
  query.value.page = 1;
  await run(refresh);
}
onMounted(() => run(refresh));
</script>

<template>
  <div id="sys-audits" :class="{ 'is-admin': admin }">
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ t('sys.audits.eyebrow') }}</p>
        <h1>{{ t('sys.audits.title') }}</h1>
        <p>{{ t('sys.audits.description') }}</p>
      </div>
      <el-button :disabled="busy" @click="run(refresh)">
        {{ t('common.refresh') }}
      </el-button>
    </div>
    <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
    <p v-if="busy" role="status">{{ t('common.working') }}</p>
    <el-card shadow="never" class="filter-panel">
      <form class="toolbar" @submit.prevent="search">
        <el-input
          id="filter-audit-actor"
          v-model="query.actor"
          :placeholder="t('sys.audits.filterActor')"
          :aria-label="t('sys.audits.filterActor')"
        />
        <el-input
          id="filter-audit-action"
          v-model="query.action"
          :placeholder="t('sys.audits.filterAction')"
          :aria-label="t('sys.audits.filterAction')"
        />
        <el-button native-type="submit" :disabled="busy">
          {{ t('common.search') }}
        </el-button>
      </form>
    </el-card>
    <el-card class="task-panel" shadow="never">
      <div class="panel-heading">
        <h2>
          {{ t('sys.audits.title') }}
          <el-tag effect="plain">
            {{ t('sys.audits.total', { count: total }) }}
          </el-tag>
        </h2>
      </div>
      <p v-if="!busy && !records.length" class="empty-state">
        {{ t('sys.audits.empty') }}
      </p>
      <table v-else class="audit-table">
        <thead>
          <tr>
            <th>{{ t('sys.audits.actor') }}</th>
            <th>{{ t('sys.audits.action') }}</th>
            <th>{{ t('sys.audits.target') }}</th>
            <th>{{ t('sys.audits.detail') }}</th>
            <th>{{ t('sys.audits.createdAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id" class="audit-row">
            <td>{{ record.actor }}</td>
            <td>{{ record.action }}</td>
            <td>{{ record.target }}</td>
            <td>{{ record.detail }}</td>
            <td>{{ record.createdAt }}</td>
          </tr>
        </tbody>
      </table>
      <el-pagination
        :current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="prev, pager, next"
        :disabled="busy"
        @current-change="pageChanged"
      />
    </el-card>
  </div>
</template>
