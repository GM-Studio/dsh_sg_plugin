<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElCard, ElInput, ElPagination, ElTag } from 'element-plus';
import { sysMenuApi } from '../../api/sys';
import { ApiError } from '../../api/request';
import type { SysMenu, SysMenuQuery } from '../../api/sys';

const props = defineProps<{ user?: { username: string; role: string } }>();
const { t } = useI18n();
const admin = computed(() => props.user?.role === 'ADMIN');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const records = ref<SysMenu[]>([]);
const total = ref(0);
const query = ref<SysMenuQuery>({
  page: 1,
  pageSize: 20,
  code: '',
  name: '',
});
const editId = ref<number | null>(null);
const code = ref('');
const name = ref('');
const path = ref('');
const icon = ref('');
const sortOrder = ref('0');
const enabled = ref(true);
const pendingDelete = ref<number | null>(null);

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
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
  const page = await sysMenuApi.list(query.value);
  records.value = page.records;
  total.value = page.total;
}
function reset() {
  editId.value = null;
  code.value = '';
  name.value = '';
  path.value = '';
  icon.value = '';
  sortOrder.value = '0';
  enabled.value = true;
}
function edit(record: SysMenu) {
  editId.value = record.id;
  code.value = record.code;
  name.value = record.name;
  path.value = record.path;
  icon.value = record.icon;
  sortOrder.value = String(record.sortOrder);
  enabled.value = record.enabled;
}
async function save() {
  if (!code.value.trim() || !name.value.trim()) {
    error.value = t('sys.menus.validation');
    return;
  }
  await run(async () => {
    const body = {
      code: code.value.trim(),
      name: name.value.trim(),
      path: path.value.trim(),
      icon: icon.value.trim(),
      sortOrder: Number(sortOrder.value) || 0,
      enabled: enabled.value,
    };
    const current = editId.value;
    if (current === null) await sysMenuApi.create(body);
    else await sysMenuApi.update({ ...body, id: current });
    reset();
    notice.value = t('sys.menus.created');
    await refresh();
  });
}
async function remove() {
  const id = pendingDelete.value;
  if (id === null) return;
  await run(async () => {
    await sysMenuApi.remove(id);
    pendingDelete.value = null;
    reset();
    notice.value = t('sys.menus.deleted');
    await refresh();
  });
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
  <div id="sys-menus">
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ t('sys.menus.eyebrow') }}</p>
        <h1>{{ t('sys.menus.title') }}</h1>
        <p>{{ t('sys.menus.description') }}</p>
      </div>
      <el-button :disabled="busy" @click="run(refresh)">
        {{ t('common.refresh') }}
      </el-button>
    </div>
    <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="busy" role="status">{{ t('common.working') }}</p>
    <el-card shadow="never" class="filter-panel">
      <form class="toolbar" @submit.prevent="search">
        <el-input
          id="filter-menu-code"
          v-model="query.code"
          :placeholder="t('sys.menus.filterCode')"
          :aria-label="t('sys.menus.filterCode')"
        />
        <el-input
          id="filter-menu-name"
          v-model="query.name"
          :placeholder="t('sys.menus.filterName')"
          :aria-label="t('sys.menus.filterName')"
        />
        <el-button native-type="submit" :disabled="busy">
          {{ t('common.search') }}
        </el-button>
      </form>
    </el-card>
    <el-card v-if="admin" class="editor" shadow="never">
      <h2>
        {{ editId === null ? t('sys.menus.create') : t('sys.menus.edit') }}
      </h2>
      <form @submit.prevent="save">
        <div class="title-field">
          <label for="menu-code">{{ t('sys.menus.code') }}</label>
          <el-input
            id="menu-code"
            v-model="code"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="menu-name">{{ t('sys.menus.name') }}</label>
          <el-input
            id="menu-name"
            v-model="name"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="menu-path">{{ t('sys.menus.path') }}</label>
          <el-input
            id="menu-path"
            v-model="path"
            maxlength="255"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="menu-icon">{{ t('sys.menus.icon') }}</label>
          <el-input
            id="menu-icon"
            v-model="icon"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="menu-sort">{{ t('sys.menus.sortOrder') }}</label>
          <el-input
            id="menu-sort"
            v-model="sortOrder"
            type="number"
            :disabled="busy"
          />
        </div>
        <label class="checkbox-field" for="menu-enabled">
          <input
            id="menu-enabled"
            v-model="enabled"
            type="checkbox"
            :disabled="busy"
          />
          {{ t('sys.menus.enabled') }}
        </label>
        <el-button type="primary" native-type="submit" :disabled="busy">
          {{ editId === null ? t('sys.menus.create') : t('sys.menus.save') }}
        </el-button>
        <el-button v-if="editId !== null" :disabled="busy" @click="reset">
          {{ t('common.cancel') }}
        </el-button>
      </form>
    </el-card>
    <el-card class="task-panel" shadow="never">
      <div class="panel-heading">
        <h2>
          {{ t('sys.menus.title') }}
          <el-tag effect="plain">
            {{ t('sys.menus.total', { count: total }) }}
          </el-tag>
        </h2>
      </div>
      <p v-if="!busy && !records.length" class="empty-state">
        {{ t('sys.menus.empty') }}
      </p>
      <table v-else class="menu-table">
        <thead>
          <tr>
            <th>{{ t('sys.menus.code') }}</th>
            <th>{{ t('sys.menus.name') }}</th>
            <th>{{ t('sys.menus.path') }}</th>
            <th>{{ t('sys.menus.icon') }}</th>
            <th>{{ t('sys.menus.sortOrder') }}</th>
            <th>{{ t('sys.menus.enabled') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id" class="menu-row">
            <td>{{ record.code }}</td>
            <td>{{ record.name }}</td>
            <td>{{ record.path }}</td>
            <td>{{ record.icon }}</td>
            <td>{{ record.sortOrder }}</td>
            <td>
              <el-tag :type="record.enabled ? 'success' : 'warning'">
                {{
                  record.enabled
                    ? t('sys.status.enabled')
                    : t('sys.status.disabled')
                }}
              </el-tag>
            </td>
            <td class="row-actions">
              <el-button
                v-if="admin"
                size="small"
                :disabled="busy"
                @click="edit(record)"
              >
                {{ t('sys.actions.edit') }}
              </el-button>
              <el-button
                v-if="admin"
                size="small"
                type="danger"
                :disabled="busy"
                @click="pendingDelete = record.id"
              >
                {{ t('sys.actions.delete') }}
              </el-button>
            </td>
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
      <div
        v-if="pendingDelete !== null"
        class="inline-dialog"
        role="dialog"
        :aria-label="t('sys.menus.deleteConfirmTitle')"
      >
        <p>{{ t('sys.menus.deleteConfirm', { count: 1 }) }}</p>
        <el-button type="danger" :disabled="busy" @click="remove">
          {{ t('sys.menus.confirmDelete') }}
        </el-button>
        <el-button :disabled="busy" @click="pendingDelete = null">
          {{ t('sys.menus.cancelDelete') }}
        </el-button>
      </div>
    </el-card>
  </div>
</template>
