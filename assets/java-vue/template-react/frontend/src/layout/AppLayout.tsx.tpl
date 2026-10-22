import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

export interface AppLayoutProps {
  username: string;
  role: string;
  busy: boolean;
  onLogout: () => void;
  onToggleLocale: () => void;
  children?: ReactNode;
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link active' : 'nav-link';
}

export default function AppLayout({
  username,
  role,
  busy,
  onLogout,
  onToggleLocale,
  children,
}: AppLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="admin-shell">
      <aside className="sidebar" aria-label={t('navigation.ariaLabel')}>
        <a className="brand" href="#/dashboard">
          <b className="brand-mark">S</b>
          {t('common.appName')}
        </a>
        <p className="nav-label">{t('navigation.workspace')}</p>
        <NavLink className={navClass} to="/dashboard">
          ◱ {t('navigation.dashboard')}
        </NavLink>
        <p className="nav-label">{t('sys.navigation.section')}</p>
        <NavLink className={navClass} to="/sys/roles">
          ◇ {t('sys.navigation.roles')}
        </NavLink>
        <NavLink className={navClass} to="/sys/users">
          ◈ {t('sys.navigation.users')}
        </NavLink>
        <NavLink className={navClass} to="/sys/departments">
          ◫ {t('sys.navigation.departments')}
        </NavLink>
        <NavLink className={navClass} to="/sys/menus">
          ◰ {t('sys.navigation.menus')}
        </NavLink>
        <NavLink className={navClass} to="/sys/audits">
          ◍ {t('sys.navigation.audits')}
        </NavLink>
        <div className="sidebar-note">{t('navigation.note')}</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>{t('navigation.breadcrumb')}</span>
          <div>
            <Tag>
              {username} · {role}
            </Tag>
            <Button disabled={busy} onClick={onToggleLocale}>
              {t('language.switch')}
            </Button>
            <Button disabled={busy} onClick={onLogout}>
              {t('navigation.logout')}
            </Button>
          </div>
        </header>
        <main>
          {children}
          <footer>
            {t('footer.product')}
            <span>{t('footer.stack')}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
