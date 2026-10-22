import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import { authApi } from '../src/api/auth';
import { taskApi } from '../src/api/tasks';
import { fileApi } from '../src/api/files';
import { ApiError } from '../src/api/request';
import { i18n, setLocale } from '../src/i18n';
import { createAppRouter } from '../src/router';

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
  setLocale('zh-CN');
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
  window.location.hash = '#/tasks';
  const router = createAppRouter();
  wrapper = mount(App, { global: { plugins: [i18n, router] } });
  await router.isReady();
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
  await click('编辑');
  await save('Edited');
  expect(taskApi.update).toHaveBeenCalledWith(1, {
    title: 'Edited',
    completed: false,
  });
  await click('编辑');
  await click('取消');
  await click('详情');
  expect(wrapper.get('[aria-label="任务详情"]').text()).toContain(task.title);
  await click('关闭详情');
  await click('删除');
  await click('取消删除');
  expect(taskApi.remove).not.toHaveBeenCalled();
  await click('删除');
  await click('确认删除');
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
  await click('查询');
  expect(taskApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Second', page: 1 }),
  );
  const boxes = wrapper.findAll('.task-list input[type="checkbox"]');
  await boxes[0].setValue(true);
  await click('批量完成');
  expect(taskApi.batchStatus).toHaveBeenCalledWith([1], true);
  await wrapper.findAll('.task-list input[type="checkbox"]')[0].setValue(true);
  await click('批量恢复');
  expect(taskApi.batchStatus).toHaveBeenCalledWith([1], false);
  for (const box of wrapper.findAll('.task-list input[type="checkbox"]'))
    await box.setValue(true);
  await click('批量删除');
  await click('确认删除');
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
  expect(wrapper.text()).toContain('欢迎回来');
  await wrapper.get('#username').setValue('viewer');
  await wrapper.get('#password').setValue('test-only');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(authApi.login).toHaveBeenCalledWith('viewer', 'test-only');
  expect(wrapper.find('#title').exists()).toBe(false);
  expect(wrapper.find('#upload-file').exists()).toBe(false);
  await click('退出登录');
  expect(authApi.logout).toHaveBeenCalled();
  expect(wrapper.find('#password').exists()).toBe(true);
});

it('[AC-003] displays recoverable errors, preserves input, and clears expired sessions', async () => {
  vi.mocked(taskApi.list).mockRejectedValueOnce(
    new ApiError(500, 'Unavailable', 'trace-1'),
  );
  await open();
  expect(wrapper.get('[role="alert"]').text()).toContain('trace-1');
  await click('刷新');
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
  await click('校验 CSV');
  expect(wrapper.get('[role="alert"]').text()).toContain('选择');
  const csv = new File(['title,completed\nOne,true'], 'tasks.csv', {
    type: 'text/csv',
  });
  await choose('#csv-file', csv);
  vi.mocked(taskApi.import).mockResolvedValueOnce({
    count: 0,
    valid: false,
    errors: ['Row 2 invalid'],
  });
  await click('校验 CSV');
  expect(wrapper.text()).toContain('Row 2 invalid');
  vi.mocked(taskApi.import).mockResolvedValue({
    count: 1,
    valid: true,
    errors: [],
  });
  await click('校验 CSV');
  await click('确认导入');
  expect(taskApi.import).toHaveBeenLastCalledWith(csv, false);
  expect(wrapper.text()).toContain('已导入 1');
  await choose('#csv-file');
  await click('下载模板');
  expect(taskApi.template).toHaveBeenCalled();
  await click('导出 CSV');
  expect(taskApi.export).toHaveBeenCalled();
});

it('[AC-006] uploads and downloads files, and handles empty lists and no selection', async () => {
  await open();
  await choose('#upload-file');
  expect(fileApi.upload).not.toHaveBeenCalled();
  const upload = new File(['hello'], 'note.txt', { type: 'text/plain' });
  await choose('#upload-file', upload);
  expect(fileApi.upload).toHaveBeenCalledWith(upload);
  await click('下载');
  expect(fileApi.download).toHaveBeenCalledWith(file);
  vi.mocked(taskApi.list).mockResolvedValue({
    records: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(fileApi.list).mockResolvedValue([]);
  await click('刷新');
  expect(wrapper.text()).toContain('没有任务');
  expect(wrapper.text()).toContain('暂无文件');
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

it('[AC-001] defaults to Chinese and switches to English at runtime', async () => {
  await open();
  expect(wrapper.text()).toContain('任务管理');
  await click('切换到英文');
  expect(wrapper.text()).toContain('Task manager');
  expect(wrapper.text()).toContain('Switch to Chinese');
  await click('Switch to Chinese');
  expect(wrapper.text()).toContain('任务管理');
});
