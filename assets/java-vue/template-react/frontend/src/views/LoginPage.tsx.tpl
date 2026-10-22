import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from 'antd';
import { useTranslation } from 'react-i18next';

export interface LoginPageProps {
  busy: boolean;
  error: string;
  onSubmit: (username: string, password: string) => void | Promise<void>;
}

export default function LoginPage({ busy, error, onSubmit }: LoginPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(username, password);
  }

  return (
    <div className="login-shell">
      <Card className="login-card">
        <p className="eyebrow">{t('login.eyebrow')}</p>
        <h1>{t('login.title')}</h1>
        <p>{t('login.description')}</p>
        <form onSubmit={submit}>
          <label htmlFor="username">{t('login.username')}</label>
          <Input
            id="username"
            autoComplete="username"
            disabled={busy}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="password">{t('login.password')}</label>
          <Input.Password
            id="password"
            autoComplete="current-password"
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="primary" htmlType="submit" disabled={busy}>
            {t('login.submit')}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="error-banner">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
