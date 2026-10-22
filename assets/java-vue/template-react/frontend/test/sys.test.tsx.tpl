import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { createInstance } from 'i18next';
import enUS from '../src/i18n/locales/en-US';
import RolesPage from '../src/views/sys/RolesPage';
import UsersPage from '../src/views/sys/UsersPage';
import DepartmentsPage from '../src/views/sys/DepartmentsPage';
import MenusPage from '../src/views/sys/MenusPage';
import AuditsPage from '../src/views/sys/AuditsPage';
import {
  sysAuditApi,
  sysDepartmentApi,
  sysMenuApi,
  sysRoleApi,
  sysUserApi,
} from '../src/api/sys';
import { ApiError } from '../src/api/request';

const authState = vi.hoisted(() => ({
  user: null as { username: string; role: string } | null,
}));

vi.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('../src/api/sys', () => ({
  sysRoleApi: {
    list: vi.fn(),
    options: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    import: vi.fn(),
    template: vi.fn(),
    export: vi.fn(),
  },
  sysUserApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batchDelete: vi.fn(),
    import: vi.fn(),
    template: vi.fn(),
    export: vi.fn(),
  },
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

const i18n = createInstance();
i18n.use(initReactI18next);

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: enUS } },
  });
});

const role = {
  id: 1,
  code: 'ADMIN',
  name: 'Administrator',
  description: 'Full access',
  enabled: true,
};
const roleOption = { value: 'ADMIN', label: 'Administrator' };
const account = {
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  roleCode: 'ADMIN',
  enabled: true,
};
const department = {
  id: 1,
  code: 'ENG',
  name: 'Engineering',
  parentCode: null as string | null,
  enabled: true,
};
const departmentOption = { value: 'ENG', label: 'Engineering' };
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

function page<T>(records: T[], total = records.length) {
  return { records, total, page: 1, pageSize: 20 };
}

function renderPage(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

function change(element: Element | null, value: string) {
  if (!element) throw new Error('Missing element to change');
  fireEvent.change(element, { target: { value } });
}

async function chooseCsv(container: HTMLElement, file: File) {
  const input = container.querySelector('#csv-file');
  if (!input) throw new Error('Missing #csv-file');
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input);
}

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = { username: 'admin', role: 'ADMIN' };
  vi.mocked(sysRoleApi.list).mockResolvedValue(page([role]));
  vi.mocked(sysRoleApi.options).mockResolvedValue([roleOption]);
  vi.mocked(sysUserApi.list).mockResolvedValue(page([account]));
  vi.mocked(sysDepartmentApi.list).mockResolvedValue(page([department]));
  vi.mocked(sysDepartmentApi.options).mockResolvedValue([departmentOption]);
  vi.mocked(sysMenuApi.list).mockResolvedValue(page([menu]));
  vi.mocked(sysAuditApi.list).mockResolvedValue(page([audit]));
  vi.mocked(sysRoleApi.import).mockResolvedValue({
    count: 1,
    valid: true,
    errors: [],
  });
  vi.mocked(sysUserApi.import).mockResolvedValue({
    count: 1,
    valid: true,
    errors: [],
  });
});

afterEach(() => {
  cleanup();
});

it('[sys] renders the role table, paginates and shows an empty state', async () => {
  vi.mocked(sysRoleApi.list).mockResolvedValue(page([role], 40));
  const { container } = renderPage(<RolesPage />);
  expect(sysRoleApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  const cell = await screen.findByText('ADMIN');
  expect(cell.closest('tr')?.textContent).toContain('Administrator');
  expect(container.querySelector('.role-row')).toBeTruthy();
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() =>
    expect(sysRoleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    ),
  );
  vi.mocked(sysRoleApi.list).mockResolvedValue(page([], 0));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(container.querySelector('.empty-state')).toBeTruthy(),
  );
});

it('[sys] searches roles by code and name', async () => {
  const { container } = renderPage(<RolesPage />);
  await screen.findByText('ADMIN');
  change(container.querySelector('#filter-role-code'), 'ADM');
  change(container.querySelector('#filter-role-name'), 'Administrator');
  fireEvent.submit(container.querySelector('.filter-panel form')!);
  await waitFor(() =>
    expect(sysRoleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, code: 'ADM', name: 'Administrator' }),
    ),
  );
});

it('[sys] validates and creates a role', async () => {
  const { container } = renderPage(<RolesPage />);
  await screen.findByText('ADMIN');
  const editor = container.querySelector('.editor form')!;
  fireEvent.submit(editor);
  expect(sysRoleApi.create).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBeTruthy();
  change(container.querySelector('#role-code'), 'EDITOR');
  change(container.querySelector('#role-name'), 'Editor');
  change(container.querySelector('#role-description'), 'Can write');
  fireEvent.submit(editor);
  await waitFor(() =>
    expect(sysRoleApi.create).toHaveBeenCalledWith({
      code: 'EDITOR',
      name: 'Editor',
      description: 'Can write',
      enabled: true,
    }),
  );
  expect(await screen.findByText('Role saved')).toBeTruthy();
});

it('[sys] edits a role and cancels the editor', async () => {
  const { container } = renderPage(<RolesPage />);
  const cell = await screen.findByText('ADMIN');
  const row = cell.closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  const nameField = container.querySelector('#role-name') as HTMLInputElement;
  expect(nameField.value).toBe('Administrator');
  change(nameField, 'Admin');
  fireEvent.submit(container.querySelector('.editor form')!);
  await waitFor(() =>
    expect(sysRoleApi.update).toHaveBeenCalledWith({
      code: 'ADMIN',
      name: 'Admin',
      description: 'Full access',
      enabled: true,
      id: 1,
    }),
  );
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
});

it('[sys] deletes a role only after confirmation', async () => {
  const { container } = renderPage(<RolesPage />);
  const cell = await screen.findByText('ADMIN');
  const row = cell.closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  expect(sysRoleApi.remove).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Confirm delete' }),
  );
  await waitFor(() => expect(sysRoleApi.remove).toHaveBeenCalledWith(1));
  expect(container.querySelector('.role-row')).toBeTruthy();
});

it('[sys] hides role mutation controls for non-admins', async () => {
  authState.user = { username: 'viewer', role: 'VIEWER' };
  const { container } = renderPage(<RolesPage />);
  await screen.findByText('ADMIN');
  expect(container.querySelector('.editor')).toBeNull();
  expect(container.querySelector('.transfer-panel')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
});

it('[sys] validates and confirms a role CSV import', async () => {
  const { container } = renderPage(<RolesPage />);
  await screen.findByText('ADMIN');
  const confirm = () =>
    screen.getByRole('button', { name: 'Confirm import' }) as HTMLButtonElement;
  expect(confirm().disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Validate CSV' }));
  expect(sysRoleApi.import).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Choose');
  const file = new File(['code,name\nEDITOR,Editor'], 'roles.csv', {
    type: 'text/csv',
  });
  await chooseCsv(container, file);
  vi.mocked(sysRoleApi.import).mockResolvedValue({
    count: 0,
    valid: false,
    errors: ['Row 2 invalid'],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Validate CSV' }));
  await waitFor(() =>
    expect(sysRoleApi.import).toHaveBeenCalledWith(file, true),
  );
  expect(await screen.findByText('Row 2 invalid')).toBeTruthy();
  expect(confirm().disabled).toBe(true);
  vi.mocked(sysRoleApi.import).mockResolvedValue({
    count: 1,
    valid: true,
    errors: [],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Validate CSV' }));
  await waitFor(() => expect(confirm().disabled).toBe(false));
  fireEvent.click(confirm());
  await waitFor(() =>
    expect(sysRoleApi.import).toHaveBeenLastCalledWith(file, false),
  );
  expect(await screen.findByText(/Imported/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'CSV template' }));
  await waitFor(() => expect(sysRoleApi.template).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() =>
    expect(sysRoleApi.export).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
    ),
  );
});

it('[sys] renders users with role options and creates one', async () => {
  const { container } = renderPage(<UsersPage />);
  expect(sysUserApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  await screen.findByText('alice');
  expect(sysRoleApi.options).toHaveBeenCalled();
  const roleFilter = container.querySelector(
    '#filter-role',
  ) as HTMLSelectElement;
  expect(roleFilter.textContent).toContain('Administrator');
  change(container.querySelector('#user-username'), 'bob');
  change(container.querySelector('#user-display-name'), 'Bob');
  change(container.querySelector('#user-role'), 'ADMIN');
  fireEvent.submit(container.querySelector('.editor form')!);
  await waitFor(() =>
    expect(sysUserApi.create).toHaveBeenCalledWith({
      username: 'bob',
      displayName: 'Bob',
      roleCode: 'ADMIN',
      enabled: true,
    }),
  );
});

it('[sys] batch deletes the selected users after confirmation', async () => {
  vi.mocked(sysUserApi.list).mockResolvedValue(
    page([account, { ...account, id: 2, username: 'bob' }], 2),
  );
  const { container } = renderPage(<UsersPage />);
  await screen.findByText('alice');
  const boxes = container.querySelectorAll('.user-row input[type="checkbox"]');
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  expect(sysUserApi.batchDelete).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Confirm delete' }),
  );
  await waitFor(() =>
    expect(sysUserApi.batchDelete).toHaveBeenCalledWith([1, 2]),
  );
});

it('[sys] deletes a single account after confirmation', async () => {
  const { container } = renderPage(<UsersPage />);
  const cell = await screen.findByText('alice');
  const row = cell.closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Confirm delete' }),
  );
  await waitFor(() => expect(sysUserApi.remove).toHaveBeenCalledWith(1));
  expect(container.querySelector('.user-row')).toBeTruthy();
});

it('[sys] shows an empty state when no users exist', async () => {
  vi.mocked(sysUserApi.list).mockResolvedValue(page([], 0));
  const { container } = renderPage(<UsersPage />);
  await waitFor(() =>
    expect(container.querySelector('.empty-state')).toBeTruthy(),
  );
  expect(container.querySelector('.user-row')).toBeNull();
});

it('[sys] hides user mutation controls for non-admins', async () => {
  authState.user = { username: 'viewer', role: 'VIEWER' };
  const { container } = renderPage(<UsersPage />);
  await screen.findByText('alice');
  expect(container.querySelector('.editor')).toBeNull();
  expect(container.querySelector('.transfer-panel')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
});

it('[sys] renders departments and creates one with a parent', async () => {
  const { container } = renderPage(<DepartmentsPage />);
  await screen.findByText('ENG');
  expect(sysDepartmentApi.options).toHaveBeenCalled();
  change(container.querySelector('#dept-code'), 'OPS');
  change(container.querySelector('#dept-name'), 'Operations');
  change(container.querySelector('#dept-parent'), 'ENG');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(container.querySelector('.editor form')!);
  await waitFor(() =>
    expect(sysDepartmentApi.create).toHaveBeenCalledWith({
      code: 'OPS',
      name: 'Operations',
      parentCode: 'ENG',
      enabled: false,
    }),
  );
});

it('[sys] deletes a department after confirmation', async () => {
  const { container } = renderPage(<DepartmentsPage />);
  const cell = await screen.findByText('ENG');
  const row = cell.closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  expect(sysDepartmentApi.remove).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Confirm delete' }),
  );
  await waitFor(() => expect(sysDepartmentApi.remove).toHaveBeenCalledWith(1));
  expect(container.querySelector('.department-row')).toBeTruthy();
});

it('[sys] renders menus, creates and updates one', async () => {
  const { container } = renderPage(<MenusPage />);
  await screen.findByText('DASH');
  change(container.querySelector('#menu-code'), 'SETTINGS');
  change(container.querySelector('#menu-name'), 'Settings');
  change(container.querySelector('#menu-path'), '/settings');
  change(container.querySelector('#menu-icon'), 'gear');
  change(container.querySelector('#menu-sort'), '5');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(container.querySelector('.editor form')!);
  await waitFor(() =>
    expect(sysMenuApi.create).toHaveBeenCalledWith({
      code: 'SETTINGS',
      name: 'Settings',
      path: '/settings',
      icon: 'gear',
      sortOrder: 5,
      enabled: false,
    }),
  );
  const cell = await screen.findByText('DASH');
  const row = cell.closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  const pathField = container.querySelector('#menu-path') as HTMLInputElement;
  expect(pathField.value).toBe('/dashboard');
  change(container.querySelector('#menu-name'), 'Home');
  fireEvent.submit(container.querySelector('.editor form')!);
  await waitFor(() =>
    expect(sysMenuApi.update).toHaveBeenCalledWith({
      code: 'DASH',
      name: 'Home',
      path: '/dashboard',
      icon: 'home',
      sortOrder: 1,
      enabled: true,
      id: 1,
    }),
  );
});

it('[sys] renders read-only audits with filters', async () => {
  const { container } = renderPage(<AuditsPage />);
  expect(sysAuditApi.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 }),
  );
  const cell = await screen.findByText('admin');
  const row = cell.closest('tr')!;
  expect(row.textContent).toContain('CREATE');
  expect(container.querySelector('.editor')).toBeNull();
  expect(container.querySelector('.audit-row button')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  change(container.querySelector('#filter-audit-actor'), 'admin');
  change(container.querySelector('#filter-audit-action'), 'CREATE');
  fireEvent.submit(container.querySelector('.filter-panel form')!);
  await waitFor(() =>
    expect(sysAuditApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, actor: 'admin', action: 'CREATE' }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(sysAuditApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, actor: 'admin', action: 'CREATE' }),
    ),
  );
});

it('[sys] keeps audits read-only for non-admins', async () => {
  authState.user = { username: 'viewer', role: 'VIEWER' };
  const { container } = renderPage(<AuditsPage />);
  const cell = await screen.findByText('admin');
  expect(cell.closest('tr')?.textContent).toContain('CREATE');
  expect(container.querySelector('.editor')).toBeNull();
  expect(container.querySelector('.audit-row button')).toBeNull();
});

it('[sys] surfaces trace ids on failures', async () => {
  vi.mocked(sysRoleApi.list).mockRejectedValueOnce(
    new ApiError(500, 'Unavailable', 'trace-9'),
  );
  renderPage(<RolesPage />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('trace-9');
});
