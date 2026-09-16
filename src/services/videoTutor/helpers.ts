// Private helpers: trim, phase windowing, rubric scoring, groundstroke realignment

import { MotionAnalysisService, PoseResult, AlignmentIssue } from '../MotionAnalysisRouter';
import type { AnalysisFeedback, AnalyzeTrimWindow } from './types';

export function applyTrimWindow(poses: PoseResult[], trim?: AnalyzeTrimWindow): PoseResult[] {
    if (!trim || !poses?.length) return poses;
    const start = Math.max(0, Math.min(trim.startSec, trim.endSec));
    const end = Math.max(start, Math.max(trim.startSec, trim.endSec));
    const trimmed = poses.filter((p) => p.timestamp >= start && p.timestamp <= end);
    if (trimmed.length >= 5) return trimmed;
    return poses;
}

/**
 * Compute per-phase frame windows from actual CV-detected phase timestamps.
 *
 * The 50-frame comparison sequence is uniformly sampled across the full trimmed
 * video. By mapping each detected phase timestamp into that normalized 0-50 space
 * and splitting at the midpoints between phases, we get windows that correspond
 * to the same temporal segments shown in the visual comparison flipbooks.
 *
 * Falls back to the fixed heuristic windows [0,15],[15,30],[30,40],[40,50] when
 * timestamps are insufficient (< 2 phases detected).
 */
export function computePhaseWindowsFromIssues(
    userPoses: { timestamp: number }[],
    visualIssues: AlignmentIssue[]
): Record<string, [number, number]> {
    const DEFAULT: Record<string, [number, number]> = {
        unit_turn: [0, 15],
        racket_drop: [15, 30],
        contact: [30, 40],
        follow_through: [40, 50],
    };

    if (!userPoses.length || !visualIssues.length) return DEFAULT;

    const PHASE_KEY_MAP: Record<string, string> = {
        'Unit Turn': 'unit_turn',
        'Racket Drop': 'racket_drop',
        'Contact Point': 'contact',
        'Follow Through': 'follow_through',
    };
    const EXPECTED_ORDER = ['unit_turn', 'racket_drop', 'contact', 'follow_through'];

    const phaseTimestamps: Record<string, number> = {};
    for (const issue of visualIssues) {
        const key = PHASE_KEY_MAP[issue.phase];
        if (key && !(key in phaseTimestamps)) {
            phaseTimestamps[key] = issue.timestamp;
        }
    }

    const detectedKeys = EXPECTED_ORDER.filter(k => k in phaseTimestamps);
    if (detectedKeys.length < 2) return DEFAULT;

    const firstTs = userPoses[0].timestamp;
    const lastTs = userPoses[userPoses.length - 1].timestamp;
    const duration = lastTs - firstTs;
    if (duration <= 0) return DEFAULT;

    const toFrame = (ts: number) =>
        Math.max(0, Math.min(50, ((ts - firstTs) / duration) * 50));

    const framePositions = detectedKeys.map(k => ({ key: k, frame: toFrame(phaseTimestamps[k]) }));

    const windows: Record<string, [number, number]> = {};
    for (let i = 0; i < framePositions.length; i++) {
        const start = i === 0
            ? 0
            : Math.round((framePositions[i - 1].frame + framePositions[i].frame) / 2);
        const end = i === framePositions.length - 1
            ? 50
            : Math.round((framePositions[i].frame + framePositions[i + 1].frame) / 2);
        windows[framePositions[i].key] = [start, Math.min(50, end)];
    }

    for (const key of EXPECTED_ORDER) {
        if (!(key in windows)) {
            windows[key] = DEFAULT[key];
        }
    }

    return windows;
}

/**
 * Remap AlignmentIssue phase labels → calibration key names
 * so manual user timestamps can override AI-detected ones.
 */
const PHASE_LABEL_TO_CAL_KEY: Record<string, string> = {
    'Unit Turn': 'unitTurn',
    'Racket Drop': 'racketDrop',
    'Contact Point': 'contact',
    'Contact': 'contact',
    'Follow Through': 'followThrough',
    'Preparation': 'prep',
    'Ball Toss': 'tossPeak',
    'Trophy Position': 'loading',
    'Finish': 'finish',
};

/**
 * Override `issue.timestamp` for each visualIssue using the manually-calibrated
 * user phase timestamps when available. Mutates the array in-place.
 *
 * This ensures frame capture (generateAllPhaseFrames) and comparePerformancesByPhase
 * both use the correct video position the user explicitly marked.
 */
export function applyUserPhaseTimestampsToIssues(
    issues: AlignmentIssue[],
    manualTs: Record<string, number> | null | undefined
): void {
    if (!manualTs || !issues.length) return;
    for (const issue of issues) {
        const calKey = PHASE_LABEL_TO_CAL_KEY[issue.phase];
        if (calKey && isFinite(manualTs[calKey])) {
            console.log(`[ManualCalibration] Overriding ${issue.phase} timestamp: ${issue.timestamp.toFixed(3)}s → ${manualTs[calKey].toFixed(3)}s`);
            issue.timestamp = manualTs[calKey];
        }
    }
}

/**
 * Apply angle-based coach rubric scores to an existing result.
 * Blending strategy: 70% rubric + 30% existing DTW score.
 */
export function applyCoachRubricScores(
    result: AnalysisFeedback,
    userPoses: PoseResult[],
    phaseTs: { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
    isRightHanded: boolean
): void {
    try {
        const rubric = MotionAnalysisService.computeCoachRubricScores(userPoses, phaseTs, isRightHanded);
        const RUBRIC_KEY_MAP: Record<string, keyof typeof rubric> = {
            unit_turn: 'unit_turn',
            racket_drop: 'racket_drop',
            contact: 'contact',
            follow_through: 'follow_through',
        };
        for (const [phaseKey, rubricKey] of Object.entries(RUBRIC_KEY_MAP)) {
            const rubricScore = rubric[rubricKey];
            if (!isFinite(rubricScore)) continue;
            if (result.phases?.[phaseKey]) {
                const dtwScore = result.phases[phaseKey].score ?? 50;
                // 85% rubric (floor-scaled biomechanics) + 15% DTW (floored at 40).
                // DTW body-shape similarity is too harsh for beginners; rubric drives the grade.
                result.phases[phaseKey].score = Math.round(rubricScore * 0.85 + Math.max(dtwScore, 40) * 0.15);
            }
        }
        const scores = Object.values(result.phases || {})
            .map(p => p?.score)
            .filter((v): v is number => typeof v === 'number' && isFinite(v));
        if (scores.length) {
            result.overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        }
    } catch (err) {
        console.warn('[CoachRubric] Scoring failed, keeping DTW scores:', err);
    }
}

/**
 * Post-process an analysis result to re-score each groundstroke phase using
 * CV-detected phase boundaries rather than fixed heuristic frame windows.
 * Mutates `result.phases` scores and `result.overallScore` in-place.
 */
export function realignGroundstrokeScores(
    result: AnalysisFeedback,
    frameScores: number[],
    userPoses: { timestamp: number }[],
    visualIssues: AlignmentIssue[]
): void {
    if (!frameScores.length) return;
    const windows = computePhaseWindowsFromIssues(userPoses, visualIssues);
    const avg = (arr: number[]) =>
        arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    for (const [key, [start, end]] of Object.entries(windows)) {
        if (result.phases?.[key]) {
            const slice = frameScores.slice(start, end);
            if (slice.length) result.phases[key].score = avg(slice);
        }
    }

    const scores = Object.values(result.phases || {})
        .map(p => p?.score)
        .filter((v): v is number => typeof v === 'number' && isFinite(v));
    if (scores.length) {
        result.overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
}
