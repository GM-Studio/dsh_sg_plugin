import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Input, Pagination, Tag } from 'antd';
import { sysRoleApi } from '../../api/sys';
import type { SysRole } from '../../api/sys';
import type { ImportResult } from '../../api/types';
import { ApiError } from '../../api/request';
import { useAuth } from '../../auth/AuthContext';

interface RoleQuery {
  page: number;
  pageSize: number;
  code: string;
  name: string;
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

export default function RolesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const [records, setRecords] = useState<SysRole[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<RoleQuery>({
    page: 1,
    pageSize: 20,
    code: '',
    name: '',
  });
  const queryRef = useRef(query);
  queryRef.current = query;
  const [editId, setEditId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const refresh = useCallback(async (next?: RoleQuery) => {
    const page = await sysRoleApi.list(next ?? queryRef.current);
    setRecords(page.records);
    setTotal(page.total);
  }, []);

  const reset = useCallback(() => {
    setEditId(null);
    setCode('');
    setName('');
    setDescription('');
    setEnabled(true);
  }, []);

  useEffect(() => {
    void run(() => refresh());
  }, [run, refresh]);

  function edit(role: SysRole) {
    setEditId(role.id);
    setCode(role.code);
    setName(role.name);
    setDescription(role.description);
    setEnabled(role.enabled);
  }

  async function save() {
    if (!code.trim() || !name.trim()) {
      setError(t('sys.roles.validation'));
      return;
    }
    await run(async () => {
      const body = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim(),
        enabled,
      };
      if (editId === null) await sysRoleApi.create(body);
      else await sysRoleApi.update({ ...body, id: editId });
      reset();
      setNotice(t('sys.roles.created'));
      await refresh();
    });
  }

  async function remove() {
    const id = pendingDelete;
    if (id === null) return;
    await run(async () => {
      await sysRoleApi.remove(id);
      setPendingDelete(null);
      reset();
      setNotice(t('sys.roles.deleted'));
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
      const result = await sysRoleApi.import(file, validate);
      setImportResult(result);
      if (!validate) {
        setNotice(t('csv.imported', { count: result.count }));
        setCsvFile(null);
        await refresh();
      }
    });
  }

  return (
    <div id="sys-roles">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('sys.roles.eyebrow')}</p>
          <h1>{t('sys.roles.title')}</h1>
          <p>{t('sys.roles.description')}</p>
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
            id="filter-role-code"
            value={query.code}
            placeholder={t('sys.roles.code')}
            aria-label={t('sys.roles.code')}
            onChange={(event) =>
              setQuery((current) => ({ ...current, code: event.target.value }))
            }
          />
          <Input
            id="filter-role-name"
            value={query.name}
            placeholder={t('sys.roles.name')}
            aria-label={t('sys.roles.name')}
            onChange={(event) =>
              setQuery((current) => ({ ...current, name: event.target.value }))
            }
          />
          <Button htmlType="submit" disabled={busy}>
            {t('common.search')}
          </Button>
        </form>
      </section>
      {admin ? (
        <section className="editor">
          <h2>
            {editId === null ? t('sys.roles.create') : t('sys.roles.edit')}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="title-field">
              <label htmlFor="role-code">{t('sys.roles.code')}</label>
              <Input
                id="role-code"
                value={code}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="role-name">{t('sys.roles.name')}</label>
              <Input
                id="role-name"
                value={name}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="role-description">
                {t('sys.roles.descriptionField')}
              </label>
              <Input
                id="role-description"
                value={description}
                maxLength={255}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <Checkbox
              id="role-enabled"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            >
              {t('sys.roles.enabled')}
            </Checkbox>
            <Button type="primary" htmlType="submit" disabled={busy}>
              {editId === null ? t('sys.roles.create') : t('sys.roles.save')}
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
            {t('sys.roles.title')}{' '}
            <Tag>{t('sys.roles.total', { count: total })}</Tag>
          </h2>
        </div>
        {!busy && records.length === 0 ? (
          <p className="empty-state">{t('sys.roles.empty')}</p>
        ) : (
          <table className="role-table">
            <thead>
              <tr>
                <th>{t('sys.roles.code')}</th>
                <th>{t('sys.roles.name')}</th>
                <th>{t('sys.roles.descriptionField')}</th>
                <th>{t('sys.roles.enabled')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map((role) => (
                <tr key={role.id} className="role-row">
                  <td>{role.code}</td>
                  <td>{role.name}</td>
                  <td>{role.description}</td>
                  <td>
                    <Tag color={role.enabled ? 'success' : 'warning'}>
                      {role.enabled
                        ? t('sys.status.enabled')
                        : t('sys.status.disabled')}
                    </Tag>
                  </td>
                  <td className="row-actions">
                    {admin ? (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => edit(role)}
                      >
                        {t('sys.actions.edit')}
                      </Button>
                    ) : null}
                    {admin ? (
                      <Button
                        size="small"
                        danger
                        disabled={busy}
                        onClick={() => setPendingDelete(role.id)}
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
        {pendingDelete !== null ? (
          <div
            className="inline-dialog"
            role="dialog"
            aria-label={t('sys.roles.deleteConfirmTitle')}
          >
            <p>{t('sys.roles.deleteConfirm', { count: 1 })}</p>
            <Button danger disabled={busy} onClick={() => void remove()}>
              {t('sys.roles.confirmDelete')}
            </Button>
            <Button disabled={busy} onClick={() => setPendingDelete(null)}>
              {t('sys.roles.cancelDelete')}
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
              onClick={() => void run(() => sysRoleApi.template())}
            >
              {t('csv.template')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void run(() => sysRoleApi.export(query))}
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
