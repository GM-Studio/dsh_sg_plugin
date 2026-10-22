import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import App from '../src/App';
import DashboardPage from '../src/views/DashboardPage';
import { authApi } from '../src/api/auth';
import { sysDashboardApi } from '../src/api/sys';
import { ApiError } from '../src/api/request';
import { i18n, setLocale } from '../src/i18n';

vi.mock('../src/api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));

vi.mock('../src/api/sys', () => ({
  sysDashboardApi: { summary: vi.fn() },
}));

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

const admin = { username: 'admin', role: 'ADMIN' } as const;
const summary = {
  userCount: 3,
  roleCount: 2,
  departmentCount: 7,
  menuCount: 4,
  auditCount: 9,
};
const zh = (key: string): string => String(i18n.t(key, { lng: 'zh-CN' }));

function renderApp(entry = '/dashboard') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/" element={<App />}>
            <Route path="dashboard" element={<DashboardPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setLocale('zh-CN');
  vi.mocked(authApi.me).mockResolvedValue(admin);
  vi.mocked(sysDashboardApi.summary).mockResolvedValue(summary);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it('shows the login screen while unauthenticated', async () => {
  vi.mocked(authApi.me).mockRejectedValueOnce(
    new ApiError(401, 'Login required'),
  );
  renderApp();
  expect(
    await screen.findByRole('heading', { name: zh('login.title') }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: zh('login.submit') }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(zh('login.username'))).toBeInTheDocument();
  expect(screen.getByLabelText(zh('login.password'))).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('signs in from the login form', async () => {
  vi.mocked(authApi.me).mockRejectedValueOnce(
    new ApiError(401, 'Login required'),
  );
  vi.mocked(authApi.login).mockResolvedValue(admin);
  const user = userEvent.setup();
  renderApp();
  const password = await screen.findByLabelText(zh('login.password'));
  await user.type(password, 'test-only');
  await user.click(screen.getByRole('button', { name: zh('login.submit') }));
  await waitFor(() =>
    expect(authApi.login).toHaveBeenCalledWith('admin', 'test-only'),
  );
  expect(await screen.findByText('admin · ADMIN')).toBeInTheDocument();
});

it('renders the authenticated shell, navigation and dashboard stats', async () => {
  const { container } = renderApp();
  const nav = await screen.findByRole('complementary', {
    name: zh('navigation.ariaLabel'),
  });
  const labels = [
    'navigation.dashboard',
    'sys.navigation.roles',
    'sys.navigation.users',
    'sys.navigation.departments',
    'sys.navigation.menus',
    'sys.navigation.audits',
  ];
  for (const key of labels) {
    expect(
      within(nav).getByRole('link', { name: new RegExp(zh(key)) }),
    ).toBeInTheDocument();
  }
  expect(screen.getByText('admin · ADMIN')).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: zh('dashboard.title'),
    }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll('.stats .ant-card')).toHaveLength(4);
  await waitFor(() =>
    expect(
      Array.from(container.querySelectorAll('.stats strong')).map(
        (element) => element.textContent,
      ),
    ).toEqual(['3', '2', '7', '4']),
  );
});

it('switches the interface language at runtime', async () => {
  const user = userEvent.setup();
  renderApp();
  await screen.findByText('admin · ADMIN');
  const toggle = zh('language.switch');
  await user.click(screen.getByRole('button', { name: toggle }));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Switch to Chinese' }),
  ).toBeInTheDocument();
});

it('signs out back to the login screen', async () => {
  vi.mocked(authApi.logout).mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderApp();
  await screen.findByText('admin · ADMIN');
  await user.click(
    screen.getByRole('button', { name: zh('navigation.logout') }),
  );
  await waitFor(() => expect(authApi.logout).toHaveBeenCalled());
  expect(
    await screen.findByRole('heading', { name: zh('login.title') }),
  ).toBeInTheDocument();
});

it('surfaces a startup failure with its trace id', async () => {
  vi.mocked(authApi.me).mockRejectedValueOnce(
    new ApiError(500, 'Unavailable', 'trace-9'),
  );
  renderApp();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('trace-9');
  expect(
    await screen.findByRole('heading', { name: zh('login.title') }),
  ).toBeInTheDocument();
});
