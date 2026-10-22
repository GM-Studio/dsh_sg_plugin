import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Input, Pagination, Tag } from 'antd';
import { sysRoleApi, sysUserApi } from '../../api/sys';
import type { SysOption, SysUser } from '../../api/sys';
import type { ImportResult } from '../../api/types';
import { ApiError } from '../../api/request';
import { useAuth } from '../../auth/AuthContext';

interface UserQuery {
  page: number;
  pageSize: number;
  username: string;
  roleCode: string;
  enabled: string;
}

function useAsyncAction() {
  const { t } = useTranslation();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        await action();
      } catch (cause) {
        const base =
          cause instanceof Error ? cause.message : t('error.unexpected');
        setError(
          cause instanceof ApiError && cause.traceId
            ? `${base} (${t('error.trace')}: ${cause.traceId})`
            : base,
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [t],
  );
  return { busy, error, notice, setError, setNotice, run };
}

export default function UsersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const [records, setRecords] = useState<SysUser[]>([]);
  const [roles, setRoles] = useState<SysOption[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<UserQuery>({
    page: 1,
    pageSize: 20,
    username: '',
    roleCode: '',
    enabled: '',
  });
  const queryRef = useRef(query);
  queryRef.current = query;
  const [editId, setEditId] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const refresh = useCallback(async (next?: UserQuery) => {
    const page = await sysUserApi.list(next ?? queryRef.current);
    setRecords(page.records);
    setTotal(page.total);
    setSelected([]);
    setRoles(await sysRoleApi.options());
  }, []);

  const reset = useCallback(() => {
    setEditId(null);
    setUsername('');
    setDisplayName('');
    setRoleCode('');
    setEnabled(true);
  }, []);

  useEffect(() => {
    void run(() => refresh());
  }, [run, refresh]);

  function edit(record: SysUser) {
    setEditId(record.id);
    setUsername(record.username);
    setDisplayName(record.displayName);
    setRoleCode(record.roleCode);
    setEnabled(record.enabled);
  }

  function toggleSelected(id: number) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function save() {
    if (!username.trim() || !displayName.trim() || !roleCode) {
      setError(t('sys.users.validation'));
      return;
    }
    await run(async () => {
      const body = {
        username: username.trim(),
        displayName: displayName.trim(),
        roleCode,
        enabled,
      };
      if (editId === null) await sysUserApi.create(body);
      else await sysUserApi.update({ ...body, id: editId });
      reset();
      setNotice(t('sys.users.created'));
      await refresh();
    });
  }

  async function remove() {
    const ids = pendingDelete;
    if (!ids) return;
    await run(async () => {
      if (ids.length === 1) await sysUserApi.remove(ids[0]);
      else await sysUserApi.batchDelete(ids);
      setPendingDelete(null);
      reset();
      setNotice(t('sys.users.deleted'));
      await refresh();
    });
  }

  async function pageChanged(page: number) {
    const next = { ...queryRef.current, page };
    setQuery(next);
    await run(() => refresh(next));
  }

  async function search() {
    const next = { ...queryRef.current, page: 1 };
    setQuery(next);
    await run(() => refresh(next));
  }

  function chooseCsv(event: ChangeEvent<HTMLInputElement>) {
    setCsvFile(event.target.files?.[0] ?? null);
    setImportResult(null);
  }

  async function importCsv(validate: boolean) {
    if (!csvFile) {
      setError(t('csv.chooseFirst'));
      return;
    }
    const file = csvFile;
    await run(async () => {
      const result = await sysUserApi.import(file, validate);
      setImportResult(result);
      if (!validate) {
        setNotice(t('csv.imported', { count: result.count }));
        setCsvFile(null);
        await refresh();
      }
    });
  }

  return (
    <div id="sys-users">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('sys.users.eyebrow')}</p>
          <h1>{t('sys.users.title')}</h1>
          <p>{t('sys.users.description')}</p>
        </div>
        <Button disabled={busy} onClick={() => void run(() => refresh())}>
          {t('common.refresh')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="error-banner">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">{t('common.working')}</p> : null}
      <section className="filter-panel">
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Input
            id="filter-username"
            value={query.username}
            placeholder={t('sys.users.filterUsername')}
            aria-label={t('sys.users.filterUsername')}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                username: event.target.value,
              }))
            }
          />
          <select
            id="filter-role"
            value={query.roleCode}
            aria-label={t('sys.users.filterRole')}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                roleCode: event.target.value,
              }))
            }
          >
            <option value="">{t('sys.users.filterRole')}</option>
            {roles.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            id="filter-enabled"
            value={query.enabled}
            aria-label={t('sys.users.filterEnabled')}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                enabled: event.target.value,
              }))
            }
          >
            <option value="">{t('sys.users.filterEnabled')}</option>
            <option value="true">{t('sys.status.enabled')}</option>
            <option value="false">{t('sys.status.disabled')}</option>
          </select>
          <Button htmlType="submit" disabled={busy}>
            {t('common.search')}
          </Button>
        </form>
      </section>
      {admin ? (
        <section className="editor">
          <h2>
            {editId === null ? t('sys.users.create') : t('sys.users.edit')}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="title-field">
              <label htmlFor="user-username">{t('sys.users.username')}</label>
              <Input
                id="user-username"
                value={username}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="user-display-name">
                {t('sys.users.displayName')}
              </label>
              <Input
                id="user-display-name"
                value={displayName}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="user-role">{t('sys.users.role')}</label>
              <select
                id="user-role"
                value={roleCode}
                disabled={busy}
                aria-label={t('sys.users.roleOptions')}
                onChange={(event) => setRoleCode(event.target.value)}
              >
                <option value="" disabled>
                  {t('sys.users.role')}
                </option>
                {roles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Checkbox
              id="user-enabled"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            >
              {t('sys.users.enabled')}
            </Checkbox>
            <Button type="primary" htmlType="submit" disabled={busy}>
              {editId === null ? t('sys.users.create') : t('sys.users.save')}
            </Button>
            {editId !== null ? (
              <Button disabled={busy} onClick={reset}>
                {t('common.cancel')}
              </Button>
            ) : null}
          </form>
        </section>
      ) : null}
      <section className="task-panel">
        <div className="panel-heading">
          <h2>
            {t('sys.users.title')}{' '}
            <Tag>{t('sys.users.total', { count: total })}</Tag>
          </h2>
          {admin ? (
            <div className="toolbar">
              <Button
                danger
                disabled={busy || selected.length === 0}
                onClick={() => setPendingDelete([...selected])}
              >
                {t('sys.users.deleteSelected')}
              </Button>
            </div>
          ) : null}
        </div>
        {!busy && records.length === 0 ? (
          <p className="empty-state">{t('sys.users.empty')}</p>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th />
                <th>{t('sys.users.username')}</th>
                <th>{t('sys.users.displayName')}</th>
                <th>{t('sys.users.role')}</th>
                <th>{t('sys.users.enabled')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="user-row">
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(record.id)}
                      disabled={busy || !admin}
                      aria-label={record.username}
                      onChange={() => toggleSelected(record.id)}
                    />
                  </td>
                  <td>{record.username}</td>
                  <td>{record.displayName}</td>
                  <td>{record.roleCode}</td>
                  <td>
                    <Tag color={record.enabled ? 'success' : 'warning'}>
                      {record.enabled
                        ? t('sys.status.enabled')
                        : t('sys.status.disabled')}
                    </Tag>
                  </td>
                  <td className="row-actions">
                    {admin ? (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => edit(record)}
                      >
                        {t('sys.actions.edit')}
                      </Button>
                    ) : null}
                    {admin ? (
                      <Button
                        size="small"
                        danger
                        disabled={busy}
                        onClick={() => setPendingDelete([record.id])}
                      >
                        {t('sys.actions.delete')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination
          current={query.page}
          pageSize={query.pageSize}
          total={total}
          disabled={busy}
          onChange={(page) => void pageChanged(page)}
        />
        {pendingDelete ? (
          <div
            className="inline-dialog"
            role="dialog"
            aria-label={t('sys.users.deleteConfirmTitle')}
          >
            <p>
              {t('sys.users.deleteConfirm', { count: pendingDelete.length })}
            </p>
            <Button danger disabled={busy} onClick={() => void remove()}>
              {t('sys.users.confirmDelete')}
            </Button>
            <Button disabled={busy} onClick={() => setPendingDelete(null)}>
              {t('sys.users.cancelDelete')}
            </Button>
          </div>
        ) : null}
      </section>
      {admin ? (
        <section className="transfer-panel">
          <h2>{t('csv.title')}</h2>
          <p>{t('csv.description')}</p>
          <div className="toolbar">
            <Button
              disabled={busy}
              onClick={() => void run(() => sysUserApi.template())}
            >
              {t('csv.template')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void run(() => sysUserApi.export(query))}
            >
              {t('csv.export')}
            </Button>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              aria-label={t('csv.choose')}
              onChange={chooseCsv}
            />
            <Button disabled={busy} onClick={() => void importCsv(true)}>
              {t('csv.validate')}
            </Button>
            <Button
              type="primary"
              disabled={busy || !importResult?.valid || !csvFile}
              onClick={() => void importCsv(false)}
            >
              {t('csv.confirm')}
            </Button>
          </div>
          {importResult ? (
            <div>
              <p>{t('csv.validRows', { count: importResult.count })}</p>
              <ul>
                {importResult.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
