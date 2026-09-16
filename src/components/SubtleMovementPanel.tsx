import React, { useMemo } from 'react';
import type { SubtleMovementResult, SubtleMovementSeries, SubtleMovementMetrics } from '../services/MotionAnalysisRouter';

type Props = {
    data?: SubtleMovementResult;
};

function formatMaybe(value: number | undefined, digits = 2): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(digits);
}

// Simple interpretation helpers for beginners
function interpretCoil(userDeg: number, refDeg: number): { rating: string; color: string; tip: string } {
    const diff = Math.abs(userDeg - refDeg);
    if (diff < 5) return { rating: '✓ Excellent', color: 'text-emerald-400', tip: 'Your hip-shoulder rotation matches the pro!' };
    if (diff < 15) return { rating: '✓ Good', color: 'text-blue-400', tip: 'Close to pro level. Small adjustments can help.' };
    if (userDeg < refDeg - 15) return { rating: '⚠ Needs More', color: 'text-amber-400', tip: 'Rotate your shoulders more while keeping hips still.' };
    return { rating: '⚠ Too Much', color: 'text-amber-400', tip: 'You might be over-rotating. Focus on controlled turn.' };
}

function interpretTiming(userLag: number, refLag: number): { rating: string; color: string; tip: string } {
    const diff = userLag - refLag;
    if (Math.abs(diff) < 0.05) return { rating: '✓ Perfect', color: 'text-emerald-400', tip: 'Body then arm - exactly like the pro!' };
    if (Math.abs(diff) < 0.15) return { rating: '✓ Good', color: 'text-blue-400', tip: 'Timing is close. Keep practicing!' };
    if (diff < -0.15) return { rating: '⚠ Arming', color: 'text-rose-400', tip: 'Using arm too early. Let your body turn FIRST!' };
    return { rating: '⚠ Too Slow', color: 'text-amber-400', tip: 'Arm is too late. Speed it up after body rotation.' };
}

function interpretKnee(userDeg: number | undefined, refDeg: number | undefined): { rating: string; color: string; tip: string } | null {
    if (userDeg == null || refDeg == null) return null;
    const diff = userDeg - refDeg;
    if (Math.abs(diff) < 10) return { rating: '✓ Great', color: 'text-emerald-400', tip: 'Perfect knee bend depth!' };
    if (diff > 10) return { rating: '⚠ Too Straight', color: 'text-amber-400', tip: 'Bend knees MORE to load power.' };
    return { rating: '✓ Good', color: 'text-blue-400', tip: 'Deep bend! Ensure you can explode upward.' };
}

function interpretHead(userSway: number | undefined, refSway: number | undefined): { rating: string; color: string; tip: string } | null {
    if (userSway == null || refSway == null) return null;
    const ratio = userSway / (refSway || 0.001);
    if (ratio < 1.3) return { rating: '✓ Steady', color: 'text-emerald-400', tip: 'Head stays still - excellent!' };
    if (ratio < 2.0) return { rating: '⚠ Some Movement', color: 'text-blue-400', tip: 'Keep your eyes level through the swing.' };
    return { rating: '⚠ Too Much', color: 'text-amber-400', tip: 'Head moving a lot. Keep it STILL!' };
}

function SimpleCoachingCard({
    title,
    icon,
    rating,
    color,
    tip,
    userValue,
    proValue
}: {
    title: string;
    icon: string;
    rating: string;
    color: string;
    tip: string;
    userValue?: string;
    proValue?: string;
}) {
    return (
        <div className="rounded-lg border border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-4 hover:border-slate-600/50 transition-colors">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">{icon}</span>
                    <div>
                        <p className="text-sm font-medium text-slate-300">{title}</p>
                        <p className={`text-xl font-bold ${color} mt-0.5`}>{rating}</p>
                    </div>
                </div>
                {userValue && proValue && (
                    <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">You vs Pro</p>
                        <p className="text-sm font-mono">
                            <span className="text-rose-300 font-semibold">{userValue}</span>
                            <span className="text-slate-600 mx-1">/</span>
                            <span className="text-emerald-300 font-semibold">{proValue}</span>
                        </p>
                    </div>
                )}
            </div>
            <div className="flex items-start gap-2 rounded-md bg-slate-950/60 px-3 py-2">
                <span className="text-blue-400 text-sm mt-0.5">💡</span>
                <p className="text-sm text-slate-300 leading-relaxed">{tip}</p>
            </div>
        </div>
    );
}

function MetricRow({ label, user, pro, hint }: { label: string; user: string; pro: string; hint?: string }) {
    return (
        <div className="grid grid-cols-12 gap-2 items-baseline">
            <div className="col-span-6 text-xs text-slate-400">{label}</div>
            <div className="col-span-3 text-xs font-mono text-rose-300 text-right">{user}</div>
            <div className="col-span-3 text-xs font-mono text-emerald-300 text-right">{pro}</div>
            {hint && <div className="col-span-12 text-[10px] text-slate-600 -mt-1 italic">{hint}</div>}
        </div>
    );
}

function SummaryTable({ metrics }: { metrics: SubtleMovementMetrics }) {
    const coilInterp = interpretCoil(metrics.coilPeakDeg, metrics.refCoilPeakDeg);
    const timingInterp = interpretTiming(metrics.trunkToArmLagSec, metrics.refTrunkToArmLagSec);
    const kneeInterp = interpretKnee(metrics.kneeMinAngleUserDeg, metrics.kneeMinAngleRefDeg);
    const headInterp = interpretHead(metrics.headSwayStdUser, metrics.headSwayStdRef);

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <p className="text-sm font-semibold text-white">🎯 Simple Coaching Feedback</p>
                        <p className="mt-1 text-xs text-slate-500">Easy tips you can use right away</p>
                    </div>
                </div>

                {metrics.warnings && metrics.warnings.length > 0 && (
                    <div className="mb-4 rounded-lg border border-amber-800/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        ⚠️ {metrics.warnings.join(' • ')}
                    </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                    <SimpleCoachingCard
                        title="Hip-Shoulder Turn"
                        icon="🔄"
                        rating={coilInterp.rating}
                        color={coilInterp.color}
                        tip={coilInterp.tip}
                        userValue={`${metrics.coilPeakDeg.toFixed(0)}°`}
                        proValue={`${metrics.refCoilPeakDeg.toFixed(0)}°`}
                    />

                    <SimpleCoachingCard
                        title="Body → Arm Timing"
                        icon="⚡"
                        rating={timingInterp.rating}
                        color={timingInterp.color}
                        tip={timingInterp.tip}
                        userValue={`${(metrics.trunkToArmLagSec * 1000).toFixed(0)}ms`}
                        proValue={`${(metrics.refTrunkToArmLagSec * 1000).toFixed(0)}ms`}
                    />

                    {kneeInterp && (
                        <SimpleCoachingCard
                            title="Knee Bend"
                            icon="🦵"
                            rating={kneeInterp.rating}
                            color={kneeInterp.color}
                            tip={kneeInterp.tip}
                            userValue={`${metrics.kneeMinAngleUserDeg?.toFixed(0)}°`}
                            proValue={`${metrics.kneeMinAngleRefDeg?.toFixed(0)}°`}
                        />
                    )}

                    {headInterp && (
                        <SimpleCoachingCard
                            title="Head Stability"
                            icon="👁️"
                            rating={headInterp.rating}
                            color={headInterp.color}
                            tip={headInterp.tip}
                        />
                    )}
                </div>

                <details className="mt-6 group">
                    <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-2">
                        <span className="group-open:rotate-90 transition-transform">▶</span>
                        Advanced Metrics (for coaches & experienced players)
                    </summary>
                    <div className="mt-3 space-y-2 rounded-lg border border-slate-800/50 bg-slate-950/30 p-3">
                        <div className="grid grid-cols-12 gap-2 pb-2 border-b border-slate-800/50">
                            <div className="col-span-6 text-[10px] uppercase tracking-wide text-slate-600">Metric</div>
                            <div className="col-span-3 text-[10px] uppercase tracking-wide text-rose-400 text-right">You</div>
                            <div className="col-span-3 text-[10px] uppercase tracking-wide text-emerald-400 text-right">Pro</div>
                        </div>
                        <MetricRow
                            label="Coil peak"
                            user={`${formatMaybe(metrics.coilPeakDeg, 1)}° @ ${formatMaybe(metrics.coilPeakTimeSec, 2)}s`}
                            pro={`${formatMaybe(metrics.refCoilPeakDeg, 1)}° @ ${formatMaybe(metrics.refCoilPeakTimeSec, 2)}s`}
                            hint="Shoulder-hip separation angle at maximum"
                        />
                        <MetricRow
                            label="Uncoil speed"
                            user={`${formatMaybe(metrics.uncoilSpeedPeakDegPerSec, 0)}°/s`}
                            pro={`${formatMaybe(metrics.refUncoilSpeedPeakDegPerSec, 0)}°/s`}
                            hint="How fast you release the coil"
                        />
                        <MetricRow
                            label="Arm whip"
                            user={`${formatMaybe(metrics.armWhipPeakDegPerSec, 0)}°/s`}
                            pro={`${formatMaybe(metrics.refArmWhipPeakDegPerSec, 0)}°/s`}
                            hint="Arm angular velocity at peak"
                        />
                        <MetricRow
                            label="Trunk→Arm lag"
                            user={`${formatMaybe(metrics.trunkToArmLagSec, 3)}s`}
                            pro={`${formatMaybe(metrics.refTrunkToArmLagSec, 3)}s`}
                            hint="Time delay: body rotation peak to arm peak"
                        />
                        {metrics.kneeMinAngleUserDeg != null && metrics.kneeMinAngleRefDeg != null && (
                            <MetricRow
                                label="Knee depth"
                                user={`${metrics.kneeMinAngleUserDeg.toFixed(0)}°`}
                                pro={`${metrics.kneeMinAngleRefDeg.toFixed(0)}°`}
                                hint="Minimum knee angle (smaller = deeper)"
                            />
                        )}
                        {metrics.headSwayStdUser != null && metrics.headSwayStdRef != null && (
                            <MetricRow
                                label="Head sway"
                                user={formatMaybe(metrics.headSwayStdUser, 3)}
                                pro={formatMaybe(metrics.headSwayStdRef, 3)}
                                hint="Standard deviation (lower = more stable)"
                            />
                        )}
                    </div>
                </details>
            </div>
        </div>
    );
}

function Sparkline({
    series,
    a,
    b,
    contactIndex,
    label,
}: {
    series: SubtleMovementSeries;
    a: number[];
    b: number[];
    contactIndex: number;
    label: string;
}) {
    const w = 420;
    const h = 96;
    const pad = 6;

    const { pathA, pathB, contactX, yMin, yMax } = useMemo(() => {
        const len = Math.min(series.x.length, a.length, b.length);
        if (len <= 1) {
            return { pathA: '', pathB: '', contactX: pad, yMin: 0, yMax: 1 };
        }

        const vals = [...a.slice(0, len), ...b.slice(0, len)].filter(v => Number.isFinite(v));
        const yMin = vals.length ? Math.min(...vals) : 0;
        const yMax = vals.length ? Math.max(...vals) : 1;
        const range = Math.max(1e-6, yMax - yMin);

        const xAt = (i: number) => pad + (i / (len - 1)) * (w - pad * 2);
        const yAt = (v: number) => {
            const t = (v - yMin) / range;
            return h - pad - t * (h - pad * 2);
        };

        const toPath = (arr: number[]) => {
            let d = `M ${xAt(0)} ${yAt(arr[0])}`;
            for (let i = 1; i < len; i++) d += ` L ${xAt(i)} ${yAt(arr[i])}`;
            return d;
        };

        const contact = Math.max(0, Math.min(len - 1, contactIndex));

        return {
            pathA: toPath(a.slice(0, len)),
            pathB: toPath(b.slice(0, len)),
            contactX: xAt(contact),
            yMin,
            yMax,
        };
    }, [series.x, a, b, contactIndex]);

    if (!pathA || !pathB) return null;

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-slate-300">{label}</p>
                <p className="text-[10px] text-slate-600">range: {yMin.toFixed(1)} → {yMax.toFixed(1)}</p>
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full">
                <path d={pathB} fill="none" stroke="rgba(16,185,129,0.85)" strokeWidth={2.5} />
                <path d={pathA} fill="none" stroke="rgba(244,63,94,0.85)" strokeWidth={2.5} />
                <line x1={contactX} x2={contactX} y1={4} y2={h - 4} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 3" strokeWidth={1.5} />
            </svg>
            <p className="mt-2 text-[10px] text-slate-500">
                <span className="text-rose-300 font-semibold">Red = You</span>
                <span className="mx-2">•</span>
                <span className="text-emerald-300 font-semibold">Green = Pro</span>
                <span className="mx-2">•</span>
                <span className="text-slate-400">Dashed = Contact</span>
            </p>
        </div>
    );
}

export const SubtleMovementPanel: React.FC<Props> = ({ data }) => {
    if (!data) return null;
    if (!data.metrics && !data.series) {
        return (
            <div className="card">
                <p className="text-sm font-semibold text-white">⏱️ Timing & Movement</p>
                <p className="mt-2 text-sm text-slate-400">{data.summary}</p>
            </div>
        );
    }

    return (
        <div className="card">
            <details open>
                <summary className="cursor-pointer select-none">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-white">⏱️ Timing & Movement Analysis</p>
                            <p className="text-xs text-slate-500">Compare your technique with the pro</p>
                        </div>
                        <p className="text-xs text-slate-600 font-mono">AI-Powered</p>
                    </div>
                </summary>

                <div className="mt-4 space-y-4">
                    {data.metrics && <SummaryTable metrics={data.metrics} />}

                    {data.series && (
                        <details className="group">
                            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-2 mb-3">
                                <span className="group-open:rotate-90 transition-transform">▶</span>
                                Movement Charts (visual comparison)
                            </summary>
                            <div className="grid gap-3 lg:grid-cols-2">
                                <Sparkline
                                    series={data.series}
                                    a={data.series.trunkAngleUser}
                                    b={data.series.trunkAngleRef}
                                    contactIndex={data.series.contactIndex}
                                    label="Body Rotation (degrees)"
                                />
                                <Sparkline
                                    series={data.series}
                                    a={data.series.armVelUser}
                                    b={data.series.armVelRef}
                                    contactIndex={data.series.contactIndex}
                                    label="Arm Speed (deg/second)"
                                />
                            </div>
                        </details>
                    )}

                    <div className="rounded-xl border border-slate-800/50 bg-slate-950/30 p-3">
                        <p className="text-xs uppercase tracking-[0.08em] text-slate-600 mb-2">💬 AI Analysis</p>
                        <p className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed">{data.summary}</p>
                    </div>
                </div>
            </details>
        </div>
    );
};
