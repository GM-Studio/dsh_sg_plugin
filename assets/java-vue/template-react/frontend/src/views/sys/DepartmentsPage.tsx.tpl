import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Input, Pagination, Tag } from 'antd';
import { sysDepartmentApi } from '../../api/sys';
import type { SysDepartment, SysOption } from '../../api/sys';
import { ApiError } from '../../api/request';
import { useAuth } from '../../auth/AuthContext';

interface DepartmentQuery {
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

export default function DepartmentsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const [records, setRecords] = useState<SysDepartment[]>([]);
  const [parents, setParents] = useState<SysOption[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<DepartmentQuery>({
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
  const [parentCode, setParentCode] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const refresh = useCallback(async (next?: DepartmentQuery) => {
    const page = await sysDepartmentApi.list(next ?? queryRef.current);
    setRecords(page.records);
    setTotal(page.total);
    setParents(await sysDepartmentApi.options());
  }, []);

  const reset = useCallback(() => {
    setEditId(null);
    setCode('');
    setName('');
    setParentCode('');
    setEnabled(true);
  }, []);

  useEffect(() => {
    void run(() => refresh());
  }, [run, refresh]);

  function edit(record: SysDepartment) {
    setEditId(record.id);
    setCode(record.code);
    setName(record.name);
    setParentCode(record.parentCode ?? '');
    setEnabled(record.enabled);
  }

  async function save() {
    if (!code.trim() || !name.trim()) {
      setError(t('sys.departments.validation'));
      return;
    }
    await run(async () => {
      const body = {
        code: code.trim(),
        name: name.trim(),
        parentCode: parentCode ? parentCode : null,
        enabled,
      };
      if (editId === null) await sysDepartmentApi.create(body);
      else await sysDepartmentApi.update({ ...body, id: editId });
      reset();
      setNotice(t('sys.departments.created'));
      await refresh();
    });
  }

  async function remove() {
    const id = pendingDelete;
    if (id === null) return;
    await run(async () => {
      await sysDepartmentApi.remove(id);
      setPendingDelete(null);
      reset();
      setNotice(t('sys.departments.deleted'));
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

  return (
    <div id="sys-departments">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('sys.departments.eyebrow')}</p>
          <h1>{t('sys.departments.title')}</h1>
          <p>{t('sys.departments.description')}</p>
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
            id="filter-dept-code"
            value={query.code}
            placeholder={t('sys.departments.filterCode')}
            aria-label={t('sys.departments.filterCode')}
            onChange={(event) =>
              setQuery((current) => ({ ...current, code: event.target.value }))
            }
          />
          <Input
            id="filter-dept-name"
            value={query.name}
            placeholder={t('sys.departments.filterName')}
            aria-label={t('sys.departments.filterName')}
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
            {editId === null
              ? t('sys.departments.create')
              : t('sys.departments.edit')}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="title-field">
              <label htmlFor="dept-code">{t('sys.departments.code')}</label>
              <Input
                id="dept-code"
                value={code}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="dept-name">{t('sys.departments.name')}</label>
              <Input
                id="dept-name"
                value={name}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="dept-parent">{t('sys.departments.parent')}</label>
              <select
                id="dept-parent"
                value={parentCode}
                disabled={busy}
                aria-label={t('sys.departments.parent')}
                onChange={(event) => setParentCode(event.target.value)}
              >
                <option value="">{t('sys.departments.parentNone')}</option>
                {parents.map((parent) => (
                  <option key={parent.value} value={parent.value}>
                    {parent.label}
                  </option>
                ))}
              </select>
            </div>
            <Checkbox
              id="dept-enabled"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            >
              {t('sys.departments.enabled')}
            </Checkbox>
            <Button type="primary" htmlType="submit" disabled={busy}>
              {editId === null
                ? t('sys.departments.create')
                : t('sys.departments.save')}
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
            {t('sys.departments.title')}{' '}
            <Tag>{t('sys.departments.total', { count: total })}</Tag>
          </h2>
        </div>
        {!busy && records.length === 0 ? (
          <p className="empty-state">{t('sys.departments.empty')}</p>
        ) : (
          <table className="department-table">
            <thead>
              <tr>
                <th>{t('sys.departments.code')}</th>
                <th>{t('sys.departments.name')}</th>
                <th>{t('sys.departments.parent')}</th>
                <th>{t('sys.departments.enabled')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="department-row">
                  <td>{record.code}</td>
                  <td>{record.name}</td>
                  <td>
                    {record.parentCode || t('sys.departments.parentNone')}
                  </td>
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
                        onClick={() => setPendingDelete(record.id)}
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
            aria-label={t('sys.departments.deleteConfirmTitle')}
          >
            <p>{t('sys.departments.deleteConfirm', { count: 1 })}</p>
            <Button danger disabled={busy} onClick={() => void remove()}>
              {t('sys.departments.confirmDelete')}
            </Button>
            <Button disabled={busy} onClick={() => setPendingDelete(null)}>
              {t('sys.departments.cancelDelete')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
