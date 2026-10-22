import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from 'antd';
import { ApiError } from '../api/request';
import { i18n } from '../i18n';
import { sysDashboardApi, type SysDashboard } from '../api/sys';

export default function DashboardPage() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<SysDashboard | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setSummary(await sysDashboardApi.summary());
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : i18n.t('error.unexpected'),
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div id="dashboard">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('dashboard.eyebrow')}</p>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.description')}</p>
        </div>
        <Button onClick={() => void load()}>{t('common.refresh')}</Button>
      </div>
      {error ? (
        <p role="alert" className="error-banner">
          {error}
        </p>
      ) : null}
      <div className="stats">
        <Card>
          <span>{t('dashboard.users')}</span>
          <strong>{summary?.userCount ?? 0}</strong>
        </Card>
        <Card>
          <span>{t('dashboard.roles')}</span>
          <strong>{summary?.roleCount ?? 0}</strong>
        </Card>
        <Card>
          <span>{t('dashboard.departments')}</span>
          <strong>{summary?.departmentCount ?? 0}</strong>
        </Card>
        <Card>
          <span>{t('dashboard.menus')}</span>
          <strong>{summary?.menuCount ?? 0}</strong>
        </Card>
      </div>
    </div>
  );
}
