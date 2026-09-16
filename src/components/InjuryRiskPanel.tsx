/**
 * InjuryRiskPanel
 *
 * Personalised injury risk report for a single analysis session.
 * Displays:
 *  - Risk-level summary badges (high / medium / low counts)
 *  - Per-injury cards with: level badge, body-part, biomechanical mechanism,
 *    triggered defect chips, and collapsible prevention tips
 *  - Empty-state when no risks detected
 */

import React, { useState } from 'react';
import type { BiomechanicalAnalysisResult, InjuryRisk, RiskLevel, DefectTag } from '../services/biomechanics/types';
import { DEFECT_LABELS } from '../services/biomechanics/MovementDefectTagger';

// ── Risk styling helpers ───────────────────────────────────────────────────────

type Lang = 'en' | 'zhSimp' | 'zhTrad';

function getRiskConfig(lang: Lang): Record<RiskLevel, {
    label: string; labelLong: string; icon: string; badge: string; card: string; dot: string;
}> {
    const en = lang === 'en';
    return {
        high: {
            label: en ? 'High risk' : '高风险',
            labelLong: en ? 'High Risk · Immediate injury risk' : '高风险 · 即刻易受伤',
            icon: '🔴',
            badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
            card: 'border-rose-500/30 bg-gradient-to-br from-rose-500/5 to-slate-900/60',
            dot: 'bg-rose-500',
        },
        medium: {
            label: en ? 'Medium risk' : '中风险',
            labelLong: en ? 'Medium Risk · Long-term overuse risk' : '中风险 · 长期易劳损',
            icon: '🟡',
            badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
            card: 'border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-slate-900/60',
            dot: 'bg-amber-500',
        },
        low: {
            label: en ? 'Low risk' : '低风险',
            labelLong: en ? 'Low Risk · Normal movement' : '低风险 · 正常动作',
            icon: '🟢',
            badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
            card: 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-slate-900/60',
            dot: 'bg-emerald-500',
        },
    };
}

// ── Triggered defect mini-chip ─────────────────────────────────────────────────

function TriggerChip({ tag, lang }: { tag: DefectTag; lang: Lang }) {
    const info = DEFECT_LABELS[tag];
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                     border border-slate-600/50 bg-slate-800/60 text-slate-300">
            {lang === 'en' ? info.label : info.labelZh}
        </span>
    );
}

// ── Single injury risk card ────────────────────────────────────────────────────

function InjuryCard({ risk, lang }: { risk: InjuryRisk; lang: Lang }) {
    const [showPrev, setShowPrev] = useState(risk.riskLevel === 'high');
    const cfg = getRiskConfig(lang)[risk.riskLevel];
    const en = lang === 'en';
    const name = en ? risk.name : risk.nameZh;
    const bodyPart = en ? risk.bodyPart : risk.bodyPartZh;
    const triggerLabel = en ? 'Triggered by:' : '触发因素：';
    const mechanismTitle = en ? 'Injury Mechanism' : '损伤机制';
    const mechanism = en ? risk.mechanism : risk.mechanismZh;
    const preventionTitle = en ? 'Prevention & Correction' : '防护矫正方案';
    const prevention = en ? risk.prevention : risk.preventionZh;
    const collapseBtn = en ? '▲ Collapse' : '▲ 收起';
    const expandBtn = en ? '▼ Expand' : '▼ 展开';

    return (
        <div className={`rounded-xl border p-4 ${cfg.card}`}>
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                            {cfg.icon} {cfg.labelLong}
                        </span>
                        <span className="text-[10px] text-slate-500">{bodyPart}</span>
                    </div>
                    <p className="text-sm font-bold text-white leading-snug">{name}</p>
                </div>
            </div>

            {/* Triggered defects */}
            {risk.triggerDefects.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-[10px] text-slate-500 self-center">{triggerLabel}</span>
                    {risk.triggerDefects.map(t => <TriggerChip key={t} tag={t} lang={lang} />)}
                </div>
            )}

            {/* Mechanism */}
            <div className="rounded-lg bg-slate-950/50 px-3 py-2.5 mb-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{mechanismTitle}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{mechanism}</p>
            </div>

            {/* Prevention tips (collapsible) */}
            <button
                type="button"
                onClick={() => setShowPrev(v => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors w-full text-left"
            >
                <span className="text-emerald-400">🛡</span>
                <span className="font-medium">{preventionTitle}</span>
                <span className="ml-auto text-[10px]">{showPrev ? collapseBtn : expandBtn}</span>
            </button>
            {showPrev && (
                <ul className="mt-2.5 space-y-1.5">
                    {prevention.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-emerald-400 text-xs mt-0.5 shrink-0">{i + 1}.</span>
                            <span className="text-xs text-slate-300 leading-relaxed">{tip}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Summary badges ─────────────────────────────────────────────────────────────

function RiskSummaryBadge({ level, count, lang }: { level: RiskLevel; count: number; lang: Lang }) {
    if (count === 0) return null;
    const cfg = getRiskConfig(lang)[level];
    return (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${cfg.badge}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <span className="text-sm font-bold tabular-nums">{count}</span>
            <span className="text-xs font-medium">{cfg.label}</span>
        </div>
    );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

interface Props {
    result: BiomechanicalAnalysisResult;
    lang?: 'en' | 'zhSimp' | 'zhTrad';
}

export function InjuryRiskPanel({ result, lang = 'zhSimp' }: Props) {
    const { injuryRisks, highRiskCount, mediumRiskCount } = result;
    const lowRiskCount = injuryRisks.filter(r => r.riskLevel === 'low').length;
    const totalRisks = injuryRisks.length;
    const en = lang === 'en';
    const title = lang === 'en' ? 'Injury Risk Assessment'
        : lang === 'zhTrad' ? '傷病風險分級預警'
            : '伤病风险分级预警';
    const subtitle = en
        ? 'Based on movement defect analysis · Personalized injury prevention plan'
        : '基于动作缺陷溯源 · 个性化防护矫正方案';
    const disclaimer = en ? 'For reference only,\nnot medical advice' : '仅供参考，不替代\n专业医疗诊断';
    const emptyTitle = en ? 'No Significant Injury Risk Detected' : '未检测到明显伤病风险';
    const emptyBody = en
        ? 'Biomechanical movement assessment is excellent. Maintain proper form, warm up thoroughly before each session, and gradually increase training volume.'
        : '动作生物力学评估良好。保持规范动作，注意每次打球前充分热身，循序渐进增加训练强度即可。';
    const reminderTitle = en ? '📋 Daily Play Safety Reminders' : '📋 日常打球规避要点';
    const reminders = en ? [
        'Perform a 10-minute dynamic warm-up before each session (shoulder rolls, hip circles, lunge stretches)',
        'Stop immediately if you feel joint pain or soreness — rest takes priority over practice',
        'Keep weekly training volume increases under 10% to avoid overuse injuries',
        'Ice high-risk areas for 10–15 minutes after play to reduce inflammation buildup',
    ] : [
        '每次打球前进行10分钟动态热身（旋肩、转髋、弓步拉伸）',
        '感到关节疼痛或酸胀时立即停止，休息优先于练球',
        '每周训练量增幅不超过10%，避免过度使用性损伤',
        '高风险部位打球后冰敷10–15分钟，减少炎症积累',
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
                </div>
                {/* Disclaimer */}
                <span className="text-[9px] text-slate-600 text-right leading-tight max-w-[120px] whitespace-pre-line">
                    {disclaimer}
                </span>
            </div>

            {/* Risk summary row */}
            {totalRisks > 0 && (
                <div className="flex flex-wrap gap-2">
                    <RiskSummaryBadge level="high" count={highRiskCount} lang={lang} />
                    <RiskSummaryBadge level="medium" count={mediumRiskCount} lang={lang} />
                    <RiskSummaryBadge level="low" count={lowRiskCount} lang={lang} />
                </div>
            )}

            {/* No risks */}
            {totalRisks === 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-6 text-center">
                    <p className="text-2xl mb-2">✅</p>
                    <p className="text-sm font-semibold text-emerald-300 mb-1">{emptyTitle}</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{emptyBody}</p>
                </div>
            )}

            {/* Injury cards */}
            {injuryRisks.map(risk => (
                <InjuryCard key={`${risk.injuryType}-${risk.riskLevel}`} risk={risk} lang={lang} />
            ))}

            {/* Daily reminder footer */}
            {totalRisks > 0 && (
                <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">{reminderTitle}</p>
                    <ul className="space-y-1">
                        {reminders.map((r, i) => (
                            <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                                <span className="text-slate-600 shrink-0">•</span>
                                {r}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
