import React from 'react';
import type { CRMProfile } from '../services/CoachCRMService';

interface AppHeaderProps {
    account: CRMProfile | null;
    language: 'en' | 'zh';
    onToggleLanguage: () => void;
}

export function AppHeader({
    account,
    language,
    onToggleLanguage,
}: AppHeaderProps) {
    return (
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3 text-slate-50 sm:px-6">
            <a href="/dashboard" className="flex items-center gap-3" aria-label="Nice Tennis workspace">
                <img src="/images/NT_logo.png" alt="" className="h-9 w-auto object-contain" />
                <span className="text-sm font-semibold tracking-wide">Nice Tennis</span>
            </a>
            <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                    <strong className="block text-sm" title={account?.full_name ?? 'Not signed in'}>
                        {account?.full_name ?? 'Not signed in'}
                    </strong>
                    <small className="text-xs text-slate-400">{account?.role ?? 'Account'}</small>
                </div>
                <button
                    type="button"
                    className="app-language-toggle"
                    onClick={onToggleLanguage}
                    aria-label={language === 'zh' ? 'Switch to English' : '切换至中文'}
                >
                    {language === 'zh' ? 'EN' : '中'}
                </button>
            </div>
        </header>
    );
}
