import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './routes';
import { isApp, listenForAppLinks } from './shared/native';
import './shared/styles/base.css';

const theme = localStorage.getItem('qroove:theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
// Inside the Android app (ADR 0029): app-only styling hooks and links that open the app.
if (isApp()) document.documentElement.dataset.app = 'android';
void listenForAppLinks().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
);
