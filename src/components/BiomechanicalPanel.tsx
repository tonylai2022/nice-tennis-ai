/**
 * BiomechanicalPanel
 *
 * Displays:
 *  - Overall biomechanical score gauge
 *  - Per-metric gauge bars with industry-standard range overlay
 *  - Force-sequence (kinetic chain) timeline
 *  - Movement defect tag chips
 */

import React, { useState } from 'react';
import type { BiomechanicalAnalysisResult, JointAngleMetric, ForceSequenceResult, DefectTag } from '../services/biomechanics/types';
import { DEFECT_LABELS } from '../services/biomechanics/MovementDefectTagger';

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
    if (score >= 85) return 'text-emerald-400';
    if (score >= 65) return 'text-amber-400';
    return 'text-rose-400';
}

function scoreBarColor(score: number): string {
    if (score >= 85) return 'from-emerald-500 to-emerald-400';
    if (score >= 65) return 'from-amber-500 to-amber-400';
    return 'from-rose-500 to-rose-400';
}

function directionBadge(dir: JointAngleMetric['deviationDirection'], lang: 'en' | 'zhSimp' | 'zhTrad'): {
    label: string;
    cls: string;
} {
    if (dir === 'normal') return {
        label: lang === 'en' ? 'Normal' : '正常',
        cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    };
    if (dir === 'too_high') return {
        label: lang === 'en' ? 'Too high' : '偏大',
        cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    };
    return {
        label: lang === 'en' ? 'Too low' : '偏小',
        cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    };
}

// ── Range Bar ──────────────────────────────────────────────────────────────────

function RangeBar({ metric, lang }: { metric: JointAngleMetric; lang: 'en' | 'zhSimp' | 'zhTrad' }) {
    const tolerance = (metric.normalMax - metric.normalMin) * 0.8;
    const displayMin = metric.normalMin - tolerance;
    const displayMax = metric.normalMax + tolerance;
    const span = displayMax - displayMin;
    if (span <= 0) return null;

    const toPct = (v: number) => Math.max(0, Math.min(100, ((v - displayMin) / span) * 100));
    const normalLeft = toPct(metric.normalMin);
    const normalWidth = toPct(metric.normalMax) - normalLeft;
    const valuePct = toPct(metric.value);
    const optPct = toPct(metric.optimalValue);

    return (
        <div className="mt-2 mb-1">
            <div className="relative h-5 rounded-full bg-slate-800 overflow-visible">
                {/* Normal range zone */}
                <div
                    className="absolute top-0 h-full rounded bg-emerald-500/20 border-x border-emerald-500/40"
                    style={{ left: `${normalLeft}%`, width: `${normalWidth}%` }}
                />
                {/* Optimal marker */}
                <div
                    className="absolute top-0 h-full w-0.5 bg-emerald-400/60"
                    style={{ left: `${optPct}%` }}
                />
                {/* User value marker */}
                <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-lg z-10"
                    style={{
                        left: `${valuePct}%`,
                        background: metric.deviationDirection === 'normal' ? '#10b981' :
                            metric.deviationDirection === 'too_high' ? '#f43f5e' : '#f59e0b',
                    }}
                />
            </div>
            {/* Axis labels */}
            <div className="flex justify-between mt-0.5 px-0.5">
                <span className="text-[9px] text-slate-600">{Math.round(displayMin)}{metric.unit}</span>
                <span className="text-[9px] text-slate-500">
                    {lang === 'en'
                        ? `Normal ${metric.normalMin}–${metric.normalMax}${metric.unit}`
                        : `正常区间 ${metric.normalMin}–${metric.normalMax}${metric.unit}`}
                </span>
                <span className="text-[9px] text-slate-600">{Math.round(displayMax)}{metric.unit}</span>
            </div>
        </div>
    );
}

// ── Metric Card ────────────────────────────────────────────────────────────────

function MetricCard({ metric, lang }: { metric: JointAngleMetric; lang: 'en' | 'zhSimp' | 'zhTrad' }) {
    const { label, cls } = directionBadge(metric.deviationDirection, lang);
    const name = lang === 'en' ? metric.name : metric.nameZh;
    const note = lang === 'en' ? metric.clinicalNote : metric.clinicalNoteZh;
    return (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">{metric.phase}</p>
                    <p className="text-sm font-medium text-slate-200 leading-snug">{name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>
                    <span className={`text-xl font-bold tabular-nums ${scoreColor(metric.score)}`}>
                        {metric.value}{metric.unit}
                    </span>
                </div>
            </div>

            <RangeBar metric={metric} lang={lang} />

            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{note}</p>
        </div>
    );
}

// ── Force Sequence ─────────────────────────────────────────────────────────────

const CHAIN_STEPS_ZH = [
    { label: '蹬地', icon: '🦶', desc: '膝关节加载' },
    { label: '转体', icon: '🌀', desc: '髋肩旋转' },
    { label: '挥臂', icon: '💪', desc: '手腕加速' },
];
const CHAIN_STEPS_EN = [
    { label: 'Push-off', icon: '🦶', desc: 'Knee loading' },
    { label: 'Rotation', icon: '🌀', desc: 'Hip-shoulder turn' },
    { label: 'Swing', icon: '💪', desc: 'Wrist acceleration' },
];

function ForceChainRow({ forceSeq, lang }: { forceSeq: ForceSequenceResult; lang: 'en' | 'zhSimp' | 'zhTrad' }) {
    const lagMs = forceSeq.trunkToArmLagMs;
    const ok = forceSeq.sequenceCorrect;
    const steps = lang === 'en' ? CHAIN_STEPS_EN : CHAIN_STEPS_ZH;
    const statusBadge = lang === 'en'
        ? (ok ? `Correct rhythm · trunk→wrist gap ${lagMs}ms` : `Timing issue · ${lagMs < 0 ? 'arm leads' : `lag ${lagMs}ms`}`)
        : (ok ? `节奏正确 · 躯干→手腕间隔 ${lagMs}ms` : `时序异常 · ${lagMs < 0 ? '手臂提前' : `滞后 ${lagMs}ms`}`);
    const scoreLabel = lang === 'en' ? 'Chain score' : '动力链得分';
    const tip = lang === 'en' ? forceSeq.tip : forceSeq.tipZh;
    const sectionTitle = lang === 'en' ? 'Kinetic Chain Sequence' : '发力时序链路';
    return (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-white">{sectionTitle}</p>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ok
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                    {statusBadge}
                </span>
            </div>

            {/* Step chain */}
            <div className="flex items-center gap-1">
                {steps.map((step, i) => {
                    const hasIssue = (
                        (i === 0 && forceSeq.problems.includes('INSUFFICIENT_PUSHOFF')) ||
                        (i === 1 && forceSeq.problems.includes('TRUNK_LEADS_PUSHOFF')) ||
                        (i === 2 && (forceSeq.problems.includes('ARM_LEADS_TRUNK') || forceSeq.problems.includes('LATE_ARM')))
                    );
                    return (
                        <React.Fragment key={step.label}>
                            <div className={`flex-1 rounded-lg px-2 py-2.5 text-center border ${hasIssue
                                ? 'border-rose-500/40 bg-rose-500/10'
                                : 'border-emerald-500/30 bg-emerald-500/10'
                                }`}>
                                <p className="text-base leading-none mb-1">{step.icon}</p>
                                <p className={`text-xs font-bold ${hasIssue ? 'text-rose-300' : 'text-emerald-300'}`}>
                                    {step.label}
                                </p>
                                <p className="text-[9px] text-slate-500 mt-0.5">{step.desc}</p>
                            </div>
                            {i < steps.length - 1 && (
                                <div className={`text-lg font-bold ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>→</div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Score bar */}
            <div className="mt-3 flex items-center gap-2">
                <p className="text-[11px] text-slate-500 whitespace-nowrap">{scoreLabel}</p>
                <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                        className={`h-full rounded-full bg-gradient-to-r ${scoreBarColor(forceSeq.chainScore)} transition-all duration-700`}
                        style={{ width: `${forceSeq.chainScore}%` }}
                    />
                </div>
                <span className={`text-sm font-bold tabular-nums ${scoreColor(forceSeq.chainScore)}`}>
                    {forceSeq.chainScore}
                </span>
            </div>

            {/* Tip */}
            {!ok && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-950/60 px-3 py-2">
                    <span className="text-amber-400 text-sm shrink-0">💡</span>
                    <p className="text-xs text-slate-300 leading-relaxed">{tip}</p>
                </div>
            )}
        </div>
    );
}

// ── Defect Tags ────────────────────────────────────────────────────────────────

function DefectChip({ tag, lang }: { tag: DefectTag; lang: 'en' | 'zhSimp' | 'zhTrad' }) {
    const info = DEFECT_LABELS[tag];
    const [open, setOpen] = useState(false);
    const label = lang === 'en' ? info.label : info.labelZh;
    const bodyPart = lang === 'en' ? info.bodyPart : info.bodyPartZh;
    const desc = lang === 'en' ? info.desc : info.descZh;
    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                   border border-rose-500/40 bg-rose-500/10 text-rose-300
                   hover:bg-rose-500/20 transition-colors"
            >
                <span className="text-[10px]">⚠</span>
                {label}
                <span className="text-rose-500/60 text-[9px]">({bodyPart})</span>
            </button>
            {open && (
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed px-1">
                    {desc}
                </p>
            )}
        </div>
    );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

interface Props {
    result: BiomechanicalAnalysisResult;
    lang?: 'en' | 'zhSimp' | 'zhTrad';
}

export function BiomechanicalPanel({ result, lang = 'zhSimp' }: Props) {
    const [showAll, setShowAll] = useState(false);
    const displayed = showAll ? result.jointAngles : result.jointAngles.slice(0, 3);
    const title = lang === 'en' ? 'Biomechanical Analysis'
        : lang === 'zhTrad' ? '生物力學量化診斷'
            : '生物力学量化诊断';

    const subtitle = lang === 'en'
        ? 'Based on pose keypoints · vs. industry-standard ranges'
        : '基于MediaPipe姿态关键点 · 对比行业标准区间';
    const scoreLabel = lang === 'en' ? 'Overall Score' : '综合评分';
    const summary = lang === 'en' ? result.summary : result.summaryZh;
    const sectionLabel = lang === 'en' ? 'Joint Angle Data' : '关键关节角度数据';
    const defectsLabel = lang === 'en' ? 'Movement Defects' : '动作缺陷自动标记';
    const collapseBtn = lang === 'en' ? 'Collapse' : '收起';
    const expandBtn = (n: number) => lang === 'en' ? `Show all ${n} metrics` : `展开全部 ${n} 项指标`;

    return (
        <div className="flex flex-col gap-4">
            {/* Header + overall score */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {subtitle}
                    </p>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">{scoreLabel}</p>
                    <p className={`text-2xl font-bold tabular-nums ${scoreColor(result.biomechanicalScore)}`}>
                        {result.biomechanicalScore}
                        <span className="text-xs text-slate-500 font-normal ml-0.5">/100</span>
                    </p>
                </div>
            </div>

            {/* Summary */}
            <div className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed border ${result.highRiskCount > 0
                ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
                : result.mediumRiskCount > 0
                    ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
                    : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                }`}>
                {summary}
            </div>

            {/* Joint angle metrics */}
            {result.jointAngles.length > 0 && (
                <div className="flex flex-col gap-3">
                    <p className="text-xs uppercase tracking-[0.07em] text-slate-500">{sectionLabel}</p>
                    {displayed.map(m => <MetricCard key={m.id} metric={m} lang={lang} />)}
                    {result.jointAngles.length > 3 && (
                        <button
                            type="button"
                            onClick={() => setShowAll(v => !v)}
                            className="text-xs text-slate-400 hover:text-white transition-colors py-1"
                        >
                            {showAll ? collapseBtn : expandBtn(result.jointAngles.length)}
                        </button>
                    )}
                </div>
            )}

            {/* Force sequence */}
            <ForceChainRow forceSeq={result.forceSequence} lang={lang} />

            {/* Defect tags */}
            {result.defectTags.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-[0.07em] text-slate-500">{defectsLabel}</p>
                    <div className="flex flex-wrap gap-2">
                        {result.defectTags.map(tag => <DefectChip key={tag} tag={tag} lang={lang} />)}
                    </div>
                </div>
            )}
        </div>
    );
}
