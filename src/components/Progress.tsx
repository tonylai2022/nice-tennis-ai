import React from 'react';
import type { Step } from '../types/app';

const steps: Array<{ id: Step; label: string; description: string }> = [
    { id: 'welcome', label: 'Welcome', description: 'Overview and flow' },
    { id: 'reference', label: 'Reference Video', description: 'Upload the pro clip' },
    { id: 'user', label: 'Your Attempt', description: 'Upload or capture your video' },
    { id: 'compare', label: 'Compare', description: 'Side-by-side or overlay' },
    { id: 'feedback', label: 'Feedback', description: 'AI coaching summary' },
];

export function Progress({ step }: { step: Step }) {
    // Show admin step separately when in admin mode
    if (step === 'admin') {
        return (
            <div className="mb-6 sm:mb-8">
                <div className="card px-4 py-3 bg-accent/10 border-accent/30">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-slate-900 text-sm font-semibold">
                            !
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-accent">Admin Mode</p>
                            <p className="text-xs text-accent/80">Upload reference videos</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const activeIndex = steps.findIndex((s) => s.id === step);

    return (
        <div className="mb-6 sm:mb-8">
            {/* Mobile: Horizontal scrollable steps */}
            <div className="flex gap-2 overflow-x-auto pb-2 sm:hidden scrollbar-hide snap-x snap-mandatory">
                {steps.map((item, idx) => {
                    const isActive = idx === activeIndex;
                    const isDone = idx < activeIndex;
                    return (
                        <div
                            key={item.id}
                            className={`flex-shrink-0 snap-start flex items-center gap-2 rounded-full px-3 py-2 transition-all ${isActive
                                ? 'bg-accent/20 border border-accent/50'
                                : isDone
                                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                                    : 'bg-slate-800/50 border border-slate-700/50'
                                }`}
                        >
                            <div
                                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${isDone
                                    ? 'bg-emerald-500 text-slate-900'
                                    : isActive
                                        ? 'bg-accent text-slate-900'
                                        : 'bg-slate-700 text-slate-400'
                                    }`}
                            >
                                {isDone ? '✓' : idx + 1}
                            </div>
                            <span className={`text-xs font-medium whitespace-nowrap ${isActive ? 'text-white' : isDone ? 'text-emerald-300' : 'text-slate-400'
                                }`}>
                                {item.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Desktop: Grid layout */}
            <div className="hidden sm:grid grid-cols-5 gap-3">
                {steps.map((item, idx) => {
                    const isActive = idx === activeIndex;
                    const isDone = idx < activeIndex;
                    return (
                        <div
                            key={item.id}
                            className={`card px-4 py-3 transition-colors ${isActive ? 'border-accent/70' : ''} ${isDone ? 'opacity-100' : 'opacity-80'}`}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${isDone ? 'bg-emerald-500 text-slate-900' : isActive ? 'bg-accent text-slate-900' : 'bg-slate-800 text-slate-300'
                                        }`}
                                >
                                    {isDone ? '✓' : idx + 1}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-white">{item.label}</p>
                                    <p className="text-xs text-slate-400">{item.description}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
