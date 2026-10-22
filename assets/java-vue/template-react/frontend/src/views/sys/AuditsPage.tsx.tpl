import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Pagination, Tag } from 'antd';
import { sysAuditApi } from '../../api/sys';
import type { SysAuditLog } from '../../api/sys';
import { ApiError } from '../../api/request';
import { useAuth } from '../../auth/AuthContext';

interface AuditQuery {
  page: number;
  pageSize: number;
  actor: string;
  action: string;
}

function useAsyncAction() {
  const { t } = useTranslation();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
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
  return { busy, error, run };
}

export default function AuditsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const { busy, error, run } = useAsyncAction();
  const [records, setRecords] = useState<SysAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<AuditQuery>({
    page: 1,
    pageSize: 20,
    actor: '',
    action: '',
  });
  const queryRef = useRef(query);
  queryRef.current = query;

  const refresh = useCallback(async (next?: AuditQuery) => {
    const page = await sysAuditApi.list(next ?? queryRef.current);
    setRecords(page.records);
    setTotal(page.total);
  }, []);

  useEffect(() => {
    void run(() => refresh());
  }, [run, refresh]);

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
    <div id="sys-audits" className={admin ? 'is-admin' : undefined}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('sys.audits.eyebrow')}</p>
          <h1>{t('sys.audits.title')}</h1>
          <p>{t('sys.audits.description')}</p>
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
            id="filter-audit-actor"
            value={query.actor}
            placeholder={t('sys.audits.filterActor')}
            aria-label={t('sys.audits.filterActor')}
            onChange={(event) =>
              setQuery((current) => ({ ...current, actor: event.target.value }))
            }
          />
          <Input
            id="filter-audit-action"
            value={query.action}
            placeholder={t('sys.audits.filterAction')}
            aria-label={t('sys.audits.filterAction')}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                action: event.target.value,
              }))
            }
          />
          <Button htmlType="submit" disabled={busy}>
            {t('common.search')}
          </Button>
        </form>
      </section>
      <section className="task-panel">
        <div className="panel-heading">
          <h2>
            {t('sys.audits.title')}{' '}
            <Tag>{t('sys.audits.total', { count: total })}</Tag>
          </h2>
        </div>
        {!busy && records.length === 0 ? (
          <p className="empty-state">{t('sys.audits.empty')}</p>
        ) : (
          <table className="audit-table">
            <thead>
              <tr>
                <th>{t('sys.audits.actor')}</th>
                <th>{t('sys.audits.action')}</th>
                <th>{t('sys.audits.target')}</th>
                <th>{t('sys.audits.detail')}</th>
                <th>{t('sys.audits.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="audit-row">
                  <td>{record.actor}</td>
                  <td>{record.action}</td>
                  <td>{record.target}</td>
                  <td>{record.detail}</td>
                  <td>{record.createdAt}</td>
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
      </section>
    </div>
  );
}
