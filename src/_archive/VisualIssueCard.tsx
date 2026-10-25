import React, { useState } from 'react';
import type { AlignmentIssue } from '../services/MotionAnalysisRouter';
import { PhaseFlipbook } from './PhaseFlipbook';
import { PoseFallbackCanvas } from './PoseFallbackCanvas';

export function VisualIssueCard({
    issue,
    userVideoUrl,
    refVideoUrl,
    motionAll,
    allIssues,
}: {
    issue: AlignmentIssue;
    userVideoUrl: string | null;
    refVideoUrl: string | null;
    motionAll: boolean;
    allIssues: AlignmentIssue[];
}) {
    const [overrideMotion, setOverrideMotion] = useState<boolean | null>(null);
    const showMotion = overrideMotion ?? motionAll;

    const phaseOrderFor = (phaseName: string): string[] => {
        const p = (phaseName || '').toLowerCase();
        if (p.includes('preparation') || p.includes('ball toss') || p.includes('trophy')) {
            return ['Preparation', 'Ball Toss', 'Trophy Position', 'Contact Point', 'Follow Through'];
        }
        return ['Unit Turn', 'Racket Drop', 'Contact Point', 'Follow Through'];
    };

    const getBounds = (phaseName: string, useRef: boolean): { min?: number; max?: number } => {
        const order = phaseOrderFor(phaseName);
        const idx = order.findIndex((x) => x === phaseName);
        if (idx < 0) return {};

        const timeFor = (ph: string): number | null => {
            const match = allIssues.find((it) => it.phase === ph && it.strokeType === issue.strokeType);
            const t = useRef ? (match as any)?.refTimestamp : (match as any)?.timestamp;
            return (typeof t === 'number' && isFinite(t)) ? t : null;
        };

        const tCur = timeFor(phaseName);
        if (tCur === null) return {};

        let tPrev: number | null = null;
        for (let i = idx - 1; i >= 0; i--) {
            const t = timeFor(order[i]);
            if (t !== null) { tPrev = t; break; }
        }
        let tNext: number | null = null;
        for (let i = idx + 1; i < order.length; i++) {
            const t = timeFor(order[i]);
            if (t !== null) { tNext = t; break; }
        }

        const min = tPrev !== null ? (tPrev + tCur) * 0.5 : 0;
        const max = tNext !== null ? (tCur + tNext) * 0.5 : undefined;
        return { min, max };
    };

    const userBounds = getBounds(issue.phase, false);
    const refBounds = getBounds(issue.phase, true);

    return (
        <div className="bg-slate-900/50 rounded-xl p-3 md:p-4 border border-slate-800">
            <div className="mb-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 flex-shrink-0 rounded-full bg-rose-500"></div>
                            <p className="font-semibold text-rose-300 text-xs md:text-sm uppercase tracking-wide">{issue.phase}</p>
                        </div>
                        <p className="mt-1 text-white text-sm md:text-base font-medium pl-4">{issue.issue}</p>
                    </div>
                    <button
                        type="button"
                        className={`px-3 py-1.5 rounded-lg text-[11px] border ${showMotion ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-900/40 border-slate-700 text-slate-300'} hover:bg-slate-800/60`}
                        onClick={() => setOverrideMotion((prev) => {
                            const current = prev ?? motionAll;
                            return !current;
                        })}
                        title="Show multiple frames as a looping clip"
                    >
                        {showMotion ? 'Still' : 'Motion'}
                    </button>
                </div>

            </div>

            <div className="flex flex-col md:grid md:grid-cols-2 gap-3">
                {/* User */}
                <div className="flex flex-col gap-2">
                    <div className="bg-slate-950 px-2 py-1 rounded text-[10px] text-white font-mono w-fit border border-slate-700">YOU</div>
                    {showMotion ? (
                        <PhaseFlipbook
                            phase={issue.phase}
                            videoUrl={userVideoUrl}
                            centerTimestamp={issue.timestamp}
                            minTimestamp={userBounds.min}
                            maxTimestamp={userBounds.max}
                            landmarks={issue.landmarks}
                            visualCue={issue.visualCue}
                            tint="rose"
                            initialStill={issue.frameImage}
                            enabled={true}
                        />
                    ) : (
                        <div className="relative overflow-hidden rounded-lg border border-rose-900/50 shadow-sm shadow-rose-900/20">
                            {issue.frameImage ? (
                                <img src={issue.frameImage} alt="User Error" className="w-full h-auto object-cover" />
                            ) : issue.landmarks ? (
                                <PoseFallbackCanvas
                                    landmarks={issue.landmarks}
                                    visualCue={issue.visualCue}
                                    color="rose"
                                />
                            ) : (
                                <div className="aspect-video bg-black flex items-center justify-center text-slate-600 text-xs">No Image</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Reference */}
                <div className="flex flex-col gap-2">
                    <div className="bg-emerald-600 px-2 py-1 rounded text-[10px] text-white font-mono w-fit shadow-sm">PRO REFERENCE</div>
                    {showMotion ? (
                        <PhaseFlipbook
                            phase={issue.phase}
                            videoUrl={refVideoUrl}
                            centerTimestamp={issue.refTimestamp}
                            minTimestamp={refBounds.min}
                            maxTimestamp={refBounds.max}
                            landmarks={issue.refLandmarks}
                            visualCue={issue.refVisualCue}
                            tint="emerald"
                            initialStill={issue.refFrameImage}
                            enabled={true}
                        />
                    ) : (
                        <div className="relative overflow-hidden rounded-lg border border-emerald-900/50 shadow-sm shadow-emerald-900/20">
                            {issue.refFrameImage ? (
                                <img src={issue.refFrameImage} alt="Pro Reference" className="w-full h-auto object-cover" />
                            ) : issue.refLandmarks ? (
                                <PoseFallbackCanvas
                                    landmarks={issue.refLandmarks}
                                    visualCue={issue.refVisualCue}
                                    color="emerald"
                                />
                            ) : (
                                <div className="aspect-video bg-black flex items-center justify-center text-slate-600 text-xs">No Ref Image</div>
                            )}
                        </div>
                    )}
                </div>
            </div>


        </div>
    );
}
