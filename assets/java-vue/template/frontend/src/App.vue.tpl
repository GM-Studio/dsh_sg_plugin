<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElButton,
  ElCard,
  ElCheckbox,
  ElInput,
  ElTag,
  ElPagination,
} from 'element-plus';
import { authApi } from './api/auth';
import { fileApi } from './api/files';
import { taskApi } from './api/tasks';
import { ApiError } from './api/request';
import type {
  ImportResult,
  StoredFile,
  Task,
  TaskQuery,
  User,
} from './api/types';
import { setLocale, type AppLocale } from './i18n';

const { t, locale } = useI18n();
const user = ref<User | null>(null);
const admin = computed(() => user.value?.role === 'ADMIN');
const username = ref('admin');
const password = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const records = ref<Task[]>([]);
const total = ref(0);
const files = ref<StoredFile[]>([]);
const selected = ref<number[]>([]);
const query = ref<TaskQuery>({
  page: 1,
  pageSize: 20,
  title: '',
  completed: '',
  sortBy: 'id',
  sortOrder: 'asc',
});
const editId = ref<number | null>(null);
const title = ref('');
const completed = ref(false);
const detail = ref<Task | null>(null);
const csvFile = ref<File | null>(null);
const importResult = ref<ImportResult | null>(null);
const pendingDelete = ref<number[] | null>(null);

function expired() {
  user.value = null;
  records.value = [];
  files.value = [];
  selected.value = [];
}
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
  const page = await taskApi.list(query.value);
  records.value = page.records;
  total.value = page.total;
  selected.value = [];
  files.value = await fileApi.list();
}
async function login() {
  await run(async () => {
    user.value = await authApi.login(username.value, password.value);
    password.value = '';
    await refresh();
  });
}
async function logout() {
  await run(async () => {
    await authApi.logout();
    expired();
  });
}
function reset() {
  editId.value = null;
  title.value = '';
  completed.value = false;
}
function toggleLocale() {
  const next: AppLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
  setLocale(next);
}
function edit(task: Task) {
  editId.value = task.id;
  title.value = task.title;
  completed.value = task.completed;
}
async function save() {
  if (!title.value.trim() || title.value.length > 200) {
    error.value = t('task.validation');
    return;
  }
  await run(async () => {
    const body = { title: title.value.trim(), completed: completed.value };
    if (editId.value === null) await taskApi.create(body);
    else await taskApi.update(editId.value, body);
    reset();
    await refresh();
  });
}
async function showDetail(id: number) {
  await run(async () => {
    detail.value = await taskApi.get(id);
  });
}
async function remove() {
  const ids = pendingDelete.value;
  if (!ids) return;
  await run(async () => {
    if (ids.length === 1) await taskApi.remove(ids[0]);
    else await taskApi.batchDelete(ids);
    pendingDelete.value = null;
    reset();
    await refresh();
  });
}
async function batchStatus(value: boolean) {
  await run(async () => {
    await taskApi.batchStatus(selected.value, value);
    await refresh();
  });
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
    importResult.value = await taskApi.import(csvFile.value!, validate);
    if (!validate) {
      notice.value = t('csv.imported', { count: importResult.value.count });
      csvFile.value = null;
      await refresh();
    }
  });
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await run(async () => {
    await fileApi.upload(file);
    files.value = await fileApi.list();
    notice.value = t('file.uploaded');
  });
  input.value = '';
}
async function pageChanged(page: number) {
  query.value.page = page;
  await run(refresh);
}
async function search() {
  query.value.page = 1;
  await run(refresh);
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
    await refresh();
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
  <div v-else class="admin-shell">
    <aside class="sidebar" :aria-label="t('navigation.ariaLabel')">
      <a class="brand" href="#tasks">
        <b class="brand-mark">S</b>
        {{ t('common.appName') }}
      </a>
      <p class="nav-label">{{ t('navigation.workspace') }}</p>
      <a class="nav-link active" href="#tasks">▦ {{ t('navigation.tasks') }}</a>
      <a class="nav-link" href="#files">↥ {{ t('navigation.files') }}</a>
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
          <el-tag>{{ user.username }} · {{ user.role }}</el-tag>
          <el-button :disabled="busy" @click="toggleLocale">
            {{ t('language.switch') }}
          </el-button>
          <el-button :disabled="busy" @click="logout">
            {{ t('navigation.logout') }}
          </el-button>
        </div>
      </header>
      <main id="tasks">
        <div class="page-heading">
          <div>
            <p class="eyebrow">{{ t('task.eyebrow') }}</p>
            <h1>{{ t('task.title') }}</h1>
            <p>{{ t('task.description') }}</p>
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
              id="filter-title"
              v-model="query.title"
              :placeholder="t('task.filterTitle')"
              :aria-label="t('task.filterTitle')"
            />
            <select
              v-model="query.completed"
              :aria-label="t('task.completionFilter')"
            >
              <option value="">{{ t('task.filterAll') }}</option>
              <option value="true">{{ t('task.filterCompleted') }}</option>
              <option value="false">{{ t('task.filterPending') }}</option>
            </select>
            <select v-model="query.sortBy" :aria-label="t('task.sortField')">
              <option value="id">{{ t('task.createdAt') }}</option>
              <option value="title">{{ t('task.titleField') }}</option>
              <option value="completed">{{ t('task.status') }}</option>
            </select>
            <select
              v-model="query.sortOrder"
              :aria-label="t('task.sortDirection')"
            >
              <option value="asc">{{ t('task.ascending') }}</option>
              <option value="desc">{{ t('task.descending') }}</option>
            </select>
            <el-button native-type="submit" :disabled="busy">
              {{ t('common.search') }}
            </el-button>
            <el-button
              :disabled="busy"
              @click="run(async () => taskApi.export(query))"
            >
              {{ t('task.export') }}
            </el-button>
          </form>
        </el-card>
        <el-card v-if="admin" class="editor" shadow="never">
          <h2>{{ editId === null ? t('task.create') : t('task.edit') }}</h2>
          <form @submit.prevent="save">
            <div class="title-field">
              <label for="title">{{ t('task.taskTitle') }}</label>
              <el-input
                id="title"
                v-model="title"
                maxlength="200"
                :disabled="busy"
              />
            </div>
            <el-checkbox v-model="completed" :disabled="busy">
              {{ t('task.completed') }}
            </el-checkbox>
            <el-button type="primary" native-type="submit" :disabled="busy">
              {{ editId === null ? t('task.add') : t('task.save') }}
            </el-button>
            <el-button v-if="editId !== null" :disabled="busy" @click="reset">
              {{ t('common.cancel') }}
            </el-button>
          </form>
        </el-card>
        <el-card class="task-panel" shadow="never">
          <div class="panel-heading">
            <h2>
              {{ t('task.listTitle') }}
              <el-tag effect="plain">
                {{ t('task.total', { count: total }) }}
              </el-tag>
            </h2>
            <div v-if="admin" class="toolbar">
              <el-button
                :disabled="busy || !selected.length"
                @click="batchStatus(true)"
              >
                {{ t('task.completeSelected') }}
              </el-button>
              <el-button
                :disabled="busy || !selected.length"
                @click="batchStatus(false)"
              >
                {{ t('task.reopenSelected') }}
              </el-button>
              <el-button
                type="danger"
                :disabled="busy || !selected.length"
                @click="pendingDelete = [...selected]"
              >
                {{ t('task.deleteSelected') }}
              </el-button>
            </div>
          </div>
          <p v-if="!busy && !records.length" class="empty-state">
            {{ t('task.empty') }}
          </p>
          <ul class="task-list" :aria-busy="busy">
            <li v-for="task in records" :key="task.id">
              <input
                v-if="admin"
                v-model="selected"
                type="checkbox"
                :value="task.id"
                :disabled="busy"
                :aria-label="t('task.select', { title: task.title })"
              />
              <span class="task-title" :class="{ done: task.completed }">
                {{ task.title }}
              </span>
              <el-tag :type="task.completed ? 'success' : 'warning'">
                {{
                  task.completed
                    ? t('task.completedStatus')
                    : t('task.pendingStatus')
                }}
              </el-tag>
              <div class="task-actions">
                <el-button
                  size="small"
                  :disabled="busy"
                  @click="showDetail(task.id)"
                >
                  {{ t('task.details') }}
                </el-button>
                <el-button
                  v-if="admin"
                  size="small"
                  :disabled="busy"
                  @click="edit(task)"
                >
                  {{ t('task.editAction') }}
                </el-button>
                <el-button
                  v-if="admin"
                  size="small"
                  type="danger"
                  :disabled="busy"
                  @click="pendingDelete = [task.id]"
                >
                  {{ t('task.delete') }}
                </el-button>
              </div>
            </li>
          </ul>
          <el-pagination
            :current-page="query.page"
            :page-size="query.pageSize"
            :total="total"
            layout="prev, pager, next"
            :disabled="busy"
            @current-change="pageChanged"
          />
          <div
            v-if="detail"
            class="inline-dialog"
            role="dialog"
            :aria-label="t('task.detailsTitle')"
          >
            <h3>Task #{{ detail.id }}</h3>
            <p>
              {{ detail.title }} ·
              {{
                detail.completed
                  ? t('task.completedStatus')
                  : t('task.pendingStatus')
              }}
            </p>
            <el-button @click="detail = null">
              {{ t('task.closeDetails') }}
            </el-button>
          </div>
          <div
            v-if="pendingDelete"
            class="inline-dialog"
            role="dialog"
            :aria-label="t('task.deleteConfirmTitle')"
          >
            <p>
              {{ t('task.deleteConfirm', { count: pendingDelete.length }) }}
            </p>
            <el-button type="danger" :disabled="busy" @click="remove">
              {{ t('task.confirmDelete') }}
            </el-button>
            <el-button :disabled="busy" @click="pendingDelete = null">
              {{ t('task.cancelDelete') }}
            </el-button>
          </div>
        </el-card>
        <el-card v-if="admin" shadow="never" class="transfer-panel">
          <h2>{{ t('csv.title') }}</h2>
          <p>{{ t('csv.description') }}</p>
          <div class="toolbar">
            <el-button :disabled="busy" @click="run(taskApi.template)">
              {{ t('csv.template') }}
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
        <el-card id="files" shadow="never" class="transfer-panel">
          <h2>{{ t('file.title') }}</h2>
          <p>{{ t('file.description') }}</p>
          <input
            v-if="admin"
            id="upload-file"
            type="file"
            accept=".csv,.txt,.png,.jpg,.jpeg,.pdf"
            :disabled="busy"
            :aria-label="t('file.upload')"
            @change="upload"
          />
          <p v-if="!files.length">{{ t('file.empty') }}</p>
          <ul class="file-list">
            <li v-for="file in files" :key="file.fileId">
              <span>
                {{ file.name }}
                <small>{{ file.size }} bytes</small>
              </span>
              <el-button
                :disabled="busy"
                @click="run(async () => fileApi.download(file))"
              >
                {{ t('file.download') }}
              </el-button>
            </li>
          </ul>
          <small>{{ t('file.limit') }}</small>
        </el-card>
        <footer>
          {{ t('footer.product') }}
          <span>{{ t('footer.stack') }}</span>
        </footer>
      </main>
    </div>
  </div>
</template>
