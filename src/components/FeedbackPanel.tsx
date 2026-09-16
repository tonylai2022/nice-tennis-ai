import React, { useState, useMemo } from 'react';
import { ShotDashboard } from './ShotDashboard';
import type { ServeFeedback, RichTip } from '../services/VideoTutor';
import type { SkillType, TrimRange } from '../types/app';
import type { AlignmentIssue, PoseResult } from '../services/MotionAnalysisRouter';
import type { FreeFeedback } from '../services/coaching/FreeTennisCoach';
import { useVideoExport } from '../hooks/useVideoExport';
import { SubtleMovementPanel } from './SubtleMovementPanel';
import { ReportDownload } from './ReportDownload';
import { ReportDataCollectorService } from '../services/ReportDataCollector';
import { ReportGeneratorService } from '../services/ReportGenerator';
import { getPhaseDisplayName } from '../services/PhaseDisplayNames';
import { VisualIssueCard } from './VisualIssueCard';
import { AnalysisDebugPanel } from './AnalysisDebugPanel';
import { BiomechanicalPanel } from './BiomechanicalPanel';
import { InjuryRiskPanel } from './InjuryRiskPanel';
import { analyzeBiomechanics } from '../services/biomechanics/BiomechanicalAnalyzer';
import { WatchMetricsPanel } from './WatchMetricsPanel';

export function FeedbackPanel({
    feedback,
    freeFeedback,
    freeMode,
    userVideoUrl,
    refVideoUrl,
    onRetake,
    onReset,
    sport,
    motionType,
    showReport,
    capturedFrames,
    onShowReport,
    onHideReport,
    refPoseFrames,
    userPoseFrames,
    referenceTrim,
    userTrim,
    referenceDuration,
    userDuration,
    showSkeleton,
    exportLang,
}: {
    feedback?: ServeFeedback | null;
    freeFeedback?: FreeFeedback | null;
    freeMode?: boolean;
    userVideoUrl: string | null;
    refVideoUrl: string | null;
    onRetake: () => void;
    onReset: () => void;
    sport: 'tennis';
    motionType: SkillType;
    showReport: boolean;
    capturedFrames: any[];
    onShowReport: () => void | Promise<void>;
    onHideReport: () => void;
    // export props (freeMode only)
    refPoseFrames?: PoseResult[] | null;
    userPoseFrames?: PoseResult[] | null;
    referenceTrim?: TrimRange;
    userTrim?: TrimRange;
    referenceDuration?: number;
    userDuration?: number;
    showSkeleton?: boolean;
    exportLang?: 'en' | 'zhSimp' | 'zhTrad';
}) {
    const phaseEntries = Object.entries((feedback as ServeFeedback)?.phases || {});
    const [motionAll, setMotionAll] = useState(true);
    const [showTimingMovement, setShowTimingMovement] = useState(false);
    const [showBiomechanics, setShowBiomechanics] = useState(false);
    const [showInjuryRisk, setShowInjuryRisk] = useState(false);
    const [capturingFrames, setCapturingFrames] = useState(false);
    const [downloadingCard, setDownloadingCard] = useState(false);
    const { isExporting, progress, error: exportError, triggerExport } = useVideoExport();

    // Localisation helpers
    const lang = exportLang ?? 'en';
    const t = {
        bioTitle: lang === 'zhSimp' ? '🔬 生物力学量化诊断'
            : lang === 'zhTrad' ? '🔬 生物力學量化診斷'
                : '🔬 Biomechanical Analysis',
        defects: lang === 'zhSimp' ? (n: number) => `${n} 项缺陷`
            : lang === 'zhTrad' ? (n: number) => `${n} 項缺陷`
                : (n: number) => `${n} defect${n !== 1 ? 's' : ''}`,
        bioScore: lang === 'zhSimp' ? (s: number) => `综合 ${s}/100`
            : lang === 'zhTrad' ? (s: number) => `綜合 ${s}/100`
                : (s: number) => `Score: ${s}/100`,
        injTitle: lang === 'zhSimp' ? '🛡 伤病风险分级预警'
            : lang === 'zhTrad' ? '🛡 傷病風險分級預警'
                : '🛡 Injury Risk Assessment',
        highRisk: lang === 'zhSimp' ? (n: number) => `高风险 ${n}`
            : lang === 'zhTrad' ? (n: number) => `高風險 ${n}`
                : (n: number) => `High risk: ${n}`,
        medRisk: lang === 'zhSimp' ? (n: number) => `中风险 ${n}`
            : lang === 'zhTrad' ? (n: number) => `中風險 ${n}`
                : (n: number) => `Med risk: ${n}`,
        expand: lang === 'zhSimp' ? '展开' : lang === 'zhTrad' ? '展開' : 'Expand',
        collapse: lang === 'zhSimp' ? '收起' : lang === 'zhTrad' ? '收起' : 'Collapse',
    };

    // Biomechanical analysis – computed once from user pose frames
    const biomechResult = useMemo(() => {
        if (!userPoseFrames?.length) return null;
        return analyzeBiomechanics(userPoseFrames, sport, motionType);
    }, [userPoseFrames, sport, motionType]);

    const handleDownloadCard = async () => {
        if (downloadingCard) return;
        setDownloadingCard(true);
        try {
            const { pdfUrl, fileName } = await ReportGeneratorService.generateShotAnalysisPDF(
                fullFeedback, motionType, sport
            );
            ReportGeneratorService.downloadPDF(pdfUrl, fileName);
            setTimeout(() => ReportGeneratorService.revokePDFUrl(pdfUrl), 5000);
        } catch (e) {
            console.error('Shot analysis PDF failed:', e);
        } finally {
            setDownloadingCard(false);
        }
    };

    // ── Free mode render ──────────────────────────────────────────────────────
    if (freeMode && freeFeedback) {
        const canExport = !!(refVideoUrl && userVideoUrl && referenceTrim && userTrim &&
            referenceDuration && userDuration);

        const handleExport = () => {
            if (!canExport) return;
            triggerExport({
                refVideoUrl: refVideoUrl!,
                userVideoUrl: userVideoUrl!,
                refPoseFrames: refPoseFrames ?? null,
                userPoseFrames: userPoseFrames ?? null,
                referenceTrim: referenceTrim!,
                userTrim: userTrim!,
                referenceDuration: referenceDuration!,
                userDuration: userDuration!,
                feedback: freeFeedback,
                motionType,
                sport,
                showSkeleton: showSkeleton ?? true,
            }, `motiontutor-${motionType.toLowerCase().replace(/\s+/g, '-')}-recap.webm`);
        };

        return (
            <div className="flex flex-col gap-4 sm:gap-6">
                {/* Step label + encouragement */}
                <div className="card">
                    <p className="text-xs uppercase tracking-[0.08em] text-accent font-medium">Step 4 of 4</p>
                    <h2 className="mt-1 text-xl sm:text-2xl font-bold text-white">Coaching Feedback</h2>
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">{freeFeedback.encouragement}</p>
                </div>

                {/* Interactive dashboard (score card + radar + gauge + angle chart) */}
                <ShotDashboard
                    overallScore={freeFeedback.overallScore}
                    motionType={motionType}
                    freeTips={freeFeedback.tips}
                    userPoseFrames={userPoseFrames}
                    refPoseFrames={refPoseFrames}
                    showPDFButton={false}
                />

                {/* Apple Watch motion metrics (only shown when watch data is available) */}
                <WatchMetricsPanel />

                {/* Biomechanical analysis */}
                {biomechResult && (
                    <div className="card">
                        <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3"
                            onClick={() => setShowBiomechanics(v => !v)}
                            aria-expanded={showBiomechanics}
                        >
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-white">{t.bioTitle}</p>
                                {biomechResult.defectTags.length > 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300">
                                        {t.defects(biomechResult.defectTags.length)}
                                    </span>
                                )}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/40 text-slate-300">
                                    {t.bioScore(biomechResult.biomechanicalScore)}
                                </span>
                            </div>
                            <span className="text-xs text-slate-400">{showBiomechanics ? t.collapse : t.expand}</span>
                        </button>
                        {showBiomechanics && (
                            <div className="mt-4">
                                <BiomechanicalPanel result={biomechResult} lang={lang} />
                            </div>
                        )}
                    </div>
                )}

                {/* Injury risk panel */}
                {biomechResult && (
                    <div className="card">
                        <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3"
                            onClick={() => setShowInjuryRisk(v => !v)}
                            aria-expanded={showInjuryRisk}
                        >
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-white">{t.injTitle}</p>
                                {biomechResult.highRiskCount > 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300">
                                        {t.highRisk(biomechResult.highRiskCount)}
                                    </span>
                                )}
                                {biomechResult.mediumRiskCount > 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300">
                                        {t.medRisk(biomechResult.mediumRiskCount)}
                                    </span>
                                )}
                            </div>
                            <span className="text-xs text-slate-400">{showInjuryRisk ? t.collapse : t.expand}</span>
                        </button>
                        {showInjuryRisk && (
                            <div className="mt-4">
                                <InjuryRiskPanel result={biomechResult} lang={lang} />
                            </div>
                        )}
                    </div>
                )}

                {/* Premium upsell */}
                <div className="card border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-slate-900">
                    <div className="flex items-start gap-4">
                        <div className="text-2xl flex-shrink-0">🔒</div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-white">Phase-by-Phase Breakdown</p>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-medium">
                                    Premium · Coming Soon
                                </span>
                            </div>
                            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                                Unlock frame-by-frame phase analysis, visual alignment issues, motion overlay, and
                                a downloadable PDF report.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Video export */}
                {canExport && (
                    <div className="card">
                        <p className="text-sm font-semibold text-white mb-1">📥 Download Video Recap</p>
                        <p className="text-xs text-slate-400 mb-3">
                            Save a side-by-side comparison video with skeleton overlays and coaching tips — shareable anywhere.
                        </p>
                        {exportError && (
                            <p className="mb-3 text-xs text-rose-400 bg-rose-500/10 rounded px-2 py-1">{exportError}</p>
                        )}
                        {isExporting ? (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 text-sm text-emerald-400">
                                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                                    Recording… {progress}%
                                </div>
                                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-accentBlue transition-all duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <button
                                className="btn btn-accent w-full sm:w-auto !min-h-0"
                                onClick={handleExport}
                                disabled={isExporting}
                            >
                                ⬇ Download Comparison Video
                            </button>
                        )}
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                    <button className="btn btn-primary" onClick={onRetake}>
                        ← Back to Compare
                    </button>
                    <button className="btn btn-secondary" onClick={onReset}>
                        🏠 Start Over
                    </button>
                </div>
            </div>
        );
    }

    // ── Full (premium) mode render ────────────────────────────────────────────
    const fullFeedback = feedback as ServeFeedback;
    if (!fullFeedback) return null;

    const reportData = useMemo(() => ({
        sport,
        strokeType: motionType,
        analysisDate: new Date(),
        feedback: {
            ...fullFeedback,
            tips: ReportDataCollectorService.enhanceQuickTips(fullFeedback, motionType)
        },
        userName: 'Player',
        videoMetadata: {
            userVideoName: userVideoUrl ? 'User Video' : undefined,
            referenceVideoName: refVideoUrl ? 'Reference Video' : undefined,
        },
        timingData: (() => {
            const settings = JSON.parse(localStorage.getItem('report-settings') || '{}');
            return settings.includeTimingData !== false
                ? ReportDataCollectorService.generateTimingData(fullFeedback.phases)
                : undefined;
        })(),
        movementMetrics: (() => {
            const settings = JSON.parse(localStorage.getItem('report-settings') || '{}');
            return settings.includeMovementMetrics !== false
                ? ReportDataCollectorService.calculateMovementMetrics()
                : undefined;
        })(),
        frameSnapshots: (() => {
            const settings = JSON.parse(localStorage.getItem('report-settings') || '{}');
            if (settings.includeFrameSnapshots === false) return undefined;
            return capturedFrames.length > 0
                ? capturedFrames
                : ReportDataCollectorService.generateMockFrameSnapshots(fullFeedback, motionType);
        })(),
        customLogo: localStorage.getItem('motion-tutor-report-logo') || undefined,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [sport, motionType, fullFeedback, userVideoUrl, refVideoUrl, capturedFrames]);

    const handleShowReport = async () => {
        setCapturingFrames(true);
        try {
            await onShowReport();
        } finally {
            setCapturingFrames(false);
        }
    };

    const scoreColor = (score: number) => {
        if (score >= 85) return 'text-emerald-400';
        if (score >= 70) return 'text-amber-300';
        return 'text-rose-300';
    };

    const scoreBg = (score: number) => {
        if (score >= 85) return 'from-emerald-500/20 to-emerald-600/5';
        if (score >= 70) return 'from-amber-500/20 to-amber-600/5';
        return 'from-rose-500/20 to-rose-600/5';
    };

    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            {/* Step label + encouragement */}
            <div className="card">
                <p className="text-xs uppercase tracking-[0.08em] text-accent font-medium">Step 5 of 5</p>
                <h2 className="mt-1 text-xl sm:text-2xl font-bold text-white">Feedback</h2>
                {fullFeedback.isDemo && (
                    <p className="mt-2 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded inline-block">⚠️ Demo data - analysis service unavailable</p>
                )}
                <p className="mt-3 text-sm text-slate-300 leading-relaxed">{fullFeedback.encouragement}</p>
            </div>

            {/* ── Interactive Shot Dashboard ────────────────────────────── */}
            <ShotDashboard
                overallScore={fullFeedback.overallScore}
                motionType={motionType}
                richTips={fullFeedback.richTips}
                userPoseFrames={userPoseFrames}
                onDownloadPDF={handleDownloadCard}
                downloadingPDF={downloadingCard}
            />

            {/* Apple Watch motion metrics (only shown when watch data is available) */}
            <WatchMetricsPanel />
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
                {phaseEntries.map(([name, data]) => (
                    <div key={name} className="card">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-white">{getPhaseDisplayName(name)}</p>
                            <p className={`text-lg font-bold ${scoreColor(data.score)}`}>{data.score}%</p>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-accent to-accentBlue transition-all duration-500"
                                style={{ width: `${Math.min(100, data.score)}%` }}
                            />
                        </div>
                        <p className="mt-2 text-xs sm:text-sm text-slate-400 whitespace-pre-wrap leading-relaxed">
                            {data.feedback.split('\n').map((line, idx) => {
                                const trimmedLine = line.trim();
                                if (trimmedLine.startsWith('•')) {
                                    return (
                                        <span key={idx} className="flex items-start gap-2 mb-1">
                                            <span className="text-emerald-400 text-sm shrink-0">•</span>
                                            <span className="text-slate-300">{trimmedLine.substring(1).trim()}</span>
                                        </span>
                                    );
                                }
                                return <span key={idx} className="block mb-1">{trimmedLine}</span>;
                            })}
                        </p>
                    </div>
                ))}
            </div>

            {fullFeedback.visualIssues && fullFeedback.visualIssues.length > 0 && (
                <div className="card">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-sm uppercase tracking-[0.08em] text-slate-400">Visual Comparison</p>
                        <button
                            type="button"
                            className={`px-3 py-1.5 rounded-lg text-[11px] border ${motionAll ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-900/40 border-slate-700 text-slate-300'} hover:bg-slate-800/60`}
                            onClick={() => setMotionAll((v) => !v)}
                            title="Toggle GIF-like motion for all phases"
                        >
                            {motionAll ? 'Motion: ON' : 'Motion: OFF'}
                        </button>
                    </div>
                    <div className="mt-4 flex flex-col gap-6">
                        {fullFeedback.visualIssues.map((issue, idx) => (
                            <VisualIssueCard
                                key={idx}
                                issue={issue as AlignmentIssue}
                                userVideoUrl={userVideoUrl}
                                refVideoUrl={refVideoUrl}
                                motionAll={motionAll}
                                allIssues={fullFeedback.visualIssues as AlignmentIssue[]}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Biomechanical analysis – premium mode */}
            {biomechResult && (
                <div className="card">
                    <button
                        type="button"
                        className="w-full flex items-center justify-between gap-3"
                        onClick={() => setShowBiomechanics(v => !v)}
                        aria-expanded={showBiomechanics}
                    >
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-white">{t.bioTitle}</p>
                            {biomechResult.defectTags.length > 0 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300">
                                    {t.defects(biomechResult.defectTags.length)}
                                </span>
                            )}
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/40 text-slate-300">
                                {t.bioScore(biomechResult.biomechanicalScore)}
                            </span>
                        </div>
                        <span className="text-xs text-slate-400">{showBiomechanics ? t.collapse : t.expand}</span>
                    </button>
                    {showBiomechanics && (
                        <div className="mt-4">
                            <BiomechanicalPanel result={biomechResult} lang={lang} />
                        </div>
                    )}
                </div>
            )}

            {/* Injury risk – premium mode */}
            {biomechResult && (
                <div className="card">
                    <button
                        type="button"
                        className="w-full flex items-center justify-between gap-3"
                        onClick={() => setShowInjuryRisk(v => !v)}
                        aria-expanded={showInjuryRisk}
                    >
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-white">{t.injTitle}</p>
                            {biomechResult.highRiskCount > 0 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300">
                                    {t.highRisk(biomechResult.highRiskCount)}
                                </span>
                            )}
                            {biomechResult.mediumRiskCount > 0 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300">
                                    {t.medRisk(biomechResult.mediumRiskCount)}
                                </span>
                            )}
                        </div>
                        <span className="text-xs text-slate-400">{showInjuryRisk ? t.collapse : t.expand}</span>
                    </button>
                    {showInjuryRisk && (
                        <div className="mt-4">
                            <InjuryRiskPanel result={biomechResult} lang={lang} />
                        </div>
                    )}
                </div>
            )}

            <div className="card">
                <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3"
                    onClick={() => setShowTimingMovement((v) => !v)}
                    aria-expanded={showTimingMovement}
                >
                    <p className="text-sm uppercase tracking-[0.08em] text-slate-400">Timing & Movement Analysis</p>
                    <span className="text-xs text-slate-300">{showTimingMovement ? 'Hide' : 'Show'}</span>
                </button>
                {showTimingMovement && (
                    <div className="mt-4">
                        <SubtleMovementPanel data={fullFeedback.subtleMovement} />
                    </div>
                )}
            </div>

            {/* Phase Detection Debug Panel (visible in DEV or ?debug=1) */}
            <AnalysisDebugPanel issues={fullFeedback.visualIssues as AlignmentIssue[] | undefined} />

            {/* Report Download Section */}
            {showReport ? (
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-white">📊 Your Analysis Report</h3>
                        <button
                            onClick={onHideReport}
                            className="text-slate-400 hover:text-white transition-colors"
                            aria-label="Close report"
                        >
                            ✕
                        </button>
                    </div>
                    <ReportDownload
                        reportData={reportData}
                    />
                </div>
            ) : (
                <button
                    className="btn btn-accent w-full sm:w-auto"
                    onClick={handleShowReport}
                    disabled={capturingFrames}
                >
                    {capturingFrames ? (
                        <>
                            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent mr-2" />
                            Capturing Frames...
                        </>
                    ) : (
                        '📄 Download Report with QR Code'
                    )}
                </button>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
                <button className="btn btn-primary" onClick={onRetake}>
                    ← Back to Compare
                </button>
                <button className="btn btn-secondary" onClick={onReset}>
                    🏠 Start Over
                </button>
            </div>
        </div>
    );
}
