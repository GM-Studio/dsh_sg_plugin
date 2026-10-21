<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElButton, ElCard, ElCheckbox, ElInput, ElTag } from 'element-plus';
import { taskApi } from './api';
import type { Task } from './api';

const tasks = ref<Task[]>([]);
const doneCount = computed(
  () => tasks.value.filter((task) => task.completed).length,
);
const title = ref('');
const editId = ref<number | null>(null);
const completed = ref(false);
const busy = ref(false);
const error = ref('');

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unexpected error';
  } finally {
    busy.value = false;
  }
}
function reset() {
  title.value = '';
  completed.value = false;
  editId.value = null;
}
async function load() {
  await run(async () => {
    tasks.value = await taskApi.list();
  });
}
async function save() {
  if (!title.value.trim() || title.value.length > 200) {
    error.value = 'Enter a title between 1 and 200 characters.';
    return;
  }
  await run(async () => {
    const input = { title: title.value.trim(), completed: completed.value };
    if (editId.value === null) {
      tasks.value.push(await taskApi.create(input));
    } else {
      const updated = await taskApi.update(editId.value, input);
      tasks.value = tasks.value.map((task) =>
        task.id === updated.id ? updated : task,
      );
    }
    reset();
  });
}
function edit(task: Task) {
  editId.value = task.id;
  title.value = task.title;
  completed.value = task.completed;
}
async function toggle(task: Task) {
  await run(async () => {
    const updated = await taskApi.update(task.id, {
      title: task.title,
      completed: !task.completed,
    });
    tasks.value = tasks.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    if (editId.value === updated.id) completed.value = updated.completed;
  });
}
async function remove(task: Task) {
  await run(async () => {
    await taskApi.remove(task.id);
    tasks.value = tasks.value.filter((item) => item.id !== task.id);
    if (editId.value === task.id) reset();
  });
}
onMounted(load);
</script>

<template>
  <div class="admin-shell">
    <aside class="sidebar" aria-label="Workspace navigation">
      <a class="brand" href="#tasks">
        <b class="brand-mark">S</b>
        SpecGate
      </a>
      <p class="nav-label">WORKSPACE</p>
      <a class="nav-link active" href="#tasks" aria-current="page">
        ▦ &nbsp; Task manager
      </a>
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
        <el-tag effect="plain">Local workspace</el-tag>
      </header>
      <main id="tasks">
        <div class="page-heading">
          <div>
            <p class="eyebrow">YOUR DAILY OVERVIEW</p>
            <h1>Task manager</h1>
            <p>Keep your next steps organized and your progress in sight.</p>
          </div>
          <el-button :disabled="busy" @click="load">Refresh</el-button>
        </div>
        <section class="stats" aria-label="Task overview">
          <el-card shadow="never">
            <span>Total tasks</span>
            <strong>{{ tasks.length }}</strong>
            <small>Everything in your workspace</small>
          </el-card>
          <el-card shadow="never">
            <span>In progress</span>
            <strong>{{ tasks.length - doneCount }}</strong>
            <small>Ready for your attention</small>
          </el-card>
          <el-card shadow="never">
            <span>Completed</span>
            <strong class="success">{{ doneCount }}</strong>
            <small>One step closer to done</small>
          </el-card>
        </section>
        <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
        <el-card class="editor" shadow="never">
          <h2>{{ editId === null ? 'Create a task' : 'Edit task' }}</h2>
          <form @submit.prevent="save">
            <div class="title-field">
              <label for="title">Task title</label>
              <el-input
                id="title"
                v-model="title"
                placeholder="What needs to get done?"
                required
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
            <h2>Your tasks</h2>
            <el-tag type="info" effect="plain">{{ tasks.length }} total</el-tag>
          </div>
          <p v-if="busy" role="status">Saving or loading…</p>
          <div v-if="!busy && !tasks.length" class="empty-state">
            <div class="empty-symbol">✓</div>
            <h3>A fresh start</h3>
            <p>No tasks yet. Add your first task above.</p>
          </div>
          <ul class="task-list" :aria-busy="busy">
            <li v-for="task in tasks" :key="task.id">
              <span class="task-title" :class="{ done: task.completed }">
                {{ task.title }}
              </span>
              <el-tag
                :type="task.completed ? 'success' : 'warning'"
                effect="light"
              >
                {{ task.completed ? 'Completed' : 'In progress' }}
              </el-tag>
              <div class="task-actions">
                <el-button size="small" :disabled="busy" @click="toggle(task)">
                  {{ task.completed ? 'Reopen' : 'Complete' }}
                </el-button>
                <el-button size="small" :disabled="busy" @click="edit(task)">
                  Edit
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :disabled="busy"
                  @click="remove(task)"
                >
                  Delete
                </el-button>
              </div>
            </li>
          </ul>
        </el-card>
        <footer>
          SpecGate Workspace
          <span>Vue 3 · Element Plus</span>
        </footer>
      </main>
    </div>
  </div>
</template>
