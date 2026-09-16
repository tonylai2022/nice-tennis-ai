import React from 'react';
import { AdminVideoUpload } from './AdminVideoUpload';
import { CalibrationService, StrokeType } from '../services/CalibrationService';

interface AdminPanelProps {
    adminSubView: 'main' | 'training';
    setAdminSubView: (v: 'main' | 'training') => void;
    adminRefreshKey: number;
    setAdminRefreshKey: React.Dispatch<React.SetStateAction<number>>;
    onBack: () => void;
    onOpenCalibration: (opts: { strokeType: StrokeType }) => void;
}

const TENNIS_SKILLS: { key: StrokeType; label: string }[] = [
    { key: 'forehand', label: 'Forehand' },
    { key: 'backhand', label: 'Backhand' },
    { key: 'serve', label: 'Serve' },
    { key: 'volley', label: 'Volley' },
    { key: 'overhead', label: 'Overhead' },
];

function SkillCard({
    skill,
    label,
    onTrain,
}: {
    skill: StrokeType;
    label: string;
    onTrain: () => void;
}) {
    const ready = CalibrationService.hasEnoughExamples(skill);
    const total = Object.values(CalibrationService.getExampleCounts(skill)).reduce(
        (a, b) => a + b,
        0,
    );
    return (
        <div
            className={`rounded-lg border p-3 flex flex-col gap-2 ${ready
                ? 'border-emerald-500/40 bg-emerald-500/5'
                : 'border-slate-700 bg-slate-800/50'
                }`}
        >
            <div className="flex items-center justify-between gap-1 flex-wrap">
                <span className="text-sm font-medium text-white">{label}</span>
                {ready ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                        ✓ Ready
                    </span>
                ) : (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">
                        {total} eg
                    </span>
                )}
            </div>
            <button
                className="w-full px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white transition-colors"
                onClick={onTrain}
            >
                🎯 Train
            </button>
        </div>
    );
}

export function AdminPanel({
    adminSubView,
    setAdminSubView,
    adminRefreshKey,
    setAdminRefreshKey,
    onBack,
    onOpenCalibration,
}: AdminPanelProps) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <button
                    onClick={adminSubView === 'training' ? () => setAdminSubView('main') : onBack}
                    className="btn btn-secondary text-sm justify-center"
                >
                    ← {adminSubView === 'training' ? 'Back to Admin' : 'Back to Main'}
                </button>
                <h1 className="text-xl font-bold text-white">
                    {adminSubView === 'training' ? 'Phase Training' : 'Admin Management'}
                </h1>
                <div className="w-32" />
            </div>

            {adminSubView === 'main' && (
                <>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setAdminSubView('training')}
                            className="btn btn-secondary flex items-center gap-2"
                        >
                            🎯 Phase Training
                        </button>
                    </div>
                    <AdminVideoUpload
                        key={adminRefreshKey}
                        onUploadComplete={() => setAdminRefreshKey(k => k + 1)}
                    />
                </>
            )}

            {adminSubView === 'training' && (
                <div className="card">
                    <div className="mb-5">
                        <p className="text-sm text-slate-400">
                            Upload videos to{' '}
                            <code className="text-emerald-400 bg-slate-800 px-1 rounded">
                                trainingvideolib
                            </code>{' '}
                            and mark phase frames to train the AI phase detector. Aim for ≥1 example per
                            phase per skill.
                        </p>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-xs uppercase tracking-[0.08em] text-emerald-400 font-medium mb-3">
                            Tennis
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {TENNIS_SKILLS.map(({ key, label }) => (
                                <SkillCard
                                    key={key}
                                    skill={key}
                                    label={label}
                                    onTrain={() => onOpenCalibration({ strokeType: key })}
                                />
                            ))}
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}
