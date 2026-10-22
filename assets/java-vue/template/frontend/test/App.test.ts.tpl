import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import { authApi } from '../src/api/auth';
import { sysDashboardApi } from '../src/api/sys';
import { ApiError } from '../src/api/request';
import { i18n, setLocale } from '../src/i18n';
import { createAppRouter } from '../src/router';

vi.mock('../src/api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));
vi.mock('../src/api/sys', () => ({
  sysDashboardApi: { summary: vi.fn() },
  sysRoleApi: {},
  sysUserApi: {},
  sysDepartmentApi: {},
  sysMenuApi: {},
  sysAuditApi: {},
}));

let wrapper: VueWrapper;
const admin = { username: 'admin', role: 'ADMIN' as const };

beforeEach(() => {
  setLocale('zh-CN');
  vi.resetAllMocks();
  vi.mocked(authApi.me).mockResolvedValue(admin);
  vi.mocked(sysDashboardApi.summary).mockResolvedValue({
    userCount: 3,
    roleCount: 2,
    departmentCount: 7,
    menuCount: 4,
    auditCount: 9,
  });
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});
async function open() {
  window.location.hash = '#/dashboard';
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
async function signIn(username: string, password: string) {
  await wrapper.get('#username').setValue(username);
  await wrapper.get('#password').setValue(password);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

it('[AC-004] gates the app behind login and signs in with a local account', async () => {
  vi.mocked(authApi.me).mockRejectedValueOnce(
    new ApiError(401, 'Login required'),
  );
  vi.mocked(authApi.login).mockResolvedValue(admin);
  await open();
  expect(wrapper.text()).toContain('欢迎回来');
  expect(wrapper.find('#dashboard').exists()).toBe(false);
  await signIn('admin', 'test-only');
  expect(authApi.login).toHaveBeenCalledWith('admin', 'test-only');
  expect(wrapper.find('#dashboard').exists()).toBe(true);
  expect(wrapper.text()).toContain('admin');
});

it('[AC-004] logs out and returns to the login gate', async () => {
  await open();
  expect(wrapper.find('#dashboard').exists()).toBe(true);
  await click('退出登录');
  expect(authApi.logout).toHaveBeenCalled();
  expect(wrapper.find('#password').exists()).toBe(true);
});

it('[AC-004] clears the session when the API reports expiry', async () => {
  await open();
  expect(wrapper.find('#password').exists()).toBe(false);
  window.dispatchEvent(new Event('session-expired'));
  await flushPromises();
  expect(wrapper.find('#password').exists()).toBe(true);
});

it('[AC-003] renders the dashboard summary after sign-in', async () => {
  await open();
  expect(sysDashboardApi.summary).toHaveBeenCalledTimes(1);
  expect(wrapper.find('#dashboard').exists()).toBe(true);
  expect(wrapper.findAll('.stats strong').map((item) => item.text())).toEqual([
    '3',
    '2',
    '7',
    '4',
  ]);
});

it('[AC-007] defaults to Chinese and switches language at runtime', async () => {
  await open();
  expect(wrapper.text()).toContain('仪表盘');
  await click('切换到英文');
  expect(wrapper.text()).toContain('Dashboard');
  expect(wrapper.text()).toContain('Switch to Chinese');
  await click('Switch to Chinese');
  expect(wrapper.text()).toContain('仪表盘');
});
