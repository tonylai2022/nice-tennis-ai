/**
 * Tennis Phase Ensemble Detection
 *
 * Fuses calibration-based, DTW-based, and kinematic phase detectors into a single
 * robust phase estimate for any tennis stroke. Also contains phase-ordering and
 * temporal-consistency enforcement logic.
 *
 * Dependency note: this module must NOT import from the stroke files (forehand/
 * backhand/serve). To avoid the circular dependency, callers (stroke files) compute
 * their own `refAnchors` and pass them in.
 */

import type { PoseResult } from '../BaseMotionAnalysis';
import { CalibrationService } from '../../CalibrationService';
import type { StrokeType, PhaseType } from '../../CalibrationService';
import {
    smoothArray,
    calculateLandmarkVelocity3D,
    extractKinematicFeatures,
    resampleSequence,
    resampleArray,
} from './poseUtils';

export type { PoseResult, StrokeType, PhaseType };

// Canonical alias for the per-phase map type — used throughout all stroke files
export type PhaseMap = Map<PhaseType, {
    frame: PoseResult;
    timestamp: number;
    frameIndex: number;
    confidence: number;
}>;

// ─── Calibration-Based Phase Detection ───────────────────────────────────────

/**
 * Attempts to find user phases using the CalibrationService (kNN).
 * Returns null when not enough calibration examples exist.
 */
export function getUserPhasesWithCalibration(
    strokeType: StrokeType,
    userSequence: PoseResult[]
): PhaseMap | null {
    const result: PhaseMap = new Map();

    if (!CalibrationService.hasEnoughExamples(strokeType)) {
        console.log('[PhaseSync] No calibration data, falling back to kinetic detection');
        return null;
    }

    const phases = CalibrationService.findPhasesWithCalibration(strokeType, userSequence);
    if (!phases || phases.length === 0) {
        console.log('[PhaseSync] Calibration-based detection returned no phases');
        return null;
    }

    console.log('[PhaseSync] Found user phases via calibration:',
        phases.map(p => `${p.phase}@${p.timestamp.toFixed(2)}s (frame ${p.frameIndex})`).join(', ')
    );

    for (const p of phases) {
        if (p.frameIndex >= 0 && p.frameIndex < userSequence.length) {
            result.set(p.phase, {
                frame: userSequence[p.frameIndex],
                timestamp: p.timestamp,
                frameIndex: p.frameIndex,
                confidence: p.confidence,
            });
        }
    }
    return result;
}

// ─── Calibrated Phase Sanity Checks ──────────────────────────────────────────

/**
 * Validates that the calibration-derived phase map passes biomechanical sanity:
 * required phases present, monotonically ordered, not temporally collapsed,
 * and not uniformly low-confidence.
 */
export function shouldUseCalibratedUserPhases(
    strokeType: 'forehand' | 'backhand' | 'serve',
    calibratedUserPhases: PhaseMap,
    activeSequence: PoseResult[]
): { use: boolean; reason: string } {
    if (!calibratedUserPhases || calibratedUserPhases.size === 0) {
        return { use: false, reason: 'no calibrated phases' };
    }

    const phaseOrder: PhaseType[] =
        strokeType === 'serve'
            ? (['preparation', 'ball_toss', 'loading', 'contact', 'finish'] as const)
            : (['unit_turn', 'racket_drop', 'contact', 'follow_through'] as const);

    const required: PhaseType[] =
        strokeType === 'serve'
            ? (['contact', 'loading'] as const)
            : (['contact'] as const);

    for (const req of required) {
        if (!calibratedUserPhases.has(req)) {
            return { use: false, reason: `missing required phase: ${req}` };
        }
    }

    const present = phaseOrder
        .map(p => ({ p, data: calibratedUserPhases.get(p) }))
        .filter(x => !!x.data && typeof x.data.frameIndex === 'number');

    if (present.length < 2) {
        return { use: false, reason: 'too few calibrated phases present' };
    }

    for (let i = 1; i < present.length; i++) {
        const prevIdx = present[i - 1].data!.frameIndex;
        const curIdx = present[i].data!.frameIndex;
        if (!(curIdx > prevIdx)) {
            return { use: false, reason: 'non-monotonic calibrated phase order' };
        }
    }

    const times = present
        .map(x => {
            const t = typeof x.data!.timestamp === 'number'
                ? x.data!.timestamp
                : (activeSequence[x.data!.frameIndex]?.timestamp ?? NaN);
            return t;
        })
        .filter(t => isFinite(t));

    if (times.length >= 2) {
        const spread = Math.max(...times) - Math.min(...times);
        const minSpread = strokeType === 'serve' ? 0.45 : 0.25;
        if (spread < minSpread) {
            return { use: false, reason: `calibrated phases collapsed (spread=${spread.toFixed(2)}s)` };
        }
    }

    const confs = present.map(x => Number(x.data!.confidence)).filter(c => isFinite(c));
    if (confs.length > 0) {
        const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
        if (avg < 0.15) {
            return { use: false, reason: `very low avg calibration confidence (${avg.toFixed(2)})` };
        }
    }

    return { use: true, reason: 'calibrated phases passed sanity checks' };
}

// ─── Temporal Consistency Enforcement ────────────────────────────────────────

/**
 * Adjusts or removes phases whose inter-phase frame gaps violate biomechanical constraints.
 * Returns a corrected copy of the phase map.
 */
export function enforceTemporalConsistency(
    phases: PhaseMap,
    strokeType: StrokeType,
    videoLength: number
): PhaseMap {
    const result: PhaseMap = new Map(phases);

    const constraints = strokeType === 'serve'
        ? {
            min: { preparation_to_toss: 10, toss_to_loading: 5, loading_to_contact: 3, contact_to_finish: 5 },
            max: { preparation_to_toss: 45, toss_to_loading: 20, loading_to_contact: 15, contact_to_finish: 30 },
        }
        : {
            min: { turn_to_drop: 8, drop_to_contact: 5, contact_to_follow: 5 },
            max: { turn_to_drop: 40, drop_to_contact: 25, contact_to_follow: 35 },
        };

    if (strokeType === 'serve') {
        const prep = result.get('preparation');
        const toss = result.get('ball_toss');
        const loading = result.get('loading');
        const contact = result.get('contact');
        const finish = result.get('finish');

        const c = constraints as typeof constraints & {
            min: { preparation_to_toss: number; toss_to_loading: number; loading_to_contact: number; contact_to_finish: number };
            max: { preparation_to_toss: number; toss_to_loading: number; loading_to_contact: number; contact_to_finish: number };
        };

        if (prep && toss) {
            const gap = toss.frameIndex - prep.frameIndex;
            if (gap < c.min.preparation_to_toss || gap > c.max.preparation_to_toss) {
                console.log(`[Temporal] Serve prep→toss gap ${gap} invalid, removing preparation`);
                result.delete('preparation');
            }
        }
        if (toss && loading) {
            const gap = loading.frameIndex - toss.frameIndex;
            if (gap < c.min.toss_to_loading || gap > c.max.toss_to_loading) {
                console.log(`[Temporal] Serve toss→loading gap ${gap} invalid, adjusting loading`);
                result.set('loading', {
                    ...loading,
                    frameIndex: Math.min(videoLength - 10, toss.frameIndex + Math.floor((c.min.toss_to_loading + c.max.toss_to_loading) / 2)),
                    confidence: loading.confidence * 0.8,
                });
            }
        }
        if (loading && contact) {
            const gap = contact.frameIndex - loading.frameIndex;
            if (gap < c.min.loading_to_contact || gap > c.max.loading_to_contact) {
                const adjusted = result.get('loading')!;
                console.log(`[Temporal] Serve loading→contact gap ${gap} invalid, adjusting loading`);
                result.set('loading', {
                    ...adjusted,
                    frameIndex: Math.max(0, contact.frameIndex - Math.floor((c.min.loading_to_contact + c.max.loading_to_contact) / 2)),
                    confidence: adjusted.confidence * 0.8,
                });
            }
        }
        if (contact && finish) {
            const gap = finish.frameIndex - contact.frameIndex;
            if (gap < c.min.contact_to_finish) {
                console.log(`[Temporal] Serve contact→finish gap ${gap} too small, adjusting`);
                result.set('finish', {
                    ...finish,
                    frameIndex: Math.min(videoLength - 1, contact.frameIndex + c.min.contact_to_finish),
                    confidence: finish.confidence * 0.9,
                });
            }
        }

    } else {
        const turn = result.get('unit_turn');
        const drop = result.get('racket_drop');
        const contact = result.get('contact');
        const follow = result.get('follow_through');

        const c = constraints as typeof constraints & {
            min: { turn_to_drop: number; drop_to_contact: number; contact_to_follow: number };
            max: { turn_to_drop: number; drop_to_contact: number; contact_to_follow: number };
        };

        if (turn && drop) {
            const gap = drop.frameIndex - turn.frameIndex;
            if (gap < c.min.turn_to_drop) {
                console.log(`[Temporal] ${strokeType} turn→drop gap ${gap} too small, adjusting drop`);
                result.set('racket_drop', {
                    ...drop,
                    frameIndex: Math.min(videoLength - 10, turn.frameIndex + c.min.turn_to_drop),
                    confidence: drop.confidence * 0.9,
                });
            } else if (gap > c.max.turn_to_drop) {
                console.log(`[Temporal] ${strokeType} turn→drop gap ${gap} too large, removing turn`);
                result.delete('unit_turn');
            }
        }
        if (drop && contact) {
            const gap = contact.frameIndex - drop.frameIndex;
            if (gap < c.min.drop_to_contact || gap > c.max.drop_to_contact) {
                const adjusted = result.get('racket_drop')!;
                console.log(`[Temporal] ${strokeType} drop→contact gap ${gap} invalid, adjusting drop`);
                result.set('racket_drop', {
                    ...adjusted,
                    frameIndex: Math.max(0, contact.frameIndex - Math.floor((c.min.drop_to_contact + c.max.drop_to_contact) / 2)),
                    confidence: adjusted.confidence * 0.85,
                });
            }
        }
        if (contact && follow) {
            const gap = follow.frameIndex - contact.frameIndex;
            if (gap < c.min.contact_to_follow) {
                console.log(`[Temporal] ${strokeType} contact→follow gap ${gap} too small`);
                result.set('follow_through', {
                    ...follow,
                    frameIndex: Math.min(videoLength - 1, contact.frameIndex + c.min.contact_to_follow),
                    confidence: follow.confidence * 0.9,
                });
            } else if (gap > c.max.contact_to_follow) {
                console.log(`[Temporal] ${strokeType} contact→follow gap ${gap} too large`);
                result.set('follow_through', {
                    ...follow,
                    frameIndex: Math.min(videoLength - 1, contact.frameIndex + c.max.contact_to_follow),
                    confidence: follow.confidence * 0.8,
                });
            }
        }
    }

    console.log(`[Temporal] Consistency check complete for ${strokeType}`);
    return result;
}

// ─── Phase Ensemble Fusion ────────────────────────────────────────────────────

/**
 * Fuses multiple phase-detection methods (calibration + DTW + kinematics) using
 * weighted voting with outlier rejection. Phases that are spatially clustered
 * (all within ~20-40% of video) are preferred.
 */
export function fusePhaseEnsemble(
    ensemble: Array<{
        method: string;
        phases: PhaseMap;
        weight: number;
    }>,
    videoLength: number,
    strokeType: StrokeType
): PhaseMap {
    const clusterScores = ensemble.map(entry => {
        const frames = Array.from(entry.phases.values()).map(p => p.frameIndex);
        if (frames.length < 2) return { entry, score: 0, span: 0 };
        const span = Math.max(...frames) - Math.min(...frames);
        const spanPercent = span / videoLength;
        let score = entry.weight;
        if (spanPercent > 0.5) {
            score *= 0.3;
            console.log(`[Ensemble] ${entry.method} phases too spread (${(spanPercent * 100).toFixed(1)}%), reducing weight`);
        } else if (spanPercent < 0.4) {
            score *= 1.5;
            console.log(`[Ensemble] ${entry.method} phases well-clustered (${(spanPercent * 100).toFixed(1)}%), boosting weight`);
        }
        return { entry, score, span };
    });

    if (clusterScores.length === 1) return new Map(clusterScores[0].entry.phases);

    const bestCluster = clusterScores.reduce((a, b) => a.score > b.score ? a : b);
    const otherScores = clusterScores.filter(c => c !== bestCluster);
    const secondBest = otherScores.length
        ? otherScores.reduce((a, b) => a.score > b.score ? a : b)
        : clusterScores[0];

    if (bestCluster.score > secondBest.score * 1.3) {
        console.log(`[Ensemble] ${bestCluster.entry.method} dominant (${bestCluster.score.toFixed(2)} vs ${secondBest.score.toFixed(2)}), using exclusively`);
        return new Map(bestCluster.entry.phases);
    }

    const result: PhaseMap = new Map();
    const phaseTypes: PhaseType[] = strokeType === 'serve'
        ? ['preparation', 'ball_toss', 'loading', 'contact', 'finish']
        : ['unit_turn', 'racket_drop', 'contact', 'follow_through'];

    for (const phase of phaseTypes) {
        const predictions = ensemble
            .map(e => ({ frame: e.phases.get(phase)?.frameIndex, conf: e.phases.get(phase)?.confidence ?? 0, weight: e.weight, method: e.method, data: e.phases.get(phase) }))
            .filter(p => p.data !== undefined) as Array<{ frame: number; conf: number; weight: number; method: string; data: NonNullable<PhaseMap extends Map<any, infer V> ? V : never> }>;

        if (predictions.length === 0) continue;

        const frames = predictions.map(p => p.frame).sort((a, b) => a - b);
        const medianFrame = frames[Math.floor(frames.length / 2)];
        const threshold = videoLength * 0.15;
        const inliers = predictions.filter(p => Math.abs(p.frame - medianFrame) < threshold);

        if (inliers.length === 0) {
            const best = predictions.reduce((a, b) => (a.weight * a.conf) > (b.weight * b.conf) ? a : b);
            console.log(`[Ensemble] ${phase}: all outliers, using ${best.method}@${best.frame}`);
            if (best.data) result.set(phase, best.data);
            continue;
        }

        let sumWeighted = 0; let sumWeights = 0; let sumConf = 0;
        for (const p of inliers) {
            const w = p.weight * p.conf;
            sumWeighted += p.frame * w;
            sumWeights += w;
            sumConf += p.conf;
        }
        const fusedFrame = Math.round(sumWeighted / sumWeights);
        const fusedConf = sumConf / inliers.length;

        const bestEntry = inliers.reduce((a, b) =>
            Math.abs(a.frame - fusedFrame) < Math.abs(b.frame - fusedFrame) ? a : b
        );
        if (bestEntry.data) {
            result.set(phase, { ...bestEntry.data, frameIndex: fusedFrame, confidence: fusedConf });
        }
        console.log(`[Ensemble] ${phase}: fused frame=${fusedFrame} conf=${fusedConf.toFixed(2)} from [${inliers.map(p => `${p.method}@${p.frame}`).join(', ')}]`);
    }
    return result;
}

// ─── DTW-Based Phase Transfer (Angle-Invariant) ───────────────────────────────

/**
 * Transfers reference video phase timestamps to the user video using DTW alignment
 * on rotation-invariant kinematic features (elbow angle, trunk angle, angular velocity).
 *
 * IMPORTANT: `refAnchors` must be provided by the caller (stroke file). This avoids
 * importing stroke files here which would create a circular dependency.
 *
 * @param refAnchors  Phase → timestamp mapping for the reference video (computed by caller).
 */
export function getUserPhasesByDTWTransfer(
    strokeType: StrokeType,
    userSequence: PoseResult[],
    refSequence: PoseResult[],
    refAnchors: Map<PhaseType, { timestamp: number }>
): PhaseMap | null {
    if (userSequence.length < 10 || refSequence.length < 10) return null;

    const phaseOrder: PhaseType[] = strokeType === 'serve'
        ? (['preparation', 'ball_toss', 'loading', 'contact', 'finish'] as const)
        : (['unit_turn', 'racket_drop', 'contact', 'follow_through'] as const);

    if (!refAnchors.has('contact')) return null;

    // ── Handedness detection (simple heuristic) ──
    const avg = (arr: number[]) => {
        const v = arr.filter(x => isFinite(x) && x > 0);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    };
    const rWVel = smoothArray(calculateLandmarkVelocity3D(userSequence, 16), 5);
    const lWVel = smoothArray(calculateLandmarkVelocity3D(userSequence, 15), 5);
    const isRightHanded = avg(rWVel) >= avg(lWVel);

    // ── Extract rotation-invariant kinematic features ──
    const userFeatures = extractKinematicFeatures(userSequence, isRightHanded);
    const refFeatures = extractKinematicFeatures(refSequence, isRightHanded);

    const targetLen = 100;
    const uAngle = resampleArray(userFeatures.elbowAngle, targetLen);
    const uTrunk = resampleArray(userFeatures.trunkAngle, targetLen);
    const uAngVel = resampleArray(userFeatures.armAngularVelocity, targetLen);
    const rAngle = resampleArray(refFeatures.elbowAngle, targetLen);
    const rTrunk = resampleArray(refFeatures.trunkAngle, targetLen);
    const rAngVel = resampleArray(refFeatures.armAngularVelocity, targetLen);

    // ── Angle-based DTW ──
    const n = targetLen; const m = targetLen;
    const dtw = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    dtw[0][0] = 0;

    const maxAngVel = Math.max(1, ...uAngVel, ...rAngVel);
    const angleCost = (ui: number, ri: number) => {
        const d1 = Math.abs(uAngle[ui] - rAngle[ri]) / 180;
        const d2 = Math.abs(uTrunk[ui] - rTrunk[ri]) / 180;
        const d3 = Math.abs(uAngVel[ui] - rAngVel[ri]) / maxAngVel;
        return d1 * 0.5 + d2 * 0.3 + d3 * 0.2;
    };

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dtw[i][j] = angleCost(i - 1, j - 1) + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
        }
    }

    // Backtrack
    const path: [number, number][] = [];
    let i = n; let j = m;
    while (i > 0 || j > 0) {
        path.unshift([i - 1, j - 1]);
        if (i > 0 && j > 0) {
            const min = Math.min(dtw[i - 1][j - 1], dtw[i - 1][j], dtw[i][j - 1]);
            if (min === dtw[i - 1][j - 1]) { i--; j--; }
            else if (min === dtw[i - 1][j]) { i--; }
            else { j--; }
        } else if (i > 0) { i--; }
        else { j--; }
    }
    if (path.length < 5) return null;

    // ── Map ref phase timestamps → user frame indices ──
    const userR = resampleSequence(userSequence, targetLen);
    const refR = resampleSequence(refSequence, targetLen);

    const nearestIdx = (seq: PoseResult[], t: number) => {
        let bestIdx = 0; let bestDiff = Infinity;
        for (let k = 0; k < seq.length; k++) {
            const d = Math.abs((seq[k]?.timestamp ?? 0) - t);
            if (d < bestDiff) { bestDiff = d; bestIdx = k; }
        }
        return bestIdx;
    };

    const mapRefIdxToUserIdx = (refIdx: number) => {
        let best = 0; let bestDist = Infinity;
        for (const [u, r] of path) {
            const d = Math.abs(r - refIdx);
            if (d < bestDist) { bestDist = d; best = u; if (d === 0) break; }
        }
        return best;
    };

    const result: PhaseMap = new Map();
    const mappedIndices: number[] = [];

    for (const phase of phaseOrder) {
        const anchor = refAnchors.get(phase);
        if (!anchor) continue;

        const refIdxR = nearestIdx(refR, anchor.timestamp);
        const userIdxR = mapRefIdxToUserIdx(refIdxR);
        const userTime = userR[userIdxR]?.timestamp;
        const userIdx = typeof userTime === 'number' && isFinite(userTime)
            ? nearestIdx(userSequence, userTime)
            : Math.round((userIdxR / Math.max(1, userR.length - 1)) * (userSequence.length - 1));

        const conf = 1.0 - angleCost(userIdxR, refIdxR);
        if (userIdx >= 0 && userIdx < userSequence.length) {
            result.set(phase, {
                frame: userSequence[userIdx],
                timestamp: userSequence[userIdx].timestamp,
                frameIndex: userIdx,
                confidence: Math.max(0, Math.min(1, conf)),
            });
            mappedIndices.push(userIdx);
        }
    }

    if (!result.has('contact') || result.size < 2) return null;

    // Monotonicity check
    for (let k = 1; k < mappedIndices.length; k++) {
        if (!(mappedIndices[k] > mappedIndices[k - 1])) return null;
    }

    const confs = Array.from(result.values()).map(v => v.confidence).filter(c => isFinite(c));
    const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
    if (avgConf < 0.20) return null;

    console.log(`[DTW Angle-Based] Matched phases with avg confidence ${avgConf.toFixed(2)}`);
    return result;
}
