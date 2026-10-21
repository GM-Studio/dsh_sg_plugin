import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import { authApi } from '../src/api/auth';
import { taskApi } from '../src/api/tasks';
import { fileApi } from '../src/api/files';
import { ApiError } from '../src/api/request';

vi.mock('../src/api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));
vi.mock('../src/api/tasks', () => ({
  taskApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batchDelete: vi.fn(),
    batchStatus: vi.fn(),
    import: vi.fn(),
    export: vi.fn(),
    template: vi.fn(),
  },
}));
vi.mock('../src/api/files', () => ({
  fileApi: { list: vi.fn(), upload: vi.fn(), download: vi.fn() },
}));
let wrapper: VueWrapper;
const task = { id: 1, title: '<img src=x onerror=alert(1)>', completed: false };
const file = {
  fileId: 'file',
  name: 'note.txt',
  size: 5,
  mediaType: 'text/plain',
  downloadUrl: '/api/files/file/download',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.me).mockResolvedValue({ username: 'admin', role: 'ADMIN' });
  vi.mocked(taskApi.list).mockResolvedValue({
    records: [task],
    total: 25,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(taskApi.get).mockResolvedValue(task);
  vi.mocked(fileApi.list).mockResolvedValue([file]);
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});
async function open() {
  wrapper = mount(App);
  await flushPromises();
}
async function click(label: string) {
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === label);
  expect(button, label).toBeDefined();
  await button!.trigger('click');
  await flushPromises();
}
async function save(title: string) {
  await wrapper.get('#title').setValue(title);
  const form = wrapper
    .findAll('form')
    .find((item) => item.find('#title').exists())!;
  await form.trigger('submit');
  await flushPromises();
}
async function choose(id: string, file?: File) {
  const input = wrapper.get(id);
  Object.defineProperty(input.element, 'files', {
    value: file ? [file] : [],
    configurable: true,
  });
  await input.trigger('change');
  await flushPromises();
}

it('[AC-001] safely renders tasks and performs create, update, cancel, detail and confirmed deletion', async () => {
  await open();
  expect(wrapper.text()).toContain('<img');
  expect(wrapper.find('img').exists()).toBe(false);
  await save('New');
  expect(taskApi.create).toHaveBeenCalledWith({
    title: 'New',
    completed: false,
  });
  await click('Edit');
  await save('Edited');
  expect(taskApi.update).toHaveBeenCalledWith(1, {
    title: 'Edited',
    completed: false,
  });
  await click('Edit');
  await click('Cancel');
  await click('Details');
  expect(wrapper.get('[aria-label="Task details"]').text()).toContain(
    task.title,
  );
  await click('Close details');
  await click('Delete');
  await click('Cancel deletion');
  expect(taskApi.remove).not.toHaveBeenCalled();
  await click('Delete');
  await click('Confirm delete');
  expect(taskApi.remove).toHaveBeenCalledWith(1);
  await save('   ');
  expect(wrapper.get('[role="alert"]').text()).toContain('1–200');
});

it('[AC-001] performs filtering, pagination and both batch actions', async () => {
  vi.mocked(taskApi.list).mockResolvedValue({
    records: [task, { ...task, id: 2, title: 'Second' }],
    total: 25,
    page: 1,
    pageSize: 20,
  });
  await open();
  await wrapper.get('#filter-title').setValue('Second');
  await click('Search');
  expect(taskApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Second', page: 1 }),
  );
  const boxes = wrapper.findAll('.task-list input[type="checkbox"]');
  await boxes[0].setValue(true);
  await click('Complete selected');
  expect(taskApi.batchStatus).toHaveBeenCalledWith([1], true);
  await wrapper.findAll('.task-list input[type="checkbox"]')[0].setValue(true);
  await click('Reopen selected');
  expect(taskApi.batchStatus).toHaveBeenCalledWith([1], false);
  for (const box of wrapper.findAll('.task-list input[type="checkbox"]'))
    await box.setValue(true);
  await click('Delete selected');
  await click('Confirm delete');
  expect(taskApi.batchDelete).toHaveBeenCalledWith([1, 2]);
  await wrapper
    .findComponent({ name: 'ElPagination' })
    .vm.$emit('current-change', 2);
  await flushPromises();
  expect(taskApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }),
  );
});

it('[AC-004] handles login, session recovery, read-only permissions and logout', async () => {
  vi.mocked(authApi.me).mockRejectedValueOnce(
    new ApiError(401, 'Login required'),
  );
  vi.mocked(authApi.login).mockResolvedValue({
    username: 'viewer',
    role: 'VIEWER',
  });
  await open();
  expect(wrapper.text()).toContain('Welcome back');
  await wrapper.get('#username').setValue('viewer');
  await wrapper.get('#password').setValue('test-only');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(authApi.login).toHaveBeenCalledWith('viewer', 'test-only');
  expect(wrapper.find('#title').exists()).toBe(false);
  expect(wrapper.find('#upload-file').exists()).toBe(false);
  await click('Sign out');
  expect(authApi.logout).toHaveBeenCalled();
  expect(wrapper.find('#password').exists()).toBe(true);
});

it('[AC-003] displays recoverable errors, preserves input, and clears expired sessions', async () => {
  vi.mocked(taskApi.list).mockRejectedValueOnce(
    new ApiError(500, 'Unavailable', 'trace-1'),
  );
  await open();
  expect(wrapper.get('[role="alert"]').text()).toContain('trace-1');
  await click('Refresh');
  vi.mocked(taskApi.create).mockRejectedValueOnce(new Error('Please retry'));
  await save('Keep input');
  expect((wrapper.get('#title').element as HTMLInputElement).value).toBe(
    'Keep input',
  );
  expect(wrapper.get('[role="alert"]').text()).toBe('Please retry');
  window.dispatchEvent(new Event('session-expired'));
  await flushPromises();
  expect(wrapper.find('#password').exists()).toBe(true);
});

it('[AC-005] prevalidates CSV, confirms import and resets validation when file changes', async () => {
  await open();
  await click('Validate CSV');
  expect(wrapper.get('[role="alert"]').text()).toContain('Choose');
  const csv = new File(['title,completed\nOne,true'], 'tasks.csv', {
    type: 'text/csv',
  });
  await choose('#csv-file', csv);
  vi.mocked(taskApi.import).mockResolvedValueOnce({
    count: 0,
    valid: false,
    errors: ['Row 2 invalid'],
  });
  await click('Validate CSV');
  expect(wrapper.text()).toContain('Row 2 invalid');
  vi.mocked(taskApi.import).mockResolvedValue({
    count: 1,
    valid: true,
    errors: [],
  });
  await click('Validate CSV');
  await click('Confirm import');
  expect(taskApi.import).toHaveBeenLastCalledWith(csv, false);
  expect(wrapper.text()).toContain('Imported 1');
  await choose('#csv-file');
  await click('CSV template');
  expect(taskApi.template).toHaveBeenCalled();
  await click('Export CSV');
  expect(taskApi.export).toHaveBeenCalled();
});

it('[AC-006] uploads and downloads files, and handles empty lists and no selection', async () => {
  await open();
  await choose('#upload-file');
  expect(fileApi.upload).not.toHaveBeenCalled();
  const upload = new File(['hello'], 'note.txt', { type: 'text/plain' });
  await choose('#upload-file', upload);
  expect(fileApi.upload).toHaveBeenCalledWith(upload);
  await click('Download');
  expect(fileApi.download).toHaveBeenCalledWith(file);
  vi.mocked(taskApi.list).mockResolvedValue({
    records: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(fileApi.list).mockResolvedValue([]);
  await click('Refresh');
  expect(wrapper.text()).toContain('No tasks');
  expect(wrapper.text()).toContain('No files');
});

it('[AC-003] reports startup failures and prevents duplicate writes while a request is pending', async () => {
  vi.mocked(authApi.me).mockRejectedValueOnce(new Error('offline'));
  await open();
  expect(wrapper.get('[role="alert"]').text()).toBe('offline');
  vi.mocked(authApi.login).mockResolvedValue({
    username: 'admin',
    role: 'ADMIN',
  });
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  let finish!: () => void;
  vi.mocked(taskApi.create).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () => resolve(task);
    }),
  );
  await wrapper.get('#title').setValue('Once');
  const form = wrapper
    .findAll('form')
    .find((item) => item.find('#title').exists())!;
  await form.trigger('submit');
  await form.trigger('submit');
  expect(taskApi.create).toHaveBeenCalledTimes(1);
  finish();
  await flushPromises();
});
