<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElCard, ElButton, ElInput } from 'element-plus';
import { noteApi } from '../api/notes';
import type { Note } from '../api/notes';

defineProps<{ admin: boolean }>();
const notes = ref<Note[]>([]);
const title = ref('');
const editing = ref<number | null>(null);
const pending = ref<number | null>(null);
const error = ref('');
const busy = ref(false);
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Request failed';
  } finally {
    busy.value = false;
  }
}
async function load() {
  notes.value = (await noteApi.list()).records;
}
async function save() {
  if (!title.value.trim()) {
    error.value = 'Enter a note title';
    return;
  }
  await run(async () => {
    const input = { title: title.value.trim(), completed: false };
    if (editing.value === null) await noteApi.create(input);
    else await noteApi.update(editing.value, input);
    editing.value = null;
    title.value = '';
    await load();
  });
}
async function remove() {
  await run(async () => {
    await noteApi.remove(pending.value!);
    pending.value = null;
    await load();
  });
}
onMounted(() => run(load));
</script>
<template>
  <el-card shadow="never" class="transfer-panel">
    <h2>Notes</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <form
      v-if="admin"
      aria-label="Note form"
      class="toolbar"
      @submit.prevent="save"
    >
      <el-input
        v-model="title"
        aria-label="Note title"
        maxlength="200"
        :disabled="busy"
      />
      <el-button native-type="submit" :disabled="busy">
        {{ editing === null ? 'Add note' : 'Save note' }}
      </el-button>
    </form>
    <ul>
      <li v-for="note in notes" :key="note.id">
        {{ note.title }}
        <el-button
          v-if="admin"
          :disabled="busy"
          @click="
            editing = note.id;
            title = note.title;
          "
        >
          Edit note
        </el-button>
        <el-button v-if="admin" :disabled="busy" @click="pending = note.id">
          Delete note
        </el-button>
      </li>
    </ul>
    <div
      v-if="pending !== null"
      role="dialog"
      aria-label="Confirm note deletion"
    >
      <el-button :disabled="busy" @click="remove">
        Confirm note deletion
      </el-button>
      <el-button @click="pending = null">Cancel note deletion</el-button>
    </div>
  </el-card>
</template>
