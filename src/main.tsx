import './lib/wasmCompat';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { swManager } from './services/serviceWorkerManager';
import './index.css';

const isMobileBrowser = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const mobileDiagnosticKey = 'motionTutor.mobileDiagnostics';
const mobileDiagnosticLog = (stage: string, detail?: unknown) => {
  if (!isMobileBrowser) return;

  const message = detail instanceof Error
    ? `${detail.name}: ${detail.message}`
    : typeof detail === 'string'
      ? detail
      : detail ? String(detail) : '';
  const entry = `[${new Date().toISOString()}] ${stage}${message ? ` | ${message}` : ''}`;
  console.log('[MobileDiagnostic]', entry);

  try {
    const previous = JSON.parse(sessionStorage.getItem(mobileDiagnosticKey) ?? '[]');
    const history = Array.isArray(previous) ? previous.slice(-19) : [];
    history.push(entry);
    sessionStorage.setItem(mobileDiagnosticKey, JSON.stringify(history));
  } catch {
    // Diagnostics must never interfere with the coaching experience.
  }
};

(window as any).__motionTutorMobileLog = mobileDiagnosticLog;
if (isMobileBrowser) {
  try {
    const previousDiagnostics = JSON.parse(sessionStorage.getItem(mobileDiagnosticKey) ?? '[]');
    if (Array.isArray(previousDiagnostics) && previousDiagnostics.length > 0) {
      console.log('[MobileDiagnostic] Previous app trace', previousDiagnostics);
    }
  } catch {
    // Diagnostics must never interfere with app boot.
  }
}
mobileDiagnosticLog('App booted');

// Some browser extensions occasionally trigger an unhandled rejection with this message.
// It's not emitted by our app logic, but it can confuse debugging.
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  try {
    const reason: any = (event as any).reason;
    const message = typeof reason === 'string' ? reason : (reason?.message ?? '');
    if (
      typeof message === 'string' &&
      message.includes('A listener indicated an asynchronous response') &&
      message.includes('message channel closed before a response was received')
    ) {
      event.preventDefault();
      return;
    }
    if (typeof message === 'string' && message.includes("Cannot read properties of undefined (reading 'M_ID')")) {
      event.preventDefault();
      return;
    }
    mobileDiagnosticLog('Unhandled promise rejection', reason);
  } catch {
    // ignore
  }
});

window.addEventListener('error', (event: ErrorEvent) => {
  mobileDiagnosticLog('Uncaught browser error', event.error ?? event.message);
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// Production owns the offline cache. In development it can retain stale Vite
// HTML and HMR tokens across server restarts, so remove any prior registration.
if (import.meta.env.PROD) {
  swManager.register();
} else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister())),
  );
  if ('caches' in window) {
    void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <PwaInstallPrompt />
  </React.StrictMode>
);
