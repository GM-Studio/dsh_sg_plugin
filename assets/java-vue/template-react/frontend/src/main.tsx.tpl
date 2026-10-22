import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import './style.css';
import { i18n } from './i18n';
import { createAppRouter } from './router';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing');
}

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ConfigProvider>
        <RouterProvider router={createAppRouter()} />
      </ConfigProvider>
    </I18nextProvider>
  </StrictMode>,
);
