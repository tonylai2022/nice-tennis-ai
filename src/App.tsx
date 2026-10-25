import React, { useCallback, useEffect, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { CoachCRMHome } from './components/CoachCRMHome';
import { NotFoundPage } from './components/NotFoundPage';
import { coachCRMService, type CRMProfile } from './services/CoachCRMService';

const isDashboardPath = (pathname: string) =>
  pathname === '/dashboard' || pathname.startsWith('/dashboard/');

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  const isKnownPath = pathname === '/' || pathname === '/login' || isDashboardPath(pathname) || pathname === '/tennis';

  if (!isKnownPath) return <NotFoundPage />;
  if (pathname === '/tennis') return <LegacyTennisRedirect />;

  if (isDashboardPath(pathname)) {
    return <RequireAuthentication><TennisApplication /></RequireAuthentication>;
  }

  return <TennisApplication />;
}

function LegacyTennisRedirect() {
  useEffect(() => {
    window.location.replace(`/${window.location.search}${window.location.hash}`);
  }, []);

  return null;
}

function RequireAuthentication({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'redirecting'>('checking');

  useEffect(() => {
    let active = true;

    if (!coachCRMService.isConfigured()) {
      setStatus('redirecting');
      window.location.replace('/login');
      return;
    }

    const unsubscribe = coachCRMService.onAuthStateChange((session) => {
      if (!active) return;
      if (session) setStatus('authenticated');
      else {
        setStatus('redirecting');
        window.location.replace('/login');
      }
    });

    const verifySession = async () => {
      try {
        const session = await coachCRMService.getSession();
        if (!active) return;
        if (session) setStatus('authenticated');
        else {
          setStatus('redirecting');
          window.location.replace('/login');
        }
      } catch {
        if (!active) return;
        setStatus('redirecting');
        window.location.replace('/login');
      }
    };

    void verifySession();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (status === 'authenticated') return <>{children}</>;

  return (
    <main className="auth-gate" aria-label={status === 'checking' ? 'Checking session' : 'Opening sign in'}>
      <span className="crm-loader" />
      <p>{status === 'checking' ? 'Checking your session' : 'Opening sign in'}</p>
    </main>
  );
}

function TennisApplication() {
  const [crmAccount, setCrmAccount] = useState<CRMProfile | null>(null);
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    localStorage.getItem('motionTutor.language') === 'zh' ? 'zh' : 'en',
  );

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => {
      const next = current === 'en' ? 'zh' : 'en';
      localStorage.setItem('motionTutor.language', next);
      return next;
    });
  }, []);

  const handleAccountChange = useCallback((account: CRMProfile | null) => {
    setCrmAccount(account);
    const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/';
    if (account && pathname === '/login') {
      window.history.replaceState({}, '', `/dashboard${window.location.search}${window.location.hash}`);
    }
    if (!account && isDashboardPath(pathname)) window.location.replace('/login');
  }, []);

  return (
    <div className="min-h-screen">
    {isDashboardPath(window.location.pathname.replace(/\/+$/, '').toLowerCase()) && (
      <AppHeader account={crmAccount} language={language} onToggleLanguage={toggleLanguage} />
    )}
    <CoachCRMHome
        onAccountChange={handleAccountChange}
        language={language}
        onToggleLanguage={toggleLanguage}
      />
    </div>
  );
}
