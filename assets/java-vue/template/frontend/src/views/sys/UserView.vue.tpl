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
import { sysRoleApi, sysUserApi } from '../../api/sys';
import { ApiError } from '../../api/request';
import type { SysOption, SysUser, SysUserQuery } from '../../api/sys';
import type { ImportResult } from '../../api/types';

const props = defineProps<{ user?: { username: string; role: string } }>();
const { t } = useI18n();
const admin = computed(() => props.user?.role === 'ADMIN');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const records = ref<SysUser[]>([]);
const roles = ref<SysOption[]>([]);
const selected = ref<number[]>([]);
const total = ref(0);
const query = ref<SysUserQuery>({
  page: 1,
  pageSize: 20,
  username: '',
  roleCode: '',
  enabled: '',
});
const editId = ref<number | null>(null);
const username = ref('');
const displayName = ref('');
const roleCode = ref('');
const enabled = ref(true);
const pendingDelete = ref<number[] | null>(null);
const csvFile = ref<File | null>(null);
const importResult = ref<ImportResult | null>(null);

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
  const page = await sysUserApi.list(query.value);
  records.value = page.records;
  total.value = page.total;
  selected.value = [];
  roles.value = await sysRoleApi.options();
}
function reset() {
  editId.value = null;
  username.value = '';
  displayName.value = '';
  roleCode.value = '';
  enabled.value = true;
}
function edit(record: SysUser) {
  editId.value = record.id;
  username.value = record.username;
  displayName.value = record.displayName;
  roleCode.value = record.roleCode;
  enabled.value = record.enabled;
}
async function save() {
  if (!username.value.trim() || !displayName.value.trim() || !roleCode.value) {
    error.value = t('sys.users.validation');
    return;
  }
  await run(async () => {
    const body = {
      username: username.value.trim(),
      displayName: displayName.value.trim(),
      roleCode: roleCode.value,
      enabled: enabled.value,
    };
    const current = editId.value;
    if (current === null) await sysUserApi.create(body);
    else await sysUserApi.update({ ...body, id: current });
    reset();
    notice.value = t('sys.users.created');
    await refresh();
  });
}
async function remove() {
  const ids = pendingDelete.value;
  if (!ids) return;
  await run(async () => {
    if (ids.length === 1) await sysUserApi.remove(ids[0]);
    else await sysUserApi.batchDelete(ids);
    pendingDelete.value = null;
    reset();
    notice.value = t('sys.users.deleted');
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
function chooseCsv(event: Event) {
  csvFile.value = (event.target as HTMLInputElement).files?.[0] || null;
  importResult.value = null;
}
async function importCsv(validate: boolean) {
  if (!csvFile.value) {
    error.value = t('csv.chooseFirst');
    return;
  }
  await run(async () => {
    importResult.value = await sysUserApi.import(csvFile.value!, validate);
    if (!validate) {
      notice.value = t('csv.imported', { count: importResult.value.count });
      csvFile.value = null;
      await refresh();
    }
  });
}
onMounted(() => run(refresh));
</script>

<template>
  <div id="sys-users">
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ t('sys.users.eyebrow') }}</p>
        <h1>{{ t('sys.users.title') }}</h1>
        <p>{{ t('sys.users.description') }}</p>
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
          id="filter-username"
          v-model="query.username"
          :placeholder="t('sys.users.filterUsername')"
          :aria-label="t('sys.users.filterUsername')"
        />
        <select
          id="filter-role"
          v-model="query.roleCode"
          :aria-label="t('sys.users.filterRole')"
        >
          <option value="">{{ t('sys.users.filterRole') }}</option>
          <option v-for="role in roles" :key="role.value" :value="role.value">
            {{ role.label }}
          </option>
        </select>
        <select
          id="filter-enabled"
          v-model="query.enabled"
          :aria-label="t('sys.users.filterEnabled')"
        >
          <option value="">{{ t('sys.users.filterEnabled') }}</option>
          <option value="true">{{ t('sys.status.enabled') }}</option>
          <option value="false">{{ t('sys.status.disabled') }}</option>
        </select>
        <el-button native-type="submit" :disabled="busy">
          {{ t('common.search') }}
        </el-button>
      </form>
    </el-card>
    <el-card v-if="admin" class="editor" shadow="never">
      <h2>
        {{ editId === null ? t('sys.users.create') : t('sys.users.edit') }}
      </h2>
      <form @submit.prevent="save">
        <div class="title-field">
          <label for="user-username">{{ t('sys.users.username') }}</label>
          <el-input
            id="user-username"
            v-model="username"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="user-display-name">
            {{ t('sys.users.displayName') }}
          </label>
          <el-input
            id="user-display-name"
            v-model="displayName"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="user-role">{{ t('sys.users.role') }}</label>
          <select
            id="user-role"
            v-model="roleCode"
            :disabled="busy"
            :aria-label="t('sys.users.roleOptions')"
          >
            <option value="" disabled>{{ t('sys.users.role') }}</option>
            <option v-for="role in roles" :key="role.value" :value="role.value">
              {{ role.label }}
            </option>
          </select>
        </div>
        <el-checkbox v-model="enabled" :disabled="busy">
          {{ t('sys.users.enabled') }}
        </el-checkbox>
        <el-button type="primary" native-type="submit" :disabled="busy">
          {{ editId === null ? t('sys.users.create') : t('sys.users.save') }}
        </el-button>
        <el-button v-if="editId !== null" :disabled="busy" @click="reset">
          {{ t('common.cancel') }}
        </el-button>
      </form>
    </el-card>
    <el-card class="task-panel" shadow="never">
      <div class="panel-heading">
        <h2>
          {{ t('sys.users.title') }}
          <el-tag effect="plain">
            {{ t('sys.users.total', { count: total }) }}
          </el-tag>
        </h2>
        <div v-if="admin" class="toolbar">
          <el-button
            type="danger"
            :disabled="busy || !selected.length"
            @click="pendingDelete = [...selected]"
          >
            {{ t('sys.users.deleteSelected') }}
          </el-button>
        </div>
      </div>
      <p v-if="!busy && !records.length" class="empty-state">
        {{ t('sys.users.empty') }}
      </p>
      <table v-else class="user-table">
        <thead>
          <tr>
            <th></th>
            <th>{{ t('sys.users.username') }}</th>
            <th>{{ t('sys.users.displayName') }}</th>
            <th>{{ t('sys.users.role') }}</th>
            <th>{{ t('sys.users.enabled') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id" class="user-row">
            <td>
              <input
                v-model="selected"
                type="checkbox"
                :value="record.id"
                :disabled="busy || !admin"
                :aria-label="record.username"
              />
            </td>
            <td>{{ record.username }}</td>
            <td>{{ record.displayName }}</td>
            <td>{{ record.roleCode }}</td>
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
                @click="pendingDelete = [record.id]"
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
        v-if="pendingDelete"
        class="inline-dialog"
        role="dialog"
        :aria-label="t('sys.users.deleteConfirmTitle')"
      >
        <p>
          {{ t('sys.users.deleteConfirm', { count: pendingDelete.length }) }}
        </p>
        <el-button type="danger" :disabled="busy" @click="remove">
          {{ t('sys.users.confirmDelete') }}
        </el-button>
        <el-button :disabled="busy" @click="pendingDelete = null">
          {{ t('sys.users.cancelDelete') }}
        </el-button>
      </div>
    </el-card>
    <el-card v-if="admin" shadow="never" class="transfer-panel">
      <h2>{{ t('csv.title') }}</h2>
      <p>{{ t('csv.description') }}</p>
      <div class="toolbar">
        <el-button :disabled="busy" @click="run(sysUserApi.template)">
          {{ t('csv.template') }}
        </el-button>
        <el-button
          :disabled="busy"
          @click="run(async () => sysUserApi.export(query))"
        >
          {{ t('csv.export') }}
        </el-button>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          :disabled="busy"
          :aria-label="t('csv.choose')"
          @change="chooseCsv"
        />
        <el-button :disabled="busy" @click="importCsv(true)">
          {{ t('csv.validate') }}
        </el-button>
        <el-button
          type="primary"
          :disabled="busy || !importResult?.valid || !csvFile"
          @click="importCsv(false)"
        >
          {{ t('csv.confirm') }}
        </el-button>
      </div>
      <div v-if="importResult">
        <p>{{ t('csv.validRows', { count: importResult.count }) }}</p>
        <ul>
          <li v-for="message in importResult.errors" :key="message">
            {{ message }}
          </li>
        </ul>
      </div>
    </el-card>
  </div>
</template>
