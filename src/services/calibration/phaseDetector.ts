/**
 * calibration/phaseDetector.ts
 * Contact-anchored phase detection with kinematic scoring.
 * SRP: Pure temporal search — no storage, no UI.
 */

import { PoseResult } from '../MotionAnalysisRouter';
import { CalibrationExample, PHASE_DEFINITIONS, PhaseType, PoseFeatures, StrokeType } from './types';
import { extractFeatures } from './featureExtractor';
import { distanceToPhase } from './classifier';

/** Find phase frames in a pose sequence using calibrated k-NN + kinematic scoring.
 *  Returns timestamps (not frame indices) for device-agnostic results.
 *  Returns null if not enough examples.
 */
export function findPhasesWithCalibration(
    strokeType: StrokeType,
    sequence: PoseResult[],
    examples: CalibrationExample[],
    hasEnoughExamples: boolean
): { phase: PhaseType; timestamp: number; frameIndex: number; confidence: number }[] | null {
    if (!hasEnoughExamples) return null;

    const phases = PHASE_DEFINITIONS[strokeType];
    const numPhases = phases.length;
    const seqLen = sequence.length;
    if (seqLen < numPhases) return null;

    console.log(`[Calibration] Detecting phases for ${seqLen} frames`);

    // ── 1. Pre-compute per-frame features & kinematic signals ──────────────
    const featuresByFrame: PoseFeatures[] = new Array(seqLen);
    const dominantWristVelocity: number[] = new Array(seqLen).fill(0);
    const dominantElbowAngle: number[] = new Array(seqLen).fill(0);
    const trunkRotationVel: number[] = new Array(seqLen).fill(0);
    const trunkRotationArr: number[] = new Array(seqLen).fill(0);
    const domWristY: number[] = new Array(seqLen).fill(0);
    const shoulderCenterYArr: number[] = new Array(seqLen).fill(0);

    let maxRightVel = 0;
    let maxLeftVel = 0;

    for (let i = 0; i < seqLen; i++) {
        const prev = i > 0 ? sequence[i - 1] : undefined;
        const f = extractFeatures(sequence[i], prev);
        featuresByFrame[i] = f;

        maxRightVel = Math.max(maxRightVel, Math.abs(f.rightWristVelocity || 0));
        maxLeftVel = Math.max(maxLeftVel, Math.abs(f.leftWristVelocity || 0));

        dominantWristVelocity[i] = Math.max(
            Math.abs(f.rightWristVelocity || 0),
            Math.abs(f.leftWristVelocity || 0)
        );
        const useRight = Math.abs(f.rightWristVelocity || 0) >= Math.abs(f.leftWristVelocity || 0);
        dominantElbowAngle[i] = useRight ? (f.rightElbowAngle || 0) : (f.leftElbowAngle || 0);

        if (i > 0) {
            const dt = Math.max(0.001, sequence[i].timestamp - sequence[i - 1].timestamp);
            trunkRotationVel[i] = Math.abs((f.trunkRotation || 0) - (featuresByFrame[i - 1]?.trunkRotation || 0)) / dt;
        }

        trunkRotationArr[i] = f.trunkRotation ?? 0;
        const lm = sequence[i]?.landmarks;
        const shoulderY = (((lm?.[11]?.y ?? 0) + (lm?.[12]?.y ?? 0)) / 2) || 0;
        const hipY = (((lm?.[23]?.y ?? 0) + (lm?.[24]?.y ?? 0)) / 2) || 0;
        shoulderCenterYArr[i] = shoulderY;
        const dominantSideIsRight = maxRightVel >= maxLeftVel;
        const wrist = dominantSideIsRight ? lm?.[16] : lm?.[15];
        domWristY[i] = wrist?.y ?? 0;
        void hipY; // used indirectly via domWristY relative calcs below
    }

    const dominantSide = maxRightVel >= maxLeftVel ? 'right' : 'left';
    const startSearch = Math.floor(seqLen * 0.2);
    const endSearch = Math.floor(seqLen * 0.8);

    // ── Helpers ─────────────────────────────────────────────────────────────
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const safeNorm = (v: number, d: number) => d > 1e-6 ? v / d : 0;
    const maxInRange = (arr: number[], s: number, e: number) => {
        let m = 0;
        for (let i = s; i < e; i++) m = Math.max(m, arr[i] || 0);
        return m;
    };
    const minInRange = (arr: number[], s: number, e: number) => {
        let m = Infinity;
        for (let i = s; i < e; i++) m = Math.min(m, arr[i] ?? 0);
        return m;
    };

    const maxVel = maxInRange(dominantWristVelocity, startSearch, endSearch);
    const maxTrunkVel = maxInRange(trunkRotationVel, startSearch, endSearch);

    // ── 2. Kinematic phase scores ────────────────────────────────────────────
    const contactScoreAt = (i: number): number => {
        const velN = clamp01(safeNorm(dominantWristVelocity[i] || 0, maxVel));
        const rotVelN = clamp01(safeNorm(trunkRotationVel[i] || 0, maxTrunkVel));
        const extN = clamp01(((dominantElbowAngle[i] || 0) - 120) / 55);
        let score = velN * (0.55 + 0.45 * extN) + 0.35 * rotVelN;

        const ball = (sequence[i] as any)?.ball as { x: number; y: number; confidence: number } | undefined;
        if (ball && ball.confidence > 0.15 && sequence[i]?.landmarks?.length) {
            const lm = sequence[i].landmarks;
            const wIdx = dominantSide === 'right' ? 16 : 15;
            const eIdx = dominantSide === 'right' ? 14 : 13;
            const wrist = lm[wIdx];
            const elbow = lm[eIdx];
            if (wrist && elbow) {
                const racket = (sequence[i] as any)?.racket as
                    | { x0: number; y0: number; x1: number; y1: number; confidence: number }
                    | undefined;
                const ax = racket && racket.confidence > 0.25 ? racket.x0 : wrist.x;
                const ay = racket && racket.confidence > 0.25 ? racket.y0 : wrist.y;
                const bx = racket && racket.confidence > 0.25 ? racket.x1 : wrist.x + (wrist.x - elbow.x) * 1.2;
                const by = racket && racket.confidence > 0.25 ? racket.y1 : wrist.y + (wrist.y - elbow.y) * 1.2;
                const abx = bx - ax; const aby = by - ay;
                const apx = ball.x - ax; const apy = ball.y - ay;
                const ab2 = abx * abx + aby * aby;
                const t = ab2 > 1e-6 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
                const cx = ax + abx * t; const cy = ay + aby * t;
                const dist = Math.sqrt((ball.x - cx) ** 2 + (ball.y - cy) ** 2);
                const abLen = Math.sqrt(ab2);
                const prox = clamp01(1 - (abLen > 1e-6 ? dist / abLen : 1) / 0.35);
                const racketTrust = racket && racket.confidence > 0.25 ? clamp01(racket.confidence) : 0;
                score += (0.55 + 0.35 * racketTrust) * prox * clamp01(ball.confidence);
            }
        }
        return score;
    };

    const unitTurnScoreAt = (i: number, s: number, e: number): number => {
        const velN = clamp01(safeNorm(dominantWristVelocity[i] || 0, maxVel || 1));
        const wristBelowShoulder = Math.max(0, (domWristY[i] || 0) - (shoulderCenterYArr[i] || 0));
        const notDropped = clamp01(1.0 - wristBelowShoulder / 0.35);
        const tFrac = (e > s) ? (i - s) / (e - s) : 0;
        const early = clamp01(1 - tFrac);
        const trunkN = clamp01((trunkRotationArr[i] || 0) / 25);
        const elbow = dominantElbowAngle[i] || 90;
        const coiledArm = clamp01((160 - elbow) / 70);
        return 0.30 * (1 - velN) + 0.30 * notDropped + 0.20 * early + 0.10 * trunkN + 0.10 * coiledArm;
    };

    const racketDropScoreAt = (i: number, s: number, e: number): number => {
        const wMax = maxInRange(domWristY, s, e);
        const wMin = minInRange(domWristY, s, e);
        const wristLowN = (wMax > wMin + 1e-6) ? clamp01((domWristY[i] - wMin) / (wMax - wMin)) : 0;
        const wristBelowShoulder = Math.max(0, (domWristY[i] || 0) - (shoulderCenterYArr[i] || 0));
        const dropAbsN = clamp01(wristBelowShoulder / 0.35);
        const combinedDropN = 0.65 * wristLowN + 0.35 * dropAbsN;
        const elbow = dominantElbowAngle[i] || 0;
        const flexN = clamp01((160 - elbow) / 60);
        const velN = clamp01(safeNorm(dominantWristVelocity[i] || 0, maxVel || 1));
        return 0.55 * combinedDropN + 0.25 * flexN + 0.20 * (1 - velN);
    };

    const followThroughScoreAt = (i: number, _s: number, _e: number): number => {
        const aboveN = clamp01(((shoulderCenterYArr[i] || 0) - (domWristY[i] || 0)) / 0.25);
        const velN = clamp01(safeNorm(dominantWristVelocity[i] || 0, maxVel || 1));
        const trunkN = clamp01((trunkRotationArr[i] || 0) / 25);
        return 0.45 * aboveN + 0.30 * (1 - velN) + 0.25 * trunkN;
    };

    const indexForTime = (t: number): number => {
        if (!isFinite(t)) return 0;
        let bestIdx = 0; let bestDiff = Infinity;
        for (let i = 0; i < seqLen; i++) {
            const d = Math.abs((sequence[i]?.timestamp ?? 0) - t);
            if (d < bestDiff) { bestDiff = d; bestIdx = i; }
        }
        return bestIdx;
    };

    const findBestInRange = (
        phase: PhaseType,
        start: number,
        end: number,
        kinScore?: (i: number, s: number, e: number) => number
    ): { idx: number; dist: number } => {
        start = Math.max(0, start);
        end = Math.min(seqLen, end);
        let bestIdx = Math.max(0, Math.min(seqLen - 1, start));
        let bestScore = -Infinity;
        let bestDist = Infinity;
        if (start >= end) return { idx: bestIdx, dist: Infinity };

        for (let i = start; i < end; i++) {
            if (!sequence[i]) continue;
            const prev = i > 0 ? sequence[i - 1] : undefined;
            const dist = distanceToPhase(examples, sequence[i], phase, prev);
            const distConf = clamp01(1 - dist / 2.5);
            const k = kinScore ? clamp01(kinScore(i, start, end)) : 0;
            const score = 0.55 * distConf + 0.45 * k;
            if (score > bestScore) { bestScore = score; bestDist = dist; bestIdx = i; }
        }
        return { idx: bestIdx, dist: bestDist };
    };

    // ── 3. Anchor: find contact frame ────────────────────────────────────────
    const contactPhase = 'contact' as PhaseType;
    const contactPhaseIdx = phases.findIndex(p => p === contactPhase);
    if (contactPhaseIdx === -1) {
        console.error('[Calibration] Contact phase not found in phases', phases);
        return null;
    }

    let bestContactIdx = -1;

    if (strokeType !== 'serve') {
        let bestScore = -Infinity;
        for (let i = startSearch; i < endSearch; i++) {
            const s = contactScoreAt(i);
            if (s > bestScore) { bestScore = s; bestContactIdx = i; }
        }
        if (!(bestScore > 0.25)) bestContactIdx = -1;
    }

    if (bestContactIdx < 0) {
        let bestDist = Infinity;
        for (let i = startSearch; i < endSearch; i++) {
            const prev = i > 0 ? sequence[i - 1] : undefined;
            const d = distanceToPhase(examples, sequence[i], contactPhase, prev);
            if (d < bestDist) { bestDist = d; bestContactIdx = i; }
        }
    }

    // ── 4. Search backwards/forwards from contact ────────────────────────────
    const foundIndices = new Array(numPhases).fill(-1);
    foundIndices[contactPhaseIdx] = bestContactIdx;

    const contactTime = sequence[bestContactIdx]?.timestamp ?? 0;
    const windowsByPhase: Partial<Record<PhaseType, { startIdx: number; endIdx: number }>> = {};

    if (strokeType !== 'serve' && isFinite(contactTime) && contactTime > 0) {
        windowsByPhase['unit_turn' as PhaseType] = {
            startIdx: 0,
            endIdx: Math.max(1, indexForTime(Math.max(0, contactTime - 0.35))),
        };
        windowsByPhase['racket_drop' as PhaseType] = {
            startIdx: Math.max(0, indexForTime(Math.max(0, contactTime - 0.90))),
            endIdx: Math.max(1, indexForTime(Math.max(0, contactTime - 0.08))),
        };
        windowsByPhase['follow_through' as PhaseType] = {
            startIdx: Math.min(seqLen - 1, indexForTime(contactTime + 0.08)),
            endIdx: seqLen,
        };
    }

    // Backwards
    for (let i = contactPhaseIdx - 1; i >= 0; i--) {
        const phase = phases[i];
        const nextIdx = foundIndices[i + 1];
        const gap = nextIdx > 10 ? 5 : 1;
        const searchEnd = Math.max(0, nextIdx - gap);
        const w = windowsByPhase[phase];
        const cStart = w ? Math.max(0, w.startIdx) : 0;
        const cEnd = w ? Math.min(searchEnd, w.endIdx) : searchEnd;
        const validEnd = Math.max(cStart + 1, cEnd);

        const kin = (idx: number, s: number, e: number) => {
            if (phase === ('unit_turn' as PhaseType)) return unitTurnScoreAt(idx, s, e);
            if (phase === ('racket_drop' as PhaseType)) return racketDropScoreAt(idx, s, e);
            return 0;
        };
        foundIndices[i] = findBestInRange(phase, cStart, validEnd, kin).idx;
    }

    // Forwards
    for (let i = contactPhaseIdx + 1; i < numPhases; i++) {
        const phase = phases[i];
        const prevIdx = foundIndices[i - 1];
        const gap = (seqLen - prevIdx) > 10 ? 5 : 1;
        const searchStart = Math.min(seqLen - 1, prevIdx + gap);
        const w = windowsByPhase[phase];
        const cStart = w ? Math.max(searchStart, w.startIdx) : searchStart;
        const cEnd = w ? Math.min(seqLen, w.endIdx) : seqLen;

        const kin = (idx: number, s: number, e: number) =>
            phase === ('follow_through' as PhaseType) ? followThroughScoreAt(idx, s, e) : 0;
        foundIndices[i] = findBestInRange(phase, cStart, cEnd, kin).idx;
    }

    // ── 5. Compile results ───────────────────────────────────────────────────
    const results: { phase: PhaseType; timestamp: number; frameIndex: number; confidence: number }[] = [];
    for (let i = 0; i < numPhases; i++) {
        const phase = phases[i];
        const frameIdx = foundIndices[i];
        if (frameIdx < 0 || frameIdx >= seqLen || !sequence[frameIdx]) continue;

        const prev = frameIdx > 0 ? sequence[frameIdx - 1] : undefined;
        const dist = distanceToPhase(examples, sequence[frameIdx], phase, prev);
        const confidence = Math.max(0, Math.min(1, 1 - dist / 2.5));
        results.push({ phase, timestamp: sequence[frameIdx].timestamp, frameIndex: frameIdx, confidence });
    }

    return results;
}
