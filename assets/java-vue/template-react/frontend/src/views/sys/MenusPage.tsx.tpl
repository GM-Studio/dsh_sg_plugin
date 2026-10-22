import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Input, Pagination, Tag } from 'antd';
import { sysMenuApi } from '../../api/sys';
import type { SysMenu } from '../../api/sys';
import { ApiError } from '../../api/request';
import { useAuth } from '../../auth/AuthContext';

interface MenuQuery {
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

export default function MenusPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const [records, setRecords] = useState<SysMenu[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<MenuQuery>({
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
  const [path, setPath] = useState('');
  const [icon, setIcon] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const refresh = useCallback(async (next?: MenuQuery) => {
    const page = await sysMenuApi.list(next ?? queryRef.current);
    setRecords(page.records);
    setTotal(page.total);
  }, []);

  const reset = useCallback(() => {
    setEditId(null);
    setCode('');
    setName('');
    setPath('');
    setIcon('');
    setSortOrder('0');
    setEnabled(true);
  }, []);

  useEffect(() => {
    void run(() => refresh());
  }, [run, refresh]);

  function edit(record: SysMenu) {
    setEditId(record.id);
    setCode(record.code);
    setName(record.name);
    setPath(record.path);
    setIcon(record.icon);
    setSortOrder(String(record.sortOrder));
    setEnabled(record.enabled);
  }

  async function save() {
    if (!code.trim() || !name.trim()) {
      setError(t('sys.menus.validation'));
      return;
    }
    await run(async () => {
      const body = {
        code: code.trim(),
        name: name.trim(),
        path: path.trim(),
        icon: icon.trim(),
        sortOrder: Number(sortOrder) || 0,
        enabled,
      };
      if (editId === null) await sysMenuApi.create(body);
      else await sysMenuApi.update({ ...body, id: editId });
      reset();
      setNotice(t('sys.menus.created'));
      await refresh();
    });
  }

  async function remove() {
    const id = pendingDelete;
    if (id === null) return;
    await run(async () => {
      await sysMenuApi.remove(id);
      setPendingDelete(null);
      reset();
      setNotice(t('sys.menus.deleted'));
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
    <div id="sys-menus">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('sys.menus.eyebrow')}</p>
          <h1>{t('sys.menus.title')}</h1>
          <p>{t('sys.menus.description')}</p>
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
            id="filter-menu-code"
            value={query.code}
            placeholder={t('sys.menus.filterCode')}
            aria-label={t('sys.menus.filterCode')}
            onChange={(event) =>
              setQuery((current) => ({ ...current, code: event.target.value }))
            }
          />
          <Input
            id="filter-menu-name"
            value={query.name}
            placeholder={t('sys.menus.filterName')}
            aria-label={t('sys.menus.filterName')}
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
            {editId === null ? t('sys.menus.create') : t('sys.menus.edit')}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="title-field">
              <label htmlFor="menu-code">{t('sys.menus.code')}</label>
              <Input
                id="menu-code"
                value={code}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="menu-name">{t('sys.menus.name')}</label>
              <Input
                id="menu-name"
                value={name}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="menu-path">{t('sys.menus.path')}</label>
              <Input
                id="menu-path"
                value={path}
                maxLength={255}
                disabled={busy}
                onChange={(event) => setPath(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="menu-icon">{t('sys.menus.icon')}</label>
              <Input
                id="menu-icon"
                value={icon}
                maxLength={64}
                disabled={busy}
                onChange={(event) => setIcon(event.target.value)}
              />
            </div>
            <div className="title-field">
              <label htmlFor="menu-sort">{t('sys.menus.sortOrder')}</label>
              <Input
                id="menu-sort"
                type="number"
                value={sortOrder}
                disabled={busy}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
            <Checkbox
              id="menu-enabled"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            >
              {t('sys.menus.enabled')}
            </Checkbox>
            <Button type="primary" htmlType="submit" disabled={busy}>
              {editId === null ? t('sys.menus.create') : t('sys.menus.save')}
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
            {t('sys.menus.title')}{' '}
            <Tag>{t('sys.menus.total', { count: total })}</Tag>
          </h2>
        </div>
        {!busy && records.length === 0 ? (
          <p className="empty-state">{t('sys.menus.empty')}</p>
        ) : (
          <table className="menu-table">
            <thead>
              <tr>
                <th>{t('sys.menus.code')}</th>
                <th>{t('sys.menus.name')}</th>
                <th>{t('sys.menus.path')}</th>
                <th>{t('sys.menus.icon')}</th>
                <th>{t('sys.menus.sortOrder')}</th>
                <th>{t('sys.menus.enabled')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="menu-row">
                  <td>{record.code}</td>
                  <td>{record.name}</td>
                  <td>{record.path}</td>
                  <td>{record.icon}</td>
                  <td>{record.sortOrder}</td>
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
            aria-label={t('sys.menus.deleteConfirmTitle')}
          >
            <p>{t('sys.menus.deleteConfirm', { count: 1 })}</p>
            <Button danger disabled={busy} onClick={() => void remove()}>
              {t('sys.menus.confirmDelete')}
            </Button>
            <Button disabled={busy} onClick={() => setPendingDelete(null)}>
              {t('sys.menus.cancelDelete')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
