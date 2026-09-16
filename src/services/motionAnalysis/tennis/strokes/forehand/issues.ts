import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import { calculateAngle3D } from '../../poseUtils';
import { applyDtwRefAlignmentToIssues } from '../../dtw';
import { shouldUseDtwAlignment } from '../../phaseConfig';

type UserPhaseEntry = { frame: PoseResult; timestamp: number; frameIndex: number; confidence: number };

export interface ForehandIssuesParams {
    activeSequence: PoseResult[];
    activeRefSequence: PoseResult[];
    unitTurnIdx: number;
    racketDropIdx: number;
    contactIdx: number;
    followThroughIdx: number;
    isRightHanded: boolean;
    finalUserPhases: Map<string, UserPhaseEntry>;
    getRefFrame: (phaseName: string) => PoseResult | null;
    getRefTimestamp: (phaseName: string, frame: PoseResult | null) => number | undefined;
}

export function generateForehandIssues(params: ForehandIssuesParams): AlignmentIssue[] {
    const {
        activeSequence, activeRefSequence,
        unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx,
        isRightHanded, finalUserPhases, getRefFrame, getRefTimestamp,
    } = params;

    const issues: AlignmentIssue[] = [];
    const len = activeSequence.length;

    // Adaptive landmarks based on handedness
    const shoulderIdx = isRightHanded ? 12 : 11;
    const elbowIdx = isRightHanded ? 14 : 13;
    const wristIdx = isRightHanded ? 16 : 15;
    const hipIdx = isRightHanded ? 24 : 23;
    const kneeIdx = isRightHanded ? 26 : 25;
    const ankleIdx = isRightHanded ? 28 : 27;

    const getRacketTipY = (frame: PoseResult) => {
        const f: any = frame as any;
        const racket = f?.racket as { x0: number; y0: number; x1: number; y1: number; confidence: number } | undefined;
        if (racket && racket.confidence > 0.25 && isFinite(racket.y1)) return racket.y1;
        const lm = frame?.landmarks;
        const w = lm?.[wristIdx];
        const e = lm?.[elbowIdx];
        if (w && e && isFinite(w.y) && isFinite(e.y) && isFinite(w.x) && isFinite(e.x)) {
            const dy = w.y - e.y;
            const dx = w.x - e.x;
            return (w.y ?? 0) + Math.abs(dy) * 0.45 + Math.abs(dx) * 0.20;
        }
        return NaN;
    };

    const lagAngleDegAt = (frame: PoseResult) => {
        const lm = frame?.landmarks;
        if (!lm || !lm[elbowIdx] || !lm[wristIdx]) return NaN;
        const elbow = lm[elbowIdx];
        const wrist = lm[wristIdx];
        const dy = wrist.y - elbow.y;
        const dx = wrist.x - elbow.x;
        if (!isFinite(dy) || !isFinite(dx)) return NaN;
        return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
    };

    const analyzeJoint = (
        userFrame: PoseResult,
        refFrame: PoseResult | null,
        lmIdxA: number,
        lmIdxB: number,
        lmIdxC: number
    ): { userAngle: number; refAngle: number | null; diff: number | null } => {
        const uLM = userFrame.worldLandmarks || userFrame.landmarks;
        const rLM = refFrame ? (refFrame.worldLandmarks || refFrame.landmarks) : null;

        if (!uLM[lmIdxA] || !uLM[lmIdxB] || !uLM[lmIdxC]) {
            return { userAngle: 0, refAngle: null, diff: null };
        }

        const userAngle = calculateAngle3D(uLM[lmIdxA], uLM[lmIdxB], uLM[lmIdxC]);

        if (rLM && rLM[lmIdxA] && rLM[lmIdxB] && rLM[lmIdxC]) {
            const refAngle = calculateAngle3D(rLM[lmIdxA], rLM[lmIdxB], rLM[lmIdxC]);
            return { userAngle, refAngle, diff: userAngle - refAngle };
        }

        return { userAngle, refAngle: null, diff: null };
    };

    const getUserFrame = (phaseName: string): PoseResult | null => {
        let internalPhase: string | null = null;
        if (phaseName === 'Unit Turn') internalPhase = 'unit_turn';
        if (phaseName === 'Racket Drop') internalPhase = 'racket_drop';
        if (phaseName === 'Contact Point') internalPhase = 'contact';
        if (phaseName === 'Follow Through') internalPhase = 'follow_through';

        if (internalPhase && finalUserPhases.has(internalPhase)) {
            const phaseData = finalUserPhases.get(internalPhase)!;
            console.log(`[Forehand] Using phase for ${phaseName} at t=${phaseData.timestamp.toFixed(2)}s frame=${phaseData.frameIndex}`);
            return phaseData.frame;
        }
        return null;
    };

    // ========== PHASE 1: UNIT TURN ==========
    const unitTurnFrame = getUserFrame('Unit Turn');
    const refUnitTurnFrame = getRefFrame('Unit Turn');

    if (unitTurnFrame) {
        let feedback = 'Good shoulder turn preparation';
        let color = 'green';
        let targetLandmark = shoulderIdx;

        const userShoulderWidth = Math.abs(unitTurnFrame.landmarks[11].x - unitTurnFrame.landmarks[12].x);
        const refShoulderWidth = refUnitTurnFrame ? Math.abs(refUnitTurnFrame.landmarks[11].x - refUnitTurnFrame.landmarks[12].x) : null;

        if (refShoulderWidth !== null && userShoulderWidth > refShoulderWidth * 1.15) {
            feedback = 'Turn shoulders more - coil your body like the pro';
            color = 'red';
        }

        const elbowCheck = analyzeJoint(unitTurnFrame, refUnitTurnFrame, hipIdx, shoulderIdx, elbowIdx);
        if (elbowCheck.diff !== null && Math.abs(elbowCheck.diff) > 20) {
            if (elbowCheck.diff > 20) {
                feedback = 'Keep elbow closer to body during unit turn';
                color = 'orange';
                targetLandmark = elbowIdx;
            } else if (elbowCheck.diff < -20) {
                feedback = 'Lift elbow slightly higher during preparation';
                color = 'orange';
                targetLandmark = elbowIdx;
            }
        }

        issues.push({
            phase: 'Unit Turn',
            issue: feedback,
            timestamp: unitTurnFrame.timestamp,
            landmarks: unitTurnFrame.landmarks,
            worldLandmarks: unitTurnFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Unit Turn', refUnitTurnFrame),
            refLandmarks: refUnitTurnFrame?.landmarks,
            refWorldLandmarks: refUnitTurnFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' }
        });
    }

    // ========== PHASE 2: RACKET DROP ==========
    const racketDropFrame = getUserFrame('Racket Drop');
    const refRacketDropFrame = getRefFrame('Racket Drop');

    if (racketDropFrame) {
        let feedback = 'Good racket drop and knee bend';
        let color = 'green';
        let targetLandmark = wristIdx;

        const kneeCheck = analyzeJoint(racketDropFrame, refRacketDropFrame, hipIdx, kneeIdx, ankleIdx);
        if (kneeCheck.diff !== null && kneeCheck.diff > 15) {
            feedback = 'Bend your knees more - load up for power like the pro';
            color = 'red';
            targetLandmark = 26;
        } else if (kneeCheck.userAngle > 160) {
            feedback = 'Bend your knees more for power generation';
            color = 'orange';
            targetLandmark = kneeIdx;
        }

        const wristY = racketDropFrame.landmarks[wristIdx].y;
        const elbowY = racketDropFrame.landmarks[elbowIdx].y;
        if (wristY < elbowY) {
            feedback = 'Drop racket head lower - let it fall below your hand';
            color = 'red';
            targetLandmark = wristIdx;
        }

        issues.push({
            phase: 'Racket Drop',
            issue: feedback,
            timestamp: racketDropFrame.timestamp,
            landmarks: racketDropFrame.landmarks,
            worldLandmarks: racketDropFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Racket Drop', refRacketDropFrame),
            refLandmarks: refRacketDropFrame?.landmarks,
            refWorldLandmarks: refRacketDropFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' }
        });
    }

    // ========== PHASE 3: CONTACT POINT ==========
    const contactPointFrame = getUserFrame('Contact Point');
    const refContactFrame = getRefFrame('Contact Point');

    if (contactPointFrame) {
        let feedback = 'Good contact point position';
        let color = 'green';
        let targetLandmark = wristIdx;
        let metricSuffix = '';
        const contactMetrics: Record<string, number | string | boolean | null> = {};
        const contactDebug: Record<string, unknown> = {
            events: { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx },
            timestamps: {
                unitTurnSec: activeSequence[unitTurnIdx]?.timestamp,
                racketDropSec: activeSequence[racketDropIdx]?.timestamp,
                contactSec: activeSequence[contactIdx]?.timestamp,
                followThroughSec: activeSequence[followThroughIdx]?.timestamp,
            },
        };

        try {
            const dropFrame = getUserFrame('Racket Drop');
            const ctFrame = contactPointFrame;
            const dropTipY = dropFrame ? getRacketTipY(dropFrame) : NaN;
            const ctTipY = getRacketTipY(ctFrame);
            const lift = (Number.isFinite(dropTipY) && Number.isFinite(ctTipY)) ? (dropTipY - ctTipY) : NaN;
            const lagDeg = dropFrame ? lagAngleDegAt(dropFrame) : NaN;

            contactMetrics.verticalLift = Number.isFinite(lift) ? lift : null;
            contactMetrics.lagAngleDegAtDrop = Number.isFinite(lagDeg) ? Math.round(lagDeg) : null;

            const leftShoulder = ctFrame.landmarks?.[11];
            const contactPt = ctFrame.landmarks?.[wristIdx];
            const extensionX = (leftShoulder && contactPt && Number.isFinite(leftShoulder.x) && Number.isFinite(contactPt.x))
                ? Math.abs(contactPt.x - leftShoulder.x) : NaN;

            contactMetrics.extensionX = Number.isFinite(extensionX) ? extensionX : null;

            const signedAngleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
            const angleAt = (idx: number, a: number, b: number) => {
                const lm = activeSequence[idx]?.landmarks;
                if (!lm || !lm[a] || !lm[b]) return NaN;
                const dx = (lm[b].x ?? NaN) - (lm[a].x ?? NaN);
                const dy = (lm[b].y ?? NaN) - (lm[a].y ?? NaN);
                if (!Number.isFinite(dx) || !Number.isFinite(dy)) return NaN;
                return Math.atan2(dy, dx);
            };

            const scanStart = Math.max(2, unitTurnIdx);
            const scanEnd = Math.min(len - 3, contactIdx);

            let hipPeakIdx = -1, hipPeakVel = 0;
            let shoulderPeakIdx = -1, shoulderPeakVel = 0;
            let lagPeakIdx = -1, lagPeakDeg = -Infinity;

            for (let i = scanStart + 1; i < scanEnd; i++) {
                const h0 = angleAt(i - 1, 23, 24);
                const h1 = angleAt(i, 23, 24);
                const s0 = angleAt(i - 1, 11, 12);
                const s1 = angleAt(i, 11, 12);
                const t0 = activeSequence[i - 1]?.timestamp ?? 0;
                const t1 = activeSequence[i]?.timestamp ?? 0;
                const dt = Math.max(1e-3, t1 - t0);

                if (Number.isFinite(h0) && Number.isFinite(h1)) {
                    const v = Math.abs(signedAngleDelta(h0, h1) / dt);
                    if (v > hipPeakVel) { hipPeakVel = v; hipPeakIdx = i; }
                }
                if (Number.isFinite(s0) && Number.isFinite(s1)) {
                    const v = Math.abs(signedAngleDelta(s0, s1) / dt);
                    if (v > shoulderPeakVel) { shoulderPeakVel = v; shoulderPeakIdx = i; }
                }
            }

            for (let i = scanStart; i <= scanEnd; i++) {
                const d = lagAngleDegAt(activeSequence[i]);
                if (!Number.isFinite(d)) continue;
                if (d > lagPeakDeg) { lagPeakDeg = d; lagPeakIdx = i; }
            }

            const hipT = hipPeakIdx >= 0 ? activeSequence[hipPeakIdx]?.timestamp : NaN;
            const shoulderT = shoulderPeakIdx >= 0 ? activeSequence[shoulderPeakIdx]?.timestamp : NaN;
            const lagT = lagPeakIdx >= 0 ? activeSequence[lagPeakIdx]?.timestamp : NaN;
            const contactT = activeSequence[contactIdx]?.timestamp;

            contactMetrics.hipRotationPeakTimeSec = Number.isFinite(hipT) ? hipT : null;
            contactMetrics.shoulderRotationPeakTimeSec = Number.isFinite(shoulderT) ? shoulderT : null;
            contactMetrics.maxLagTimeSec = Number.isFinite(lagT) ? lagT : null;
            contactMetrics.contactTimeSec = Number.isFinite(contactT) ? contactT : null;

            if (Number.isFinite(hipT) && Number.isFinite(shoulderT)) contactMetrics.hipToShoulderLagSec = Math.abs(shoulderT - hipT);
            if (Number.isFinite(shoulderT) && Number.isFinite(lagT)) contactMetrics.shoulderToLagLagSec = Math.abs(lagT - shoulderT);
            if (Number.isFinite(lagT) && Number.isFinite(contactT)) contactMetrics.lagToContactLagSec = Math.abs(contactT - lagT);

            const liftStr = Number.isFinite(lift) ? `lift ${lift.toFixed(3)}` : '';
            const extStr = Number.isFinite(extensionX) ? `ext ${extensionX.toFixed(3)}` : '';
            const lagStr = Number.isFinite(lagDeg) ? `lag ${lagDeg.toFixed(0)}°` : '';
            const seqParts: string[] = [];
            if (Number.isFinite(hipT) && Number.isFinite(shoulderT)) seqParts.push(`hip→sh ${Math.abs(shoulderT - hipT).toFixed(2)}s`);
            if (Number.isFinite(shoulderT) && Number.isFinite(lagT)) seqParts.push(`sh→lag ${Math.abs(lagT - shoulderT).toFixed(2)}s`);
            if (Number.isFinite(lagT) && Number.isFinite(contactT)) seqParts.push(`lag→ct ${Math.abs(contactT - lagT).toFixed(2)}s`);
            const extra = [liftStr, extStr, lagStr, seqParts.length ? seqParts.join(' ') : ''].filter(Boolean).join(', ');
            if (extra) metricSuffix = extra;
        } catch {
            // ignore metric errors
        }

        const armCheck = analyzeJoint(contactPointFrame, refContactFrame, shoulderIdx, elbowIdx, wristIdx);
        if (armCheck.diff !== null) {
            if (armCheck.diff < -20) {
                feedback = 'Extend your arm more at contact - reach out to the ball';
                color = 'red';
                targetLandmark = elbowIdx;
            } else if (armCheck.diff > 25) {
                feedback = 'Arm too locked - maintain slight elbow bend';
                color = 'orange';
                targetLandmark = 14;
            }
        } else if (armCheck.userAngle < 140) {
            feedback = 'Extend your arm more at contact';
            color = 'red';
            targetLandmark = 14;
        }

        const contactWristY = contactPointFrame.landmarks[wristIdx].y;
        const contactHipY = contactPointFrame.landmarks[hipIdx].y;
        if (contactWristY > contactHipY + 0.1) {
            feedback = 'Hit the ball higher - contact point too low';
            color = 'orange';
            targetLandmark = wristIdx;
        }

        // metricSuffix contains debug timing data — store in metrics only, never show to user
        issues.push({
            phase: 'Contact Point',
            issue: feedback,
            timestamp: contactPointFrame.timestamp,
            landmarks: contactPointFrame.landmarks,
            worldLandmarks: contactPointFrame.worldLandmarks,
            metrics: Object.keys(contactMetrics).length ? { ...contactMetrics, _debugSuffix: metricSuffix || undefined } : undefined,
            debug: contactDebug,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Contact Point', refContactFrame),
            refLandmarks: refContactFrame?.landmarks,
            refWorldLandmarks: refContactFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' }
        });
    }

    // ========== PHASE 4: FOLLOW THROUGH ==========
    const followThroughFrame = getUserFrame('Follow Through');
    const refFollowThroughFrame = getRefFrame('Follow Through');

    if (followThroughFrame) {
        let feedback = 'Good follow through finish';
        let color = 'green';
        let targetLandmark = wristIdx;

        const wristX = followThroughFrame.landmarks[wristIdx].x;
        const hittingShoulderX = followThroughFrame.landmarks[shoulderIdx].x;
        const oppositeShoulderX = followThroughFrame.landmarks[isRightHanded ? 11 : 12].x;
        const midpoint = (hittingShoulderX + oppositeShoulderX) / 2;
        const didCrossBody = isRightHanded ? (wristX < midpoint) : (wristX > midpoint);

        if (!didCrossBody) {
            feedback = `Follow through more - finish over your ${isRightHanded ? 'left' : 'right'} shoulder`;
            color = 'red';
        }

        const finishWristY = followThroughFrame.landmarks[wristIdx].y;
        const finishShoulderY = followThroughFrame.landmarks[shoulderIdx].y;
        if (finishWristY > finishShoulderY + 0.05) {
            feedback = 'Finish higher - swing up and through the ball';
            color = 'orange';
        }

        issues.push({
            phase: 'Follow Through',
            issue: feedback,
            timestamp: followThroughFrame.timestamp,
            landmarks: followThroughFrame.landmarks,
            worldLandmarks: followThroughFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Follow Through', refFollowThroughFrame),
            refLandmarks: refFollowThroughFrame?.landmarks,
            refWorldLandmarks: refFollowThroughFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' }
        });
    }

    // DTW alignment is optional (debug). Default OFF so slow-mo PRO clips don't get time-warped.
    if (activeRefSequence.length > 10 && shouldUseDtwAlignment()) {
        applyDtwRefAlignmentToIssues(issues, activeSequence, activeRefSequence);
    }

    return issues;
}
