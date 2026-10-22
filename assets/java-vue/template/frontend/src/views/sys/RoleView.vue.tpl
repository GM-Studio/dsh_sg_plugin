<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElButton,
  ElCard,
  ElCheckbox,
  ElInput,
  ElPagination,
  ElTag,
} from 'element-plus';
import { sysRoleApi } from '../../api/sys';
import { ApiError } from '../../api/request';
import type { SysRole, SysRoleQuery } from '../../api/sys';

const props = defineProps<{ user?: { username: string; role: string } }>();
const { t } = useI18n();
const admin = computed(() => props.user?.role === 'ADMIN');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const records = ref<SysRole[]>([]);
const total = ref(0);
const query = ref<SysRoleQuery>({
  page: 1,
  pageSize: 20,
  code: '',
  name: '',
});
const editId = ref<number | null>(null);
const code = ref('');
const name = ref('');
const description = ref('');
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
  const page = await sysRoleApi.list(query.value);
  records.value = page.records;
  total.value = page.total;
}
function reset() {
  editId.value = null;
  code.value = '';
  name.value = '';
  description.value = '';
  enabled.value = true;
}
function edit(role: SysRole) {
  editId.value = role.id;
  code.value = role.code;
  name.value = role.name;
  description.value = role.description;
  enabled.value = role.enabled;
}
async function save() {
  if (!code.value.trim() || !name.value.trim()) {
    error.value = t('sys.roles.validation');
    return;
  }
  await run(async () => {
    const body = {
      code: code.value.trim(),
      name: name.value.trim(),
      description: description.value.trim(),
      enabled: enabled.value,
    };
    const current = editId.value;
    if (current === null) await sysRoleApi.create(body);
    else await sysRoleApi.update({ ...body, id: current });
    reset();
    notice.value = t('sys.roles.created');
    await refresh();
  });
}
async function remove() {
  const id = pendingDelete.value;
  if (id === null) return;
  await run(async () => {
    await sysRoleApi.remove(id);
    pendingDelete.value = null;
    reset();
    notice.value = t('sys.roles.deleted');
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
  <div id="sys-roles">
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ t('sys.roles.eyebrow') }}</p>
        <h1>{{ t('sys.roles.title') }}</h1>
        <p>{{ t('sys.roles.description') }}</p>
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
          id="filter-code"
          v-model="query.code"
          :placeholder="t('sys.roles.code')"
          :aria-label="t('sys.roles.code')"
        />
        <el-input
          id="filter-name"
          v-model="query.name"
          :placeholder="t('sys.roles.name')"
          :aria-label="t('sys.roles.name')"
        />
        <el-button native-type="submit" :disabled="busy">
          {{ t('common.search') }}
        </el-button>
      </form>
    </el-card>
    <el-card v-if="admin" class="editor" shadow="never">
      <h2>
        {{ editId === null ? t('sys.roles.create') : t('sys.roles.edit') }}
      </h2>
      <form @submit.prevent="save">
        <div class="title-field">
          <label for="role-code">{{ t('sys.roles.code') }}</label>
          <el-input
            id="role-code"
            v-model="code"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="role-name">{{ t('sys.roles.name') }}</label>
          <el-input
            id="role-name"
            v-model="name"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="role-description">
            {{ t('sys.roles.descriptionField') }}
          </label>
          <el-input
            id="role-description"
            v-model="description"
            maxlength="255"
            :disabled="busy"
          />
        </div>
        <el-checkbox v-model="enabled" :disabled="busy">
          {{ t('sys.roles.enabled') }}
        </el-checkbox>
        <el-button type="primary" native-type="submit" :disabled="busy">
          {{ editId === null ? t('sys.roles.create') : t('sys.roles.save') }}
        </el-button>
        <el-button v-if="editId !== null" :disabled="busy" @click="reset">
          {{ t('common.cancel') }}
        </el-button>
      </form>
    </el-card>
    <el-card class="task-panel" shadow="never">
      <div class="panel-heading">
        <h2>
          {{ t('sys.roles.title') }}
          <el-tag effect="plain">
            {{ t('sys.roles.total', { count: total }) }}
          </el-tag>
        </h2>
      </div>
      <p v-if="!busy && !records.length" class="empty-state">
        {{ t('sys.roles.empty') }}
      </p>
      <table v-else class="role-table">
        <thead>
          <tr>
            <th>{{ t('sys.roles.code') }}</th>
            <th>{{ t('sys.roles.name') }}</th>
            <th>{{ t('sys.roles.descriptionField') }}</th>
            <th>{{ t('sys.roles.enabled') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="role in records" :key="role.id" class="role-row">
            <td>{{ role.code }}</td>
            <td>{{ role.name }}</td>
            <td>{{ role.description }}</td>
            <td>
              <el-tag :type="role.enabled ? 'success' : 'warning'">
                {{
                  role.enabled
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
                @click="edit(role)"
              >
                {{ t('sys.actions.edit') }}
              </el-button>
              <el-button
                v-if="admin"
                size="small"
                type="danger"
                :disabled="busy"
                @click="pendingDelete = role.id"
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
        :aria-label="t('sys.roles.deleteConfirmTitle')"
      >
        <p>{{ t('sys.roles.deleteConfirm', { count: 1 }) }}</p>
        <el-button type="danger" :disabled="busy" @click="remove">
          {{ t('sys.roles.confirmDelete') }}
        </el-button>
        <el-button :disabled="busy" @click="pendingDelete = null">
          {{ t('sys.roles.cancelDelete') }}
        </el-button>
      </div>
    </el-card>
  </div>
</template>
