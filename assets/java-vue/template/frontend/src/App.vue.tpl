<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
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
    error.value = cause instanceof Error ? cause.message : 'Unexpected error';
    if (cause instanceof ApiError && cause.traceId)
      error.value += ` (trace: ${cause.traceId})`;
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
function edit(task: Task) {
  editId.value = task.id;
  title.value = task.title;
  completed.value = task.completed;
}
async function save() {
  if (!title.value.trim() || title.value.length > 200) {
    error.value = 'Enter 1–200 characters.';
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
    error.value = 'Choose a CSV file first.';
    return;
  }
  await run(async () => {
    importResult.value = await taskApi.import(csvFile.value!, validate);
    if (!validate) {
      notice.value = `Imported ${importResult.value.count} tasks`;
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
    notice.value = 'File uploaded';
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
      <p class="eyebrow">SPECGATE WORKSPACE</p>
      <h1>Welcome back</h1>
      <p>Sign in to manage your tasks and files.</p>
      <form @submit.prevent="login">
        <label for="username">Username</label>
        <el-input
          id="username"
          v-model="username"
          autocomplete="username"
          :disabled="busy"
        />
        <label for="password">Password</label>
        <el-input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
        />
        <el-button type="primary" native-type="submit" :disabled="busy">
          Sign in
        </el-button>
      </form>
      <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
    </el-card>
  </div>
  <div v-else class="admin-shell">
    <aside class="sidebar" aria-label="Workspace navigation">
      <a class="brand" href="#tasks">
        <b class="brand-mark">S</b>
        SpecGate
      </a>
      <p class="nav-label">WORKSPACE</p>
      <a class="nav-link active" href="#tasks">▦ Task manager</a>
      <a class="nav-link" href="#files">↥ Files</a>
      <div class="sidebar-note">
        A little structure.
        <br />
        A lot more clarity.
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <span>
          Workspace /
          <strong>Tasks</strong>
        </span>
        <div>
          <el-tag>{{ user.username }} · {{ user.role }}</el-tag>
          <el-button :disabled="busy" @click="logout">Sign out</el-button>
        </div>
      </header>
      <main id="tasks">
        <div class="page-heading">
          <div>
            <p class="eyebrow">YOUR DAILY OVERVIEW</p>
            <h1>Task manager</h1>
            <p>Organize work, share files and keep your next steps in sight.</p>
          </div>
          <el-button :disabled="busy" @click="run(refresh)">Refresh</el-button>
        </div>
        <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="busy" role="status">Working…</p>
        <el-card shadow="never" class="filter-panel">
          <form class="toolbar" @submit.prevent="search">
            <el-input
              id="filter-title"
              v-model="query.title"
              placeholder="Filter by title"
              aria-label="Filter by title"
            />
            <select v-model="query.completed" aria-label="Completion filter">
              <option value="">All states</option>
              <option value="true">Completed</option>
              <option value="false">In progress</option>
            </select>
            <select v-model="query.sortBy" aria-label="Sort field">
              <option value="id">Created</option>
              <option value="title">Title</option>
              <option value="completed">Status</option>
            </select>
            <select v-model="query.sortOrder" aria-label="Sort direction">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <el-button native-type="submit" :disabled="busy">Search</el-button>
            <el-button
              :disabled="busy"
              @click="run(async () => taskApi.export(query))"
            >
              Export CSV
            </el-button>
          </form>
        </el-card>
        <el-card v-if="admin" class="editor" shadow="never">
          <h2>{{ editId === null ? 'Create a task' : 'Edit task' }}</h2>
          <form @submit.prevent="save">
            <div class="title-field">
              <label for="title">Task title</label>
              <el-input
                id="title"
                v-model="title"
                maxlength="200"
                :disabled="busy"
              />
            </div>
            <el-checkbox v-model="completed" :disabled="busy">
              Completed
            </el-checkbox>
            <el-button type="primary" native-type="submit" :disabled="busy">
              {{ editId === null ? 'Add task' : 'Save changes' }}
            </el-button>
            <el-button v-if="editId !== null" :disabled="busy" @click="reset">
              Cancel
            </el-button>
          </form>
        </el-card>
        <el-card class="task-panel" shadow="never">
          <div class="panel-heading">
            <h2>
              Your tasks
              <el-tag effect="plain">{{ total }} total</el-tag>
            </h2>
            <div v-if="admin" class="toolbar">
              <el-button
                :disabled="busy || !selected.length"
                @click="batchStatus(true)"
              >
                Complete selected
              </el-button>
              <el-button
                :disabled="busy || !selected.length"
                @click="batchStatus(false)"
              >
                Reopen selected
              </el-button>
              <el-button
                type="danger"
                :disabled="busy || !selected.length"
                @click="pendingDelete = [...selected]"
              >
                Delete selected
              </el-button>
            </div>
          </div>
          <p v-if="!busy && !records.length" class="empty-state">
            No tasks match your filters.
          </p>
          <ul class="task-list" :aria-busy="busy">
            <li v-for="task in records" :key="task.id">
              <input
                v-if="admin"
                v-model="selected"
                type="checkbox"
                :value="task.id"
                :disabled="busy"
                :aria-label="`Select ${task.title}`"
              />
              <span class="task-title" :class="{ done: task.completed }">
                {{ task.title }}
              </span>
              <el-tag :type="task.completed ? 'success' : 'warning'">
                {{ task.completed ? 'Completed' : 'In progress' }}
              </el-tag>
              <div class="task-actions">
                <el-button
                  size="small"
                  :disabled="busy"
                  @click="showDetail(task.id)"
                >
                  Details
                </el-button>
                <el-button
                  v-if="admin"
                  size="small"
                  :disabled="busy"
                  @click="edit(task)"
                >
                  Edit
                </el-button>
                <el-button
                  v-if="admin"
                  size="small"
                  type="danger"
                  :disabled="busy"
                  @click="pendingDelete = [task.id]"
                >
                  Delete
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
            aria-label="Task details"
          >
            <h3>Task #{{ detail.id }}</h3>
            <p>
              {{ detail.title }} ·
              {{ detail.completed ? 'Completed' : 'In progress' }}
            </p>
            <el-button @click="detail = null">Close details</el-button>
          </div>
          <div
            v-if="pendingDelete"
            class="inline-dialog"
            role="dialog"
            aria-label="Confirm deletion"
          >
            <p>Delete {{ pendingDelete.length }} task(s)?</p>
            <el-button type="danger" :disabled="busy" @click="remove">
              Confirm delete
            </el-button>
            <el-button :disabled="busy" @click="pendingDelete = null">
              Cancel deletion
            </el-button>
          </div>
        </el-card>
        <el-card v-if="admin" shadow="never" class="transfer-panel">
          <h2>Import tasks</h2>
          <p>
            UTF-8 CSV · up to 1000 rows / 2 MiB · all rows validated before
            saving
          </p>
          <div class="toolbar">
            <el-button :disabled="busy" @click="run(taskApi.template)">
              CSV template
            </el-button>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              :disabled="busy"
              aria-label="Choose CSV"
              @change="chooseCsv"
            />
            <el-button :disabled="busy" @click="importCsv(true)">
              Validate CSV
            </el-button>
            <el-button
              type="primary"
              :disabled="busy || !importResult?.valid || !csvFile"
              @click="importCsv(false)"
            >
              Confirm import
            </el-button>
          </div>
          <div v-if="importResult">
            <p>{{ importResult.count }} valid rows</p>
            <ul>
              <li v-for="message in importResult.errors" :key="message">
                {{ message }}
              </li>
            </ul>
          </div>
        </el-card>
        <el-card id="files" shadow="never" class="transfer-panel">
          <h2>Workspace files</h2>
          <p>CSV, TXT, PNG, JPEG or PDF · up to 10 MiB per file</p>
          <input
            v-if="admin"
            id="upload-file"
            type="file"
            accept=".csv,.txt,.png,.jpg,.jpeg,.pdf"
            :disabled="busy"
            aria-label="Upload file"
            @change="upload"
          />
          <p v-if="!files.length">No files yet.</p>
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
                Download
              </el-button>
            </li>
          </ul>
          <small>Showing at most 100 files.</small>
        </el-card>
        <footer>
          SpecGate Workspace
          <span>Vue 3 · Element Plus</span>
        </footer>
      </main>
    </div>
  </div>
</template>
