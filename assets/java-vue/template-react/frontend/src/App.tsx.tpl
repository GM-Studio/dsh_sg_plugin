import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfigProvider } from 'antd';
import { Outlet } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import LoginPage from './views/LoginPage';
import { AuthProvider } from './auth/AuthContext';
import { authApi } from './api/auth';
import { ApiError } from './api/request';
import type { User } from './api/types';
import { i18n, setLocale, type AppLocale } from './i18n';

function describeError(cause: unknown): string {
  const base =
    cause instanceof Error ? cause.message : i18n.t('error.unexpected');
  if (cause instanceof ApiError && cause.traceId) {
    return `${base} (${i18n.t('error.trace')}: ${cause.traceId})`;
  }
  return base;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    function expired() {
      setUser(null);
    }
    window.addEventListener('session-expired', expired);
    void run(async () => {
      try {
        setUser(await authApi.me());
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          return;
        }
        throw cause;
      }
    });
    return () => window.removeEventListener('session-expired', expired);
  }, [run]);

  const login = useCallback(
    async (username: string, password: string) => {
      await run(async () => {
        setUser(await authApi.login(username, password));
      });
    },
    [run],
  );

  const logout = useCallback(async () => {
    await run(async () => {
      await authApi.logout();
      setUser(null);
    });
  }, [run]);

  const toggleLocale = useCallback(() => {
    const next: AppLocale = i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN';
    setLocale(next);
  }, []);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      {user ? (
        <AuthProvider user={user}>
          <AppLayout
            username={user.username}
            role={user.role}
            busy={busy}
            onLogout={logout}
            onToggleLocale={toggleLocale}
          >
            <Outlet />
          </AppLayout>
        </AuthProvider>
      ) : (
        <LoginPage busy={busy} error={error} onSubmit={login} />
      )}
    </ConfigProvider>
  );
}
