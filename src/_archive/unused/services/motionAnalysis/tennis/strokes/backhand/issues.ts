import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import type { PhaseType } from '../../../../CalibrationService';
import { calculateAngle3D } from '../../poseUtils';
import { applyDtwRefAlignmentToIssues } from '../../dtw';
import { shouldUseDtwAlignment } from '../../phaseConfig';

export interface BackhandIssuesParams {
    activeSequence: PoseResult[];
    activeRefSequence: PoseResult[];
    finalUserPhases: Map<PhaseType, { frame: PoseResult; timestamp: number; frameIndex: number; confidence: number }>;
    getRefFrame: (phaseName: string) => PoseResult | null;
    getRefTimestamp: (phaseName: string, frame: PoseResult | null) => number | undefined;
    detectedIsRightHanded: boolean;
    hitWristIdx: number;
    hitElbowIdx: number;
    hitShoulderIdx: number;
}

export function generateBackhandIssues(params: BackhandIssuesParams): AlignmentIssue[] {
    const {
        activeSequence, activeRefSequence,
        finalUserPhases, getRefFrame, getRefTimestamp,
        detectedIsRightHanded, hitWristIdx, hitElbowIdx, hitShoulderIdx,
    } = params;

    const issues: AlignmentIssue[] = [];

    const getUserFrame = (phaseName: string): PoseResult | null => {
        let internalPhase: PhaseType | null = null;
        if (phaseName === 'Unit Turn') internalPhase = 'unit_turn';
        if (phaseName === 'Racket Drop') internalPhase = 'racket_drop';
        if (phaseName === 'Contact Point') internalPhase = 'contact';
        if (phaseName === 'Follow Through') internalPhase = 'follow_through';

        if (internalPhase && finalUserPhases.has(internalPhase)) {
            const phaseData = finalUserPhases.get(internalPhase)!;
            console.log(`[Backhand] Using phase for ${phaseName} at t=${phaseData.timestamp.toFixed(2)}s frame=${phaseData.frameIndex}`);
            return phaseData.frame;
        }
        return null;
    };

    const analyzeJoint = (
        userFrame: PoseResult,
        refFrame: PoseResult | null,
        lmIdxA: number,
        lmIdxB: number,
        lmIdxC: number,
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

    // ========== PHASE 1: UNIT TURN ==========
    const unitTurnFrame = getUserFrame('Unit Turn');
    const refUnitTurnFrame = getRefFrame('Unit Turn');

    if (unitTurnFrame) {
        let feedback = 'Good shoulder turn and preparation';
        let color = 'green';
        const targetLandmark = 11; // Left shoulder for backhand

        const userShoulderWidth = Math.abs(unitTurnFrame.landmarks[11].x - unitTurnFrame.landmarks[12].x);
        const refShoulderWidth = refUnitTurnFrame ? Math.abs(refUnitTurnFrame.landmarks[11].x - refUnitTurnFrame.landmarks[12].x) : null;

        if (refShoulderWidth !== null && userShoulderWidth > refShoulderWidth * 1.15) {
            feedback = 'Rotate shoulders more - turn your back to the net';
            color = 'red';
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
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    // ========== PHASE 2: RACKET DROP ==========
    const racketDropFrame = getUserFrame('Racket Drop');
    const refRacketDropFrame = getRefFrame('Racket Drop');

    if (racketDropFrame) {
        let feedback = 'Good racket preparation';
        let color = 'green';
        let targetLandmark = hitWristIdx;

        const kneeCheck = analyzeJoint(racketDropFrame, refRacketDropFrame, 24, 26, 28);
        if (kneeCheck.diff !== null && kneeCheck.diff > 15) {
            feedback = 'Bend your knees more - stay low for power';
            color = 'red';
            targetLandmark = 26;
        } else if (kneeCheck.userAngle > 165) {
            feedback = 'Legs too straight - bend knees for stability';
            color = 'orange';
            targetLandmark = 26;
        }

        const wristY = racketDropFrame.landmarks[hitWristIdx].y;
        const elbowY = racketDropFrame.landmarks[hitElbowIdx].y;
        if (wristY < elbowY) {
            feedback = 'Drop racket head lower - let it fall below your hand';
            color = 'red';
            targetLandmark = hitWristIdx;
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
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    // ========== PHASE 3: CONTACT POINT ==========
    const contactFrame = getUserFrame('Contact Point');
    const refContactFrame = getRefFrame('Contact Point');

    if (contactFrame) {
        let feedback = 'Good contact point';
        let color = 'green';
        let targetLandmark = hitWristIdx;

        const armCheck = analyzeJoint(contactFrame, refContactFrame, hitShoulderIdx, hitElbowIdx, hitWristIdx);
        if (armCheck.diff !== null) {
            if (armCheck.diff < -20) {
                feedback = 'Extend your arm more - reach out to the ball';
                color = 'red';
                targetLandmark = hitElbowIdx;
            }
        } else if (armCheck.userAngle < 130) {
            feedback = 'Arm too bent at contact - extend more';
            color = 'red';
            targetLandmark = hitElbowIdx;
        }

        if (refContactFrame) {
            const wristX = contactFrame.landmarks[hitWristIdx].x;
            const hipX = contactFrame.landmarks[24].x;
            const refWristX = refContactFrame.landmarks[hitWristIdx].x;
            const refHipX = refContactFrame.landmarks[24].x;
            const userContactPosition = wristX - hipX;
            const refContactPosition = refWristX - refHipX;
            if (Math.abs(userContactPosition) < Math.abs(refContactPosition) * 0.7) {
                feedback = 'Make contact further in front of your body';
                color = 'orange';
            }
        }

        issues.push({
            phase: 'Contact Point',
            issue: feedback,
            timestamp: contactFrame.timestamp,
            landmarks: contactFrame.landmarks,
            worldLandmarks: contactFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Contact Point', refContactFrame),
            refLandmarks: refContactFrame?.landmarks,
            refWorldLandmarks: refContactFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    // ========== PHASE 4: FOLLOW THROUGH ==========
    const followThroughFrame = getUserFrame('Follow Through');
    const refFollowThroughFrame = getRefFrame('Follow Through');

    if (followThroughFrame) {
        let feedback = 'Good follow through';
        let color = 'green';
        let targetLandmark = hitWristIdx;

        const wristY = followThroughFrame.landmarks[hitWristIdx].y;
        const shoulderY = followThroughFrame.landmarks[hitShoulderIdx].y;

        if (wristY > shoulderY + 0.1) {
            feedback = 'Finish higher - extend up through the ball';
            color = 'red';
        }

        // Follows the original: hardcoded right-arm indices (12, 14, 16)
        const armCheck = analyzeJoint(followThroughFrame, refFollowThroughFrame, 12, 14, 16);
        if (armCheck.userAngle < 140) {
            feedback = 'Extend arm more on follow through';
            color = 'orange';
            targetLandmark = 14;
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
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    if (activeRefSequence.length > 10 && shouldUseDtwAlignment()) {
        applyDtwRefAlignmentToIssues(issues, activeSequence, activeRefSequence);
    }

    return issues;
}
