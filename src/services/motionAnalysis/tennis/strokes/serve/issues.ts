import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import type { PhaseType } from '../../../../CalibrationService';
import { calculateAngle3D } from '../../poseUtils';
import { applyDtwRefAlignmentToIssues } from '../../dtw';
import { shouldUseDtwAlignment } from '../../phaseConfig';

export interface ServeIssuesParams {
    activeSequence: PoseResult[];
    activeRefSequence: PoseResult[];
    finalUserPhases: Map<PhaseType, { frame: PoseResult; timestamp: number; frameIndex: number; confidence: number }>;
    getRefFrame: (phaseName: string) => PoseResult | null;
    getRefTimestamp: (phaseName: string, frame: PoseResult | null) => number | undefined;
    hasRefCalibration: boolean;
}

export function generateServeIssues(params: ServeIssuesParams): AlignmentIssue[] {
    const {
        activeSequence, activeRefSequence,
        finalUserPhases, getRefFrame, getRefTimestamp,
        hasRefCalibration,
    } = params;

    const issues: AlignmentIssue[] = [];

    const getUserFrame = (phaseName: string): PoseResult | null => {
        let internalPhase: PhaseType | null = null;
        if (phaseName === 'Preparation') internalPhase = 'preparation';
        if (phaseName === 'Ball Toss') internalPhase = 'ball_toss';
        if (phaseName === 'Trophy Position') internalPhase = 'loading';
        if (phaseName === 'Contact Point') internalPhase = 'contact';
        if (phaseName === 'Follow Through') internalPhase = 'finish';

        if (internalPhase && finalUserPhases.has(internalPhase)) {
            const phaseData = finalUserPhases.get(internalPhase)!;
            console.log(`[Serve] Using phase for ${phaseName} at t=${phaseData.timestamp.toFixed(2)}s frame=${phaseData.frameIndex}`);
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

    // ========== PHASE 1: PREPARATION ==========
    const prepFrame = getUserFrame('Preparation');
    const refPrepFrame = getRefFrame('Preparation');

    if (prepFrame && prepFrame.landmarks) {
        let feedback = 'Good starting position';
        let color = 'green';
        let targetLandmark = 24;

        if (refPrepFrame) {
            const stanceWidth = Math.abs(prepFrame.landmarks[27].x - prepFrame.landmarks[28].x);
            const refStanceWidth = Math.abs(refPrepFrame.landmarks[27].x - refPrepFrame.landmarks[28].x);
            if (stanceWidth < refStanceWidth * 0.7) {
                feedback = 'Widen your stance for better balance';
                color = 'orange';
                targetLandmark = 28;
            }
        }

        issues.push({
            phase: 'Preparation',
            issue: feedback,
            timestamp: prepFrame.timestamp,
            landmarks: prepFrame.landmarks,
            worldLandmarks: prepFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Preparation', refPrepFrame),
            refLandmarks: refPrepFrame?.landmarks,
            refWorldLandmarks: refPrepFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    // ========== PHASE 2: BALL TOSS ==========
    const tossPeakFrame = getUserFrame('Ball Toss');
    const refTossPeakFrame = getRefFrame('Ball Toss');

    if (tossPeakFrame && tossPeakFrame.landmarks) {
        let feedback = 'Good ball toss';
        let color = 'green';
        let targetLandmark = 15;

        const tossArmCheck = analyzeJoint(tossPeakFrame, refTossPeakFrame, 11, 13, 15);
        if (tossArmCheck.userAngle < 150) {
            feedback = 'Straighten your toss arm - extend fully upward';
            color = 'red';
            targetLandmark = 13;
        } else if (tossArmCheck.diff !== null && tossArmCheck.diff < -15) {
            feedback = 'Extend toss arm higher like the pro';
            color = 'orange';
            targetLandmark = 13;
        }

        const tossWristY = tossPeakFrame.landmarks[15].y;
        const headY = tossPeakFrame.landmarks[0].y;
        if (tossWristY > headY) {
            feedback = 'Toss the ball higher - release above your head';
            color = 'red';
            targetLandmark = 15;
        }

        issues.push({
            phase: 'Ball Toss',
            issue: feedback,
            timestamp: tossPeakFrame.timestamp,
            landmarks: tossPeakFrame.landmarks,
            worldLandmarks: tossPeakFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Ball Toss', refTossPeakFrame),
            refLandmarks: refTossPeakFrame?.landmarks,
            refWorldLandmarks: refTossPeakFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    // ========== PHASE 3: TROPHY POSITION ==========
    const loadingFrame = getUserFrame('Trophy Position');
    const refLoadingFrame = getRefFrame('Trophy Position');

    if (loadingFrame && loadingFrame.landmarks) {
        let feedback = 'Good trophy position and loading';
        let color = 'green';
        let targetLandmark = 26;

        const kneeCheck = analyzeJoint(loadingFrame, refLoadingFrame, 24, 26, 28);
        if (kneeCheck.diff !== null && kneeCheck.diff > 15) {
            feedback = 'Bend your knees more - load up for explosive power';
            color = 'red';
        } else if (kneeCheck.userAngle > 160) {
            feedback = 'Legs too straight - bend knees to generate leg drive';
            color = 'orange';
        }

        const elbowCheck = analyzeJoint(loadingFrame, refLoadingFrame, 12, 14, 16);
        if (elbowCheck.userAngle > 130) {
            feedback = 'Bend your elbow more in trophy position';
            color = 'orange';
            targetLandmark = 14;
        } else if (elbowCheck.userAngle < 60) {
            feedback = 'Elbow too bent - raise racket higher behind you';
            color = 'orange';
            targetLandmark = 14;
        }

        issues.push({
            phase: 'Trophy Position',
            issue: feedback,
            timestamp: loadingFrame.timestamp,
            landmarks: loadingFrame.landmarks,
            worldLandmarks: loadingFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Trophy Position', refLoadingFrame),
            refLandmarks: refLoadingFrame?.landmarks,
            refWorldLandmarks: refLoadingFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    // ========== PHASE 4: CONTACT POINT ==========
    const contactFrame = getUserFrame('Contact Point');
    const refContactFrame = getRefFrame('Contact Point');

    if (contactFrame && contactFrame.landmarks) {
        let feedback = 'Good contact point';
        let color = 'green';
        let targetLandmark = 16;

        const armCheck = analyzeJoint(contactFrame, refContactFrame, 12, 14, 16);
        if (armCheck.userAngle < 150) {
            feedback = 'Reach up higher - fully extend your arm at contact';
            color = 'red';
            targetLandmark = 14;
        } else if (armCheck.diff !== null && armCheck.diff < -15) {
            feedback = 'Extend arm more like the pro';
            color = 'orange';
            targetLandmark = 14;
        }

        const contactWristY = contactFrame.landmarks[16].y;
        const contactNoseY = contactFrame.landmarks[0].y;
        if (contactWristY > contactNoseY * 0.8) {
            feedback = 'Hit at a higher point - reach up to the ball';
            color = 'red';
            targetLandmark = 16;
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

    // ========== PHASE 5: FOLLOW THROUGH ==========
    const finishFrame = getUserFrame('Follow Through');
    const refFinishFrame = getRefFrame('Follow Through');

    if (finishFrame && finishFrame.landmarks) {
        let feedback = 'Good follow through and finish';
        let color = 'green';
        const targetLandmark = 16;

        const finishWristY = finishFrame.landmarks[16].y;
        const finishHipY = finishFrame.landmarks[24].y;
        if (finishWristY < finishHipY - 0.1) {
            feedback = 'Complete your follow through - let the racket come down';
            color = 'orange';
        }

        issues.push({
            phase: 'Follow Through',
            issue: feedback,
            timestamp: finishFrame.timestamp,
            landmarks: finishFrame.landmarks,
            worldLandmarks: finishFrame.worldLandmarks,
            visualCue: { targetIndex: targetLandmark, cueType: 'circle', color },
            refTimestamp: getRefTimestamp('Follow Through', refFinishFrame),
            refLandmarks: refFinishFrame?.landmarks,
            refWorldLandmarks: refFinishFrame?.worldLandmarks,
            refVisualCue: { targetIndex: targetLandmark, cueType: 'circle', color: 'emerald' },
        });
    }

    if (!hasRefCalibration && activeRefSequence.length > 10 && shouldUseDtwAlignment()) {
        applyDtwRefAlignmentToIssues(issues, activeSequence, activeRefSequence);
    }

    return issues;
}
