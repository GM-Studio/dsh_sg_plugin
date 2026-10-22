import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import RoleView from '../src/views/sys/RoleView.vue';
import UserView from '../src/views/sys/UserView.vue';
import { sysRoleApi, sysUserApi } from '../src/api/sys';
import { ApiError } from '../src/api/request';
import { i18n, setLocale } from '../src/i18n';

vi.mock('../src/api/sys', () => ({
  sysRoleApi: {
    list: vi.fn(),
    options: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  sysUserApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batchDelete: vi.fn(),
  },
}));

const admin = { username: 'admin', role: 'ADMIN' };
const viewer = { username: 'viewer', role: 'VIEWER' };
const role = {
  id: 1,
  code: 'ADMIN',
  name: 'Administrator',
  description: 'Full access',
  enabled: true,
};
const option = { value: 'ADMIN', label: 'Administrator' };
const account = {
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  roleCode: 'ADMIN',
  enabled: true,
};
let wrapper: VueWrapper;

function page<T>(records: T[], total = records.length) {
  return { records, total, page: 1, pageSize: 20 };
}
beforeEach(() => {
  setLocale('en-US');
  vi.resetAllMocks();
  vi.mocked(sysRoleApi.list).mockResolvedValue(page([role]));
  vi.mocked(sysRoleApi.options).mockResolvedValue([option]);
  vi.mocked(sysUserApi.list).mockResolvedValue(page([account]));
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});
async function mountRole() {
  wrapper = mount(RoleView, {
    props: { user: admin },
    global: { plugins: [i18n] },
  });
  await flushPromises();
}
async function mountUsers(user = admin) {
  wrapper = mount(UserView, {
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

it('[sys] renders the role table, paginates and shows an empty state', async () => {
  await mountRole();
  expect(sysRoleApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  expect(wrapper.get('.role-row').text()).toContain('ADMIN');
  expect(wrapper.text()).toContain('Administrator');
  wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2);
  await flushPromises();
  expect(sysRoleApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }),
  );
  vi.mocked(sysRoleApi.list).mockResolvedValue(page([], 0));
  await refresh();
  expect(wrapper.find('.role-row').exists()).toBe(false);
  expect(wrapper.find('.empty-state').exists()).toBe(true);
});

it('[sys] searches roles by code and name', async () => {
  await mountRole();
  await wrapper.get('#filter-code').setValue('ADM');
  await wrapper.get('#filter-name').setValue('Administrator');
  await submit('.filter-panel');
  expect(sysRoleApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      page: 1,
      code: 'ADM',
      name: 'Administrator',
    }),
  );
});

it('[sys] creates a role and surfaces validation and duplicate errors', async () => {
  await mountRole();
  await submit('.editor');
  expect(sysRoleApi.create).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text().length).toBeGreaterThan(0);
  await wrapper.get('#role-code').setValue('EDITOR');
  await wrapper.get('#role-name').setValue('Editor');
  await wrapper.get('#role-description').setValue('Can write');
  await submit('.editor');
  expect(sysRoleApi.create).toHaveBeenCalledWith({
    code: 'EDITOR',
    name: 'Editor',
    description: 'Can write',
    enabled: true,
  });
  expect(wrapper.find('[role="status"]').exists()).toBe(true);
  vi.mocked(sysRoleApi.create).mockRejectedValueOnce(
    new ApiError(409, 'Role code already exists'),
  );
  await wrapper.get('#role-code').setValue('ADMIN');
  await wrapper.get('#role-name').setValue('Administrator');
  await submit('.editor');
  expect(wrapper.get('[role="alert"]').text()).toContain(
    'Role code already exists',
  );
});

it('[sys] deletes a role only after confirmation and hides admin actions', async () => {
  await mountRole();
  await wrapper.get('.role-row .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysRoleApi.remove).not.toHaveBeenCalled();
  await wrapper.get('[role="dialog"] .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysRoleApi.remove).toHaveBeenCalledWith(1);
  wrapper.unmount();
  wrapper = mount(RoleView, {
    props: { user: viewer },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  expect(wrapper.find('.editor').exists()).toBe(false);
  expect(wrapper.find('.role-row .el-button--danger').exists()).toBe(false);
});

it('[sys] renders users with role options and creates a user', async () => {
  await mountUsers();
  expect(sysUserApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  expect(sysRoleApi.options).toHaveBeenCalled();
  expect(wrapper.get('.user-row').text()).toContain('alice');
  expect(wrapper.get('#filter-role').text()).toContain('Administrator');
  await wrapper.get('#user-username').setValue('bob');
  await wrapper.get('#user-display-name').setValue('Bob');
  await wrapper.get('#user-role').setValue('ADMIN');
  await submit('.editor');
  expect(sysUserApi.create).toHaveBeenCalledWith({
    username: 'bob',
    displayName: 'Bob',
    roleCode: 'ADMIN',
    enabled: true,
  });
});

it('[sys] batch deletes the selected users after confirmation', async () => {
  vi.mocked(sysUserApi.list).mockResolvedValue(
    page([account, { ...account, id: 2, username: 'bob' }], 2),
  );
  await mountUsers();
  await submit('.editor');
  expect(sysUserApi.create).not.toHaveBeenCalled();
  const boxes = wrapper.findAll('.user-row input[type="checkbox"]');
  await boxes[0].setValue(true);
  await boxes[1].setValue(true);
  await wrapper.get('.panel-heading .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysUserApi.batchDelete).not.toHaveBeenCalled();
  await wrapper.get('[role="dialog"] .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysUserApi.batchDelete).toHaveBeenCalledWith([1, 2]);
});

it('[sys] shows an empty state when no users exist', async () => {
  vi.mocked(sysUserApi.list).mockResolvedValue(page([], 0));
  await mountUsers();
  expect(wrapper.find('.user-row').exists()).toBe(false);
  expect(wrapper.find('.empty-state').exists()).toBe(true);
});

it('[sys] edits and cancels a role', async () => {
  await mountRole();
  function editButton() {
    return wrapper
      .get('.role-row')
      .findAll('button')
      .find((item) => !item.classes('el-button--danger'))!;
  }
  await editButton().trigger('click');
  await flushPromises();
  expect((wrapper.get('#role-name').element as HTMLInputElement).value).toBe(
    'Administrator',
  );
  await wrapper.get('#role-name').setValue('Admin');
  await submit('.editor');
  expect(sysRoleApi.update).toHaveBeenCalledWith({
    code: 'ADMIN',
    name: 'Admin',
    description: 'Full access',
    enabled: true,
    id: 1,
  });
  await editButton().trigger('click');
  await flushPromises();
  await wrapper.get('.editor form button[type="button"]').trigger('click');
  await flushPromises();
  expect(wrapper.find('.editor form button[type="button"]').exists()).toBe(
    false,
  );
});

it('[sys] surfaces trace ids on failures', async () => {
  vi.mocked(sysRoleApi.list).mockRejectedValueOnce(
    new ApiError(500, 'Unavailable', 'trace-9'),
  );
  await mountRole();
  expect(wrapper.get('[role="alert"]').text()).toContain('trace-9');
});

it('[sys] filters users and deletes a single account', async () => {
  await mountUsers();
  await wrapper.get('#filter-username').setValue('ali');
  await submit('.filter-panel');
  expect(sysUserApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, username: 'ali' }),
  );
  await wrapper.get('.user-row .el-button--danger').trigger('click');
  await flushPromises();
  await wrapper.get('[role="dialog"] .el-button--danger').trigger('click');
  await flushPromises();
  expect(sysUserApi.remove).toHaveBeenCalledWith(1);
});

it('[sys] edits an existing user', async () => {
  await mountUsers();
  const edit = wrapper
    .get('.user-row')
    .findAll('button')
    .find((item) => !item.classes('el-button--danger'));
  await edit!.trigger('click');
  await flushPromises();
  expect((wrapper.get('#user-role').element as HTMLSelectElement).value).toBe(
    'ADMIN',
  );
  await wrapper.get('#user-display-name').setValue('Alicia');
  await submit('.editor');
  expect(sysUserApi.update).toHaveBeenCalledWith({
    username: 'alice',
    displayName: 'Alicia',
    roleCode: 'ADMIN',
    enabled: true,
    id: 1,
  });
});
