import React from 'react';
import type { Step } from '../types/app';
import type { CRMProfile } from '../services/CoachCRMService';

interface AppHeaderProps {
    activeSport: 'tennis';
    step: Step;
    setStep: (s: Step) => void;
    account: CRMProfile | null;
    onStartAnalysis: () => void;
    onOpenAdmin: () => void;
    language: 'en' | 'zh';
    onToggleLanguage: () => void;
}

export function AppHeader({
    activeSport,
    step,
    setStep,
    account,
    onStartAnalysis,
    onOpenAdmin,
    language,
    onToggleLanguage,
}: AppHeaderProps) {
    return (
        <aside className="app-rail" aria-label="Application navigation">
            <div className="app-rail-brand">
                <button
                    onClick={() => setStep('welcome')}
                    className="app-rail-logo"
                    title="Open workspace"
                >
                    <img
                        src="/images/NT_logo.png"
                        alt="Nice Tennis"
                        className="h-9 w-auto object-contain"
                    />
                </button>
            </div>
            <nav className="app-rail-nav">
                <button type="button" data-active={step === 'welcome'} onClick={() => setStep('welcome')}>{language === 'zh' ? '工作台' : 'Workspace'}</button>
                <button type="button" data-active={step === 'reference'} onClick={onStartAnalysis}>{language === 'zh' ? '分析' : 'Analyze'}</button>
                <button type="button" data-active={step === 'admin'} onClick={onOpenAdmin}>{language === 'zh' ? '资料库' : 'Library'}</button>
            </nav>
            <div className="app-rail-account">
                <span className="app-rail-avatar">{account?.full_name?.[0]?.toUpperCase() ?? '?'}</span>
                <div>
                    <strong title={account?.full_name ?? 'Not signed in'}>{account?.full_name ?? 'Not signed in'}</strong>
                    <small>{account?.role ?? 'Account'}</small>
                </div>
                <button type="button" className="app-language-toggle" onClick={onToggleLanguage} aria-label={language === 'zh' ? 'Switch to English' : '切换至中文'}>{language === 'zh' ? 'EN' : '中'}</button>
            </div>
        </aside>
    );
}
