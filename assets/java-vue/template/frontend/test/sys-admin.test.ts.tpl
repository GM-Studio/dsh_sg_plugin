import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import AuditView from '../src/views/sys/AuditView.vue';
import DepartmentView from '../src/views/sys/DepartmentView.vue';
import MenuView from '../src/views/sys/MenuView.vue';
import { sysAuditApi, sysDepartmentApi, sysMenuApi } from '../src/api/sys';
import { ApiError } from '../src/api/request';
import { i18n, setLocale } from '../src/i18n';

vi.mock('../src/api/sys', () => ({
  sysDepartmentApi: {
    list: vi.fn(),
    options: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  sysMenuApi: {
    list: vi.fn(),
    options: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  sysAuditApi: { list: vi.fn() },
}));

const admin = { username: 'admin', role: 'ADMIN' };
const viewer = { username: 'viewer', role: 'VIEWER' };
const department = {
  id: 1,
  code: 'ENG',
  name: 'Engineering',
  parentCode: null,
  enabled: true,
};
const menu = {
  id: 1,
  code: 'DASH',
  name: 'Dashboard',
  path: '/dashboard',
  icon: 'home',
  sortOrder: 1,
  enabled: true,
};
const audit = {
  id: 1,
  actor: 'admin',
  action: 'CREATE',
  target: 'role:1',
  detail: 'Created role',
  createdAt: '2026-01-01T08:00:00Z',
};
const option = { value: 'ENG', label: 'Engineering' };
let wrapper: VueWrapper;

function page<T>(records: T[], total = records.length) {
  return { records, total, page: 1, pageSize: 20 };
}
beforeEach(() => {
  setLocale('en-US');
  vi.resetAllMocks();
  vi.mocked(sysDepartmentApi.list).mockResolvedValue(page([department]));
  vi.mocked(sysDepartmentApi.options).mockResolvedValue([option]);
  vi.mocked(sysMenuApi.list).mockResolvedValue(page([menu]));
  vi.mocked(sysMenuApi.options).mockResolvedValue([option]);
  vi.mocked(sysAuditApi.list).mockResolvedValue(page([audit]));
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});
async function mountDepartments(user = admin) {
  wrapper = mount(DepartmentView, {
    props: { user },
    global: { plugins: [i18n] },
  });
  await flushPromises();
}
async function mountMenus(user = admin) {
  wrapper = mount(MenuView, {
    props: { user },
    global: { plugins: [i18n] },
  });
  await flushPromises();
}
async function mountAudits(user = admin) {
  wrapper = mount(AuditView, {
    props: { user },
    global: { plugins: [i18n] },
  });
  await flushPromises();
}
async function submit(scope: string) {
  await wrapper.get(`${scope} form`).trigger('submit');
  await flushPromises();
}
async function refresh() {
  await wrapper.get('.page-heading button').trigger('click');
  await flushPromises();
}
function editButton(rowSelector: string) {
  return wrapper
    .get(rowSelector)
    .findAll('button')
    .find((item) => !item.classes('el-button--danger'))!;
}

it('[sys-admin] renders departments, searches, paginates and shows an empty state', async () => {
  await mountDepartments();
  expect(sysDepartmentApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  expect(sysDepartmentApi.options).toHaveBeenCalled();
  expect(wrapper.get('.department-row').text()).toContain('ENG');
  expect(wrapper.get('.department-row').text()).toContain('Engineering');
  wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2);
  await flushPromises();
  expect(sysDepartmentApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }),
  );
  await wrapper.get('#filter-dept-code').setValue('ENG');
  await wrapper.get('#filter-dept-name').setValue('Engineering');
  await submit('.filter-panel');
  expect(sysDepartmentApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, code: 'ENG', name: 'Engineering' }),
  );
  vi.mocked(sysDepartmentApi.list).mockResolvedValue(page([], 0));
  await refresh();
  expect(wrapper.find('.department-row').exists()).toBe(false);
  expect(wrapper.find('.empty-state').exists()).toBe(true);
});

it('[sys-admin] creates a department after validating and confirms deletion', async () => {
  await mountDepartments();
  await submit('.editor');
  expect(sysDepartmentApi.create).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text().length).toBeGreaterThan(0);
  await wrapper.get('#dept-code').setValue('OPS');
  await wrapper.get('#dept-name').setValue('Operations');
  await wrapper.get('#dept-parent').setValue('ENG');
  await wrapper.get('#dept-enabled').setValue(false);
  await submit('.editor');
  expect(sysDepartmentApi.create).toHaveBeenCalledWith({
    code: 'OPS',
    name: 'Operations',
    parentCode: 'ENG',
    enabled: false,
  });
  expect(wrapper.find('[role="status"]').exists()).toBe(true);
  vi.mocked(sysDepartmentApi.create).mockRejectedValueOnce(
    new ApiError(409, 'Department code already exists'),
  );
  await wrapper.get('#dept-code').setValue('ENG');
  await wrapper.get('#dept-name').setValue('Engineering');
  await submit('.editor');
  expect(wrapper.get('[role="alert"]').text()).toContain(
    'Department code already exists',
  );
  await wrapper.get('.department-row .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysDepartmentApi.remove).not.toHaveBeenCalled();
  await wrapper.get('[role="dialog"] .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysDepartmentApi.remove).toHaveBeenCalledWith(1);
});

it('[sys-admin] updates a department and hides mutations for non-admins', async () => {
  await mountDepartments();
  await editButton('.department-row').trigger('click');
  await flushPromises();
  expect((wrapper.get('#dept-name').element as HTMLInputElement).value).toBe(
    'Engineering',
  );
  await wrapper.get('#dept-name').setValue('Platform');
  await submit('.editor');
  expect(sysDepartmentApi.update).toHaveBeenCalledWith({
    code: 'ENG',
    name: 'Platform',
    parentCode: null,
    enabled: true,
    id: 1,
  });
  wrapper.unmount();
  await mountDepartments(viewer);
  expect(wrapper.find('.editor').exists()).toBe(false);
  expect(wrapper.find('.department-row .el-button--danger').exists()).toBe(
    false,
  );
});

it('[sys-admin] renders menus, searches, creates, updates and deletes', async () => {
  await mountMenus();
  expect(sysMenuApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  expect(wrapper.get('.menu-row').text()).toContain('DASH');
  await wrapper.get('#filter-menu-code').setValue('DASH');
  await wrapper.get('#filter-menu-name').setValue('Dashboard');
  await submit('.filter-panel');
  expect(sysMenuApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, code: 'DASH', name: 'Dashboard' }),
  );
  await submit('.editor');
  expect(sysMenuApi.create).not.toHaveBeenCalled();
  await wrapper.get('#menu-code').setValue('SETTINGS');
  await wrapper.get('#menu-name').setValue('Settings');
  await wrapper.get('#menu-path').setValue('/settings');
  await wrapper.get('#menu-icon').setValue('gear');
  await wrapper.get('#menu-sort').setValue('5');
  await wrapper.get('#menu-enabled').setValue(false);
  await submit('.editor');
  expect(sysMenuApi.create).toHaveBeenCalledWith({
    code: 'SETTINGS',
    name: 'Settings',
    path: '/settings',
    icon: 'gear',
    sortOrder: 5,
    enabled: false,
  });
  await editButton('.menu-row').trigger('click');
  await flushPromises();
  expect((wrapper.get('#menu-path').element as HTMLInputElement).value).toBe(
    '/dashboard',
  );
  await wrapper.get('#menu-name').setValue('Home');
  await submit('.editor');
  expect(sysMenuApi.update).toHaveBeenCalledWith({
    code: 'DASH',
    name: 'Home',
    path: '/dashboard',
    icon: 'home',
    sortOrder: 1,
    enabled: true,
    id: 1,
  });
  await wrapper.get('.menu-row .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysMenuApi.remove).not.toHaveBeenCalled();
  await wrapper.get('[role="dialog"] .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysMenuApi.remove).toHaveBeenCalledWith(1);
});

it('[sys-admin] hides menu mutations for non-admins and shows an empty state', async () => {
  await mountMenus(viewer);
  expect(wrapper.find('.editor').exists()).toBe(false);
  expect(wrapper.find('.menu-row .el-button--danger').exists()).toBe(false);
  wrapper.unmount();
  vi.mocked(sysMenuApi.list).mockResolvedValue(page([], 0));
  await mountMenus();
  expect(wrapper.find('.menu-row').exists()).toBe(false);
  expect(wrapper.find('.empty-state').exists()).toBe(true);
});

it('[sys-admin] renders read-only audits with filters and no mutation controls', async () => {
  await mountAudits();
  expect(sysAuditApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  expect(wrapper.get('.audit-row').text()).toContain('admin');
  expect(wrapper.get('.audit-row').text()).toContain('CREATE');
  expect(wrapper.find('.editor').exists()).toBe(false);
  expect(wrapper.find('.audit-row button').exists()).toBe(false);
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  await wrapper.get('#filter-audit-actor').setValue('admin');
  await wrapper.get('#filter-audit-action').setValue('CREATE');
  await submit('.filter-panel');
  expect(sysAuditApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, actor: 'admin', action: 'CREATE' }),
  );
  wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2);
  await flushPromises();
  expect(sysAuditApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }),
  );
  vi.mocked(sysAuditApi.list).mockResolvedValue(page([], 0));
  await refresh();
  expect(wrapper.find('.audit-row').exists()).toBe(false);
  expect(wrapper.find('.empty-state').exists()).toBe(true);
});

it('[sys-admin] keeps audits read-only for non-admins too', async () => {
  await mountAudits(viewer);
  expect(wrapper.get('.audit-row').text()).toContain('admin');
  expect(wrapper.find('.audit-row button').exists()).toBe(false);
  expect(wrapper.find('.editor').exists()).toBe(false);
});

it('[sys-admin] surfaces trace ids on failures', async () => {
  vi.mocked(sysMenuApi.list).mockRejectedValueOnce(
    new ApiError(500, 'Unavailable', 'trace-11'),
  );
  await mountMenus();
  expect(wrapper.get('[role="alert"]').text()).toContain('trace-11');
});
