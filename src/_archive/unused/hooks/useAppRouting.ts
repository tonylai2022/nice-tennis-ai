import { useCallback, useEffect, useState } from 'react';
import type { SkillType, SportType, Step } from '../types/app';

export const DEFAULT_SPORT: SportType = 'tennis';

export type AppPath =
    | '/'
    | '/login'
    | '/dashboard'
    | `/dashboard/${string}`
    | '/analysis'
    | '/analysis/compare'
    | '/analysis/feedback'
    | '/live-coaching'
    | '/library'
    | '/settings';

export function normalizePathname(pathname: string): string {
    if (!pathname) return '/';
    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return normalized.length > 1 && normalized.endsWith('/')
        ? normalized.slice(0, -1)
        : normalized;
}

export function parseRoute(pathname: string): { pathname: AppPath; step: Step; showSettings: boolean } {
    const normalized = normalizePathname(pathname).toLowerCase();
    if (normalized === '/') return { pathname: '/', step: 'welcome', showSettings: false };
    if (normalized === '/login') return { pathname: '/login', step: 'welcome', showSettings: false };
    if (normalized === '/library') return { pathname: '/library', step: 'admin', showSettings: false };
    if (normalized === '/analysis') return { pathname: '/analysis', step: 'reference', showSettings: false };
    if (normalized === '/analysis/compare') return { pathname: '/analysis/compare', step: 'compare', showSettings: false };
    if (normalized === '/analysis/feedback') return { pathname: '/analysis/feedback', step: 'feedback', showSettings: false };
    if (normalized === '/live-coaching') return { pathname: '/live-coaching', step: 'welcome', showSettings: false };
    if (normalized === '/settings') return { pathname: '/settings', step: 'welcome', showSettings: true };
    if (normalized === '/dashboard' || normalized.startsWith('/dashboard/')) {
        return { pathname: normalized as AppPath, step: 'welcome', showSettings: false };
    }
    return { pathname: '/', step: 'welcome', showSettings: false };
}

const STEP_PATHS: Record<Step, AppPath> = {
    welcome: '/dashboard',
    admin: '/library',
    reference: '/analysis',
    user: '/analysis',
    compare: '/analysis/compare',
    feedback: '/analysis/feedback',
};

export interface AppRoutingState {
    pathname: AppPath;
    sport: SportType;
    step: Step;
    setStep: (step: Step) => void;
    motionType: SkillType;
    setMotionType: (motionType: SkillType) => void;
    showSettings: boolean;
    setShowSettings: (show: boolean) => void;
    activeSport: SportType;
    navigate: (pathname: AppPath, replace?: boolean) => void;
    resetNavState: () => void;
}

export function useAppRouting(): AppRoutingState {
    const initialRoute = parseRoute(window.location.pathname);
    const [pathname, setPathname] = useState<AppPath>(initialRoute.pathname);
    const [stepState, setStepState] = useState<Step>(initialRoute.step);
    const [motionType, setMotionType] = useState<SkillType>('serve');
    const [showSettingsState, setShowSettingsState] = useState(initialRoute.showSettings);

    const applyRoute = useCallback((nextPathname: string) => {
        const route = parseRoute(nextPathname);
        setPathname(route.pathname);
        setStepState(route.step);
        setShowSettingsState(route.showSettings);
    }, []);

    const navigate = useCallback((nextPathname: AppPath, replace = false) => {
        const method = replace ? 'replaceState' : 'pushState';
        window.history[method]({}, '', `${nextPathname}${window.location.search}${window.location.hash}`);
        applyRoute(nextPathname);
    }, [applyRoute]);

    useEffect(() => {
        const normalized = normalizePathname(window.location.pathname);
        const route = parseRoute(normalized);
        if (route.pathname !== normalized) {
            window.history.replaceState({}, '', `${route.pathname}${window.location.search}${window.location.hash}`);
        }
        const handlePopState = () => applyRoute(window.location.pathname);
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [applyRoute]);

    const setStep = useCallback((nextStep: Step) => {
        setStepState(nextStep);
        const nextPathname = STEP_PATHS[nextStep];
        if (normalizePathname(window.location.pathname) !== nextPathname) {
            window.history.pushState({}, '', `${nextPathname}${window.location.search}${window.location.hash}`);
            setPathname(nextPathname);
        }
        setShowSettingsState(false);
    }, []);

    const setShowSettings = useCallback((show: boolean) => {
        if (show) navigate('/settings');
        else navigate('/dashboard');
    }, [navigate]);

    const resetNavState = useCallback(() => {
        setShowSettingsState(false);
        setStep('welcome');
    }, [setStep]);

    return {
        pathname,
        sport: DEFAULT_SPORT,
        step: stepState,
        setStep,
        motionType,
        setMotionType,
        showSettings: showSettingsState,
        setShowSettings,
        activeSport: DEFAULT_SPORT,
        navigate,
        resetNavState,
    };
}