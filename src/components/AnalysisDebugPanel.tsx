import React, { useMemo, useState } from 'react';
import type { AlignmentIssue } from '../services/MotionAnalysisRouter';

function formatMaybe(value: unknown, digits = 3): string {
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(digits);
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '—';
}

interface PhaseInfo {
    label: string;
    frameIdx: number;
    ts: number;
    pct: number;
}

interface PhaseDetectionDebug {
    unitTurn: PhaseInfo;
    racketDrop: PhaseInfo;
    contact: PhaseInfo;
    followThrough: PhaseInfo;
    totalFrames: number;
    videoDuration: number;
    handedness: string;
    strokeType: string;
    scoreArrays?: { contact: number[]; unitTurn: number[]; racketDropY: number[] } | null;
    correctionKey?: string | null;
}

/** Clamp-based color: 25–75% range is "good" for contact, rest is warn/bad */
function pctColor(pct: number, isContact: boolean): string {
    if (!isContact) return 'text-slate-300';
    if (pct >= 25 && pct <= 75) return 'text-emerald-400';
    if (pct >= 15 && pct <= 85) return 'text-amber-400';
    return 'text-red-400';
}

function Sparkline({
    scores, totalFrames, activeStart, activeEnd, winnerIdx,
}: {
    scores: number[]; totalFrames: number;
    activeStart: number; activeEnd: number; winnerIdx: number;
}) {
    const valid = scores.slice(activeStart, activeEnd + 1).filter(v => Number.isFinite(v) && v > 0);
    const max = valid.length ? Math.max(...valid) : 1;
    return (
        <div className="flex items-end gap-px mt-1" style={{ height: 16 }}>
            {scores.map((v, i) => {
                const inWindow = i >= activeStart && i <= activeEnd;
                const isWinner = i === winnerIdx;
                const h = inWindow && Number.isFinite(v) && v > 0
                    ? Math.max(2, Math.round((v / max) * 14)) : 2;
                return (
                    <div
                        key={i}
                        style={{ flex: `0 0 ${100 / totalFrames}%`, height: h, minWidth: 1 }}
                        className={isWinner ? 'bg-emerald-400' : inWindow ? 'bg-slate-500/60' : 'bg-slate-800/40'}
                    />
                );
            })}
        </div>
    );
}

export function AnalysisDebugPanel({ issues }: { issues?: AlignmentIssue[] }) {
    const show = useMemo(() => {
        try {
            const qs = new URLSearchParams(window.location.search);
            return import.meta.env.DEV || qs.get('debug') === '1';
        } catch {
            return import.meta.env.DEV;
        }
    }, []);

    const [expanded, setExpanded] = useState(true);
    const [correcting, setCorrecting] = useState(false);
    const [corrFrames, setCorrFrames] = useState<{ ut: number; rd: number; ct: number; ft: number } | null>(null);

    // Extract phaseDetection debug block from any issue that carries it
    const phaseDebug = useMemo((): PhaseDetectionDebug | null => {
        if (!issues?.length) return null;
        for (const issue of issues) {
            const d = (issue.debug as Record<string, unknown> | undefined)?.phaseDetection;
            if (d && typeof d === 'object') {
                return d as PhaseDetectionDebug;
            }
        }
        return null;
    }, [issues]);

    const contact = useMemo(() => {
        if (!issues?.length) return null;
        return issues.find(i => i.phase === 'Contact Point') ?? null;
    }, [issues]);

    const initCorrection = () => {
        if (!phaseDebug) return;
        setCorrFrames({
            ut: phaseDebug.unitTurn.frameIdx,
            rd: phaseDebug.racketDrop.frameIdx,
            ct: phaseDebug.contact.frameIdx,
            ft: phaseDebug.followThrough.frameIdx,
        });
        setCorrecting(true);
    };

    const applyCorrection = () => {
        if (!phaseDebug?.correctionKey || !corrFrames) return;
        try {
            sessionStorage.setItem(phaseDebug.correctionKey, JSON.stringify({
                unitTurnIdx: corrFrames.ut,
                racketDropIdx: corrFrames.rd,
                contactIdx: corrFrames.ct,
                followThroughIdx: corrFrames.ft,
            }));
            console.log('[DebugPanel] Phase correction saved — re-run analysis to apply', corrFrames);
        } catch { /* ignore */ }
        setCorrecting(false);
    };

    const clearCorrection = () => {
        if (phaseDebug?.correctionKey) {
            try { sessionStorage.removeItem(phaseDebug.correctionKey); } catch { /* ignore */ }
        }
        setCorrecting(false);
        setCorrFrames(null);
    };

    if (!show) return null;

    const safeStart = phaseDebug ? Math.floor(phaseDebug.totalFrames * 0.08) : 0;
    const safeEnd   = phaseDebug ? Math.floor(phaseDebug.totalFrames * 0.92) : 0;

    type PhaseKey = 'unitTurn' | 'racketDrop' | 'contact' | 'followThrough';
    type CorrKey  = 'ut' | 'rd' | 'ct' | 'ft';
    const phaseConfig: Array<{
        key: PhaseKey; label: string; corrKey: CorrKey;
        scores?: number[]; activeStart: number; activeEnd: number;
    }> = phaseDebug ? [
        { key: 'unitTurn',      label: 'Unit Turn',      corrKey: 'ut', scores: phaseDebug.scoreArrays?.unitTurn    ?? undefined, activeStart: 0,         activeEnd: phaseDebug.racketDrop.frameIdx - 1 },
        { key: 'racketDrop',    label: 'Racket Drop',    corrKey: 'rd', scores: phaseDebug.scoreArrays?.racketDropY ?? undefined, activeStart: safeStart, activeEnd: phaseDebug.contact.frameIdx - 1 },
        { key: 'contact',       label: 'Contact Point',  corrKey: 'ct', scores: phaseDebug.scoreArrays?.contact     ?? undefined, activeStart: safeStart, activeEnd: safeEnd },
        { key: 'followThrough', label: 'Follow Through', corrKey: 'ft', scores: undefined,                                        activeStart: phaseDebug.contact.frameIdx + 1, activeEnd: safeEnd },
    ] : [];

    const isSparse      = phaseDebug ? phaseDebug.totalFrames < 20 : false;
    const unitTurnZero  = phaseDebug?.unitTurn.pct === 0;

    return (
        <div className="card border border-yellow-500/30 bg-yellow-950/10">
            <div className="w-full flex items-center justify-between gap-3">
                <button
                    type="button"
                    className="flex-1 flex items-center gap-2 text-left"
                    onClick={() => setExpanded(v => !v)}
                >
                    <span className="text-yellow-400 text-sm">🐛</span>
                    <p className="text-xs uppercase tracking-[0.08em] text-yellow-400 font-semibold">Phase Detection Debug</p>
                    {phaseDebug && (
                        <span className="text-xs text-slate-500 font-mono">
                            {phaseDebug.strokeType} · {phaseDebug.totalFrames}f · {phaseDebug.handedness}
                        </span>
                    )}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                    {phaseDebug && !correcting && (
                        <button
                            type="button"
                            className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:border-amber-400 hover:text-amber-300 transition-colors"
                            onClick={(e) => { e.stopPropagation(); initCorrection(); setExpanded(true); }}
                        >
                            ✎ Correct
                        </button>
                    )}
                    <button
                        type="button"
                        className="text-xs text-slate-400"
                        onClick={() => setExpanded(v => !v)}
                    >
                        {expanded ? 'Hide' : 'Show'}
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="mt-4 grid gap-3">
                    {/* Phase frame indices table */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <p className="text-xs uppercase tracking-[0.08em] text-slate-400 mb-3">Frame Indices</p>
                        {phaseDebug ? (
                            <>
                                {(isSparse || unitTurnZero) && (
                                    <div className="mb-2 flex flex-col gap-1">
                                        {isSparse && (
                                            <p className="text-[10px] text-amber-400">
                                                ⚠ Only {phaseDebug.totalFrames} frames (~{Math.round(phaseDebug.totalFrames / phaseDebug.videoDuration)}fps) — hip/shoulder lag timing unreliable
                                            </p>
                                        )}
                                        {unitTurnZero && (
                                            <p className="text-[10px] text-amber-400">
                                                ⚠ Unit turn at video start — clip may be trimmed too tight
                                            </p>
                                        )}
                                    </div>
                                )}
                                <div className="grid gap-1">
                                    <div className="grid grid-cols-4 text-[10px] text-slate-500 uppercase tracking-wide pb-1 border-b border-slate-800">
                                        <span>Phase</span>
                                        <span className="text-right">Frame</span>
                                        <span className="text-right">Time</span>
                                        <span className="text-right">% Pos</span>
                                    </div>
                                    {phaseConfig.map(({ key, label, scores, activeStart, activeEnd }) => {
                                        const info = phaseDebug[key] as PhaseInfo;
                                        const isContact = key === 'contact';
                                        return (
                                            <div key={key}>
                                                <div className="grid grid-cols-4 text-xs items-center py-0.5">
                                                    <span className="text-slate-300">{label}</span>
                                                    <span className="text-right font-mono text-slate-400">
                                                        {info.frameIdx}<span className="text-slate-600">/{phaseDebug.totalFrames - 1}</span>
                                                    </span>
                                                    <span className="text-right font-mono text-slate-400">{info.ts.toFixed(2)}s</span>
                                                    <span className={`text-right font-mono font-semibold ${pctColor(info.pct, isContact)}`}>
                                                        {info.pct}%
                                                        {isContact && (info.pct < 25 || info.pct > 75) && (
                                                            <span className="ml-1 text-[10px] text-amber-400">⚠</span>
                                                        )}
                                                    </span>
                                                </div>
                                                {scores && scores.length > 0 && (
                                                    <Sparkline
                                                        scores={scores}
                                                        totalFrames={phaseDebug.totalFrames}
                                                        activeStart={activeStart}
                                                        activeEnd={Math.min(activeEnd, phaseDebug.totalFrames - 1)}
                                                        winnerIdx={info.frameIdx}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="mt-2 text-[10px] text-slate-500">
                                    Duration: {phaseDebug.videoDuration}s · Contact should be 25–75% of video
                                </p>
                            </>
                        ) : (
                            <p className="text-xs text-slate-500">No phase detection data — run analysis first.</p>
                        )}
                    </div>

                    {/* Manual phase correction widget */}
                    {correcting && phaseDebug && corrFrames && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-950/10 p-3">
                            <p className="text-xs uppercase tracking-[0.08em] text-amber-400 mb-3">Correct Phase Frames</p>
                            <div className="grid gap-3">
                                {phaseConfig.map(({ key, label, corrKey }) => {
                                    const val = corrFrames[corrKey];
                                    const maxFrame = phaseDebug.totalFrames - 1;
                                    return (
                                        <div key={key} className="grid gap-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-300">{label}</span>
                                                <span className="font-mono text-amber-300">{val} / {maxFrame}</span>
                                            </div>
                                            <input
                                                type="range"
                                                min={0}
                                                max={maxFrame}
                                                value={val}
                                                onChange={e => {
                                                    const n = Number(e.target.value);
                                                    setCorrFrames(f => { if (!f) return f; const next = { ...f }; next[corrKey] = n; return next; });
                                                }}
                                                className="w-full accent-amber-400"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                                <button
                                    type="button"
                                    className="text-xs px-3 py-1 rounded bg-amber-500/20 border border-amber-400/50 text-amber-300 hover:bg-amber-500/30 transition-colors"
                                    onClick={applyCorrection}
                                >
                                    Apply — re-run analysis
                                </button>
                                <button
                                    type="button"
                                    className="text-xs px-3 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-300 transition-colors"
                                    onClick={clearCorrection}
                                >
                                    Cancel
                                </button>
                            </div>
                            <p className="mt-2 text-[10px] text-slate-500">Stored in session — re-run analysis to apply. Clears on page reload.</p>
                        </div>
                    )}

                    {/* Contact metrics */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <p className="text-xs uppercase tracking-[0.08em] text-slate-400 mb-2">Contact Metrics</p>
                        {contact?.metrics ? (
                            <div className="grid gap-1 text-xs">
                                {Object.entries(contact.metrics).map(([k, v]) => (
                                    <div key={k} className="flex items-center justify-between">
                                        <span className="text-slate-300">{k}</span>
                                        <span className="font-mono text-slate-400">{formatMaybe(v, 3)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500">No contact metrics.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
