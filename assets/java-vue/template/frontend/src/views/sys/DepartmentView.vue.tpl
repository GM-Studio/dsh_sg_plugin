<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElCard, ElInput, ElPagination, ElTag } from 'element-plus';
import { sysDepartmentApi } from '../../api/sys';
import { ApiError } from '../../api/request';
import type {
  SysDepartment,
  SysDepartmentQuery,
  SysOption,
} from '../../api/sys';

const props = defineProps<{ user?: { username: string; role: string } }>();
const { t } = useI18n();
const admin = computed(() => props.user?.role === 'ADMIN');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const records = ref<SysDepartment[]>([]);
const parents = ref<SysOption[]>([]);
const total = ref(0);
const query = ref<SysDepartmentQuery>({
  page: 1,
  pageSize: 20,
  code: '',
  name: '',
});
const editId = ref<number | null>(null);
const code = ref('');
const name = ref('');
const parentCode = ref('');
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
  const page = await sysDepartmentApi.list(query.value);
  records.value = page.records;
  total.value = page.total;
  parents.value = await sysDepartmentApi.options();
}
function reset() {
  editId.value = null;
  code.value = '';
  name.value = '';
  parentCode.value = '';
  enabled.value = true;
}
function edit(record: SysDepartment) {
  editId.value = record.id;
  code.value = record.code;
  name.value = record.name;
  parentCode.value = record.parentCode ?? '';
  enabled.value = record.enabled;
}
async function save() {
  if (!code.value.trim() || !name.value.trim()) {
    error.value = t('sys.departments.validation');
    return;
  }
  await run(async () => {
    const body = {
      code: code.value.trim(),
      name: name.value.trim(),
      parentCode: parentCode.value ? parentCode.value : null,
      enabled: enabled.value,
    };
    const current = editId.value;
    if (current === null) await sysDepartmentApi.create(body);
    else await sysDepartmentApi.update({ ...body, id: current });
    reset();
    notice.value = t('sys.departments.created');
    await refresh();
  });
}
async function remove() {
  const id = pendingDelete.value;
  if (id === null) return;
  await run(async () => {
    await sysDepartmentApi.remove(id);
    pendingDelete.value = null;
    reset();
    notice.value = t('sys.departments.deleted');
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
  <div id="sys-departments">
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ t('sys.departments.eyebrow') }}</p>
        <h1>{{ t('sys.departments.title') }}</h1>
        <p>{{ t('sys.departments.description') }}</p>
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
          id="filter-dept-code"
          v-model="query.code"
          :placeholder="t('sys.departments.filterCode')"
          :aria-label="t('sys.departments.filterCode')"
        />
        <el-input
          id="filter-dept-name"
          v-model="query.name"
          :placeholder="t('sys.departments.filterName')"
          :aria-label="t('sys.departments.filterName')"
        />
        <el-button native-type="submit" :disabled="busy">
          {{ t('common.search') }}
        </el-button>
      </form>
    </el-card>
    <el-card v-if="admin" class="editor" shadow="never">
      <h2>
        {{
          editId === null
            ? t('sys.departments.create')
            : t('sys.departments.edit')
        }}
      </h2>
      <form @submit.prevent="save">
        <div class="title-field">
          <label for="dept-code">{{ t('sys.departments.code') }}</label>
          <el-input
            id="dept-code"
            v-model="code"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="dept-name">{{ t('sys.departments.name') }}</label>
          <el-input
            id="dept-name"
            v-model="name"
            maxlength="64"
            :disabled="busy"
          />
        </div>
        <div class="title-field">
          <label for="dept-parent">{{ t('sys.departments.parent') }}</label>
          <select
            id="dept-parent"
            v-model="parentCode"
            :disabled="busy"
            :aria-label="t('sys.departments.parent')"
          >
            <option value="">{{ t('sys.departments.parentNone') }}</option>
            <option
              v-for="parent in parents"
              :key="parent.value"
              :value="parent.value"
            >
              {{ parent.label }}
            </option>
          </select>
        </div>
        <label class="checkbox-field" for="dept-enabled">
          <input
            id="dept-enabled"
            v-model="enabled"
            type="checkbox"
            :disabled="busy"
          />
          {{ t('sys.departments.enabled') }}
        </label>
        <el-button type="primary" native-type="submit" :disabled="busy">
          {{
            editId === null
              ? t('sys.departments.create')
              : t('sys.departments.save')
          }}
        </el-button>
        <el-button v-if="editId !== null" :disabled="busy" @click="reset">
          {{ t('common.cancel') }}
        </el-button>
      </form>
    </el-card>
    <el-card class="task-panel" shadow="never">
      <div class="panel-heading">
        <h2>
          {{ t('sys.departments.title') }}
          <el-tag effect="plain">
            {{ t('sys.departments.total', { count: total }) }}
          </el-tag>
        </h2>
      </div>
      <p v-if="!busy && !records.length" class="empty-state">
        {{ t('sys.departments.empty') }}
      </p>
      <table v-else class="department-table">
        <thead>
          <tr>
            <th>{{ t('sys.departments.code') }}</th>
            <th>{{ t('sys.departments.name') }}</th>
            <th>{{ t('sys.departments.parent') }}</th>
            <th>{{ t('sys.departments.enabled') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id" class="department-row">
            <td>{{ record.code }}</td>
            <td>{{ record.name }}</td>
            <td>{{ record.parentCode || t('sys.departments.parentNone') }}</td>
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
        :aria-label="t('sys.departments.deleteConfirmTitle')"
      >
        <p>{{ t('sys.departments.deleteConfirm', { count: 1 }) }}</p>
        <el-button type="danger" :disabled="busy" @click="remove">
          {{ t('sys.departments.confirmDelete') }}
        </el-button>
        <el-button :disabled="busy" @click="pendingDelete = null">
          {{ t('sys.departments.cancelDelete') }}
        </el-button>
      </div>
    </el-card>
  </div>
</template>
