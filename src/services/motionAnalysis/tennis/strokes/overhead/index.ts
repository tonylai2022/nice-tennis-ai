import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import {
    trimStaticFrames, calculateAngle3D,
} from '../../poseUtils';

export function detectOverheadIssues(sequence: PoseResult[], refSequence?: PoseResult[], refVideoUrl?: string): AlignmentIssue[] {
    const issues: AlignmentIssue[] = [];
    const activeSequence = trimStaticFrames(sequence);
    if (activeSequence.length < 8) return issues;

    console.log('[Tennis Overhead Analysis] Starting comprehensive biomechanical analysis');

    const detectedIsRightHanded = true;
    const hitting = detectedIsRightHanded
        ? { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
        : { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
    const nonHitting = detectedIsRightHanded
        ? { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }
        : { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };

    const len = activeSequence.length;
    const prepIdx = Math.floor(len * 0.25);
    const contactIdx = Math.floor(len * 0.65);
    const followIdx = Math.floor(len * 0.85);

    const analyzePositioning = (frame: PoseResult): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze positioning';
        const leftShoulder = lm[11]; const rightShoulder = lm[12]; const nose = lm[0];
        if (!leftShoulder || !rightShoulder || !nose) return 'Key landmarks missing';
        const shoulderCenter = {
            x: ((leftShoulder.x || 0) + (rightShoulder.x || 0)) / 2,
            y: ((leftShoulder.y || 0) + (rightShoulder.y || 0)) / 2,
        };
        const headLiftAngle = Math.atan2(
            (shoulderCenter.y || 0) - (nose.y || 0),
            Math.abs((nose.x || 0) - (shoulderCenter.x || 0)) + 0.01,
        ) * 180 / Math.PI;
        if (headLiftAngle < 15) return `Head position too low: ${Math.round(headLiftAngle)}° tilt. Look up to track the ball better.`;
        if (headLiftAngle > 45) return `Excellent head position: ${Math.round(headLiftAngle)}° tilt. Good ball tracking posture.`;
        return `Good head position: ${Math.round(headLiftAngle)}° tilt for overhead tracking.`;
    };

    const analyzeArmExtension = (frame: PoseResult, phase: string): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze arm extension';
        const shoulder = lm[hitting.shoulder]; const elbow = lm[hitting.elbow]; const wrist = lm[hitting.wrist];
        if (!shoulder || !elbow || !wrist) return 'Arm landmark data missing';
        const elbowAngle = calculateAngle3D(shoulder, elbow, wrist);
        if (phase === 'preparation') {
            return elbowAngle > 120
                ? `Good preparation: Arm extended (${Math.round(elbowAngle)}°) ready for overhead swing.`
                : `Arm too bent in preparation: ${Math.round(elbowAngle)}°. Extend more for overhead setup.`;
        } else if (phase === 'contact') {
            if (elbowAngle < 140) return `Contact not fully extended: ${Math.round(elbowAngle)}° elbow angle. Reach higher for maximum power.`;
            if (elbowAngle > 170) return `Excellent full extension: ${Math.round(elbowAngle)}° at contact. Perfect overhead technique.`;
            return `Good extension at contact: ${Math.round(elbowAngle)}° elbow angle for overhead.`;
        }
        return `Arm analysis: ${Math.round(elbowAngle)}° elbow extension`;
    };

    const analyzeContactHeight = (frame: PoseResult): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze contact height';
        const nose = lm[0]; const wrist = lm[hitting.wrist]; const shoulder = lm[hitting.shoulder];
        if (!nose || !wrist || !shoulder) return 'Height reference landmarks missing';
        const contactAboveHead = (nose.y || 0) - (wrist.y || 0);
        const contactAboveShoulder = (shoulder.y || 0) - (wrist.y || 0);
        if (contactAboveHead < 0.15) return `Contact too low: Only ${Math.round(Math.abs(contactAboveHead) * 100)}cm above head. Reach higher for power.`;
        if (contactAboveHead > 0.35) return `Excellent contact height: ${Math.round(contactAboveHead * 100)}cm above head. Maximum power position.`;
        return `Good contact height: ${Math.round(contactAboveHead * 100)}cm above head, ${Math.round(Math.abs(contactAboveShoulder) * 100)}cm above shoulder.`;
    };

    const analyzeShoulderCoil = (frame: PoseResult): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze shoulder rotation';
        const leftShoulder = lm[11]; const rightShoulder = lm[12];
        const leftHip = lm[23]; const rightHip = lm[24];
        if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return 'Shoulder/hip landmarks missing';
        const shoulderAngle = Math.atan2((rightShoulder.y || 0) - (leftShoulder.y || 0), (rightShoulder.x || 0) - (leftShoulder.x || 0)) * 180 / Math.PI;
        const hipAngle = Math.atan2((rightHip.y || 0) - (leftHip.y || 0), (rightHip.x || 0) - (leftHip.x || 0)) * 180 / Math.PI;
        const separation = Math.abs(shoulderAngle - hipAngle);
        if (separation < 15) return `Limited shoulder coil: ${Math.round(separation)}° separation. Turn shoulders more for power.`;
        if (separation > 40) return `Excellent shoulder coil: ${Math.round(separation)}° separation. Good power generation setup.`;
        return `Good shoulder rotation: ${Math.round(separation)}° separation for overhead power.`;
    };

    const analyzeLegDrive = (frame: PoseResult): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze leg drive';
        const leftKnee = lm[25]; const rightKnee = lm[26];
        const leftHip = lm[23]; const rightHip = lm[24];
        const leftAnkle = lm[27]; const rightAnkle = lm[28];
        if (!leftKnee || !rightKnee || !leftHip || !rightHip) return 'Leg landmark data incomplete';
        const leftKneeAngle = leftHip && leftAnkle ? calculateAngle3D(leftHip, leftKnee, leftAnkle) : NaN;
        const rightKneeAngle = rightHip && rightAnkle ? calculateAngle3D(rightHip, rightKnee, rightAnkle) : NaN;
        const avgKneeAngle = isFinite(leftKneeAngle) && isFinite(rightKneeAngle)
            ? (leftKneeAngle + rightKneeAngle) / 2
            : (isFinite(leftKneeAngle) ? leftKneeAngle : rightKneeAngle);
        if (!isFinite(avgKneeAngle)) return 'Unable to calculate knee angles';
        if (avgKneeAngle < 140) return `Good knee bend: ${Math.round(avgKneeAngle)}° average. Excellent leg drive preparation.`;
        if (avgKneeAngle > 160) return `Limited leg bend: ${Math.round(avgKneeAngle)}° average. Bend more for upward power.`;
        return `Moderate leg setup: ${Math.round(avgKneeAngle)}° average knee angle.`;
    };

    // PREPARATION PHASE
    if (activeSequence[prepIdx]?.landmarks) {
        const prepFrame = activeSequence[prepIdx];
        issues.push({
            phase: 'Preparation',
            issue: `Overhead Preparation Analysis:\n• ${analyzePositioning(prepFrame)}\n• ${analyzeArmExtension(prepFrame, 'preparation')}\n• ${analyzeShoulderCoil(prepFrame)}`,
            timestamp: prepFrame.timestamp,
            landmarks: prepFrame.landmarks,
            worldLandmarks: prepFrame.worldLandmarks,
            visualCue: { targetIndex: nonHitting.wrist, cueType: 'circle', color: 'orange' },
        });
    }

    // CONTACT PHASE
    if (activeSequence[contactIdx]?.landmarks) {
        const contactFrame = activeSequence[contactIdx];
        issues.push({
            phase: 'Contact',
            issue: `Overhead Contact Analysis:\n• ${analyzeArmExtension(contactFrame, 'contact')}\n• ${analyzeContactHeight(contactFrame)}\n• ${analyzeLegDrive(contactFrame)}`,
            timestamp: contactFrame.timestamp,
            landmarks: contactFrame.landmarks,
            worldLandmarks: contactFrame.worldLandmarks,
            visualCue: { targetIndex: hitting.wrist, cueType: 'circle', color: 'purple' },
        });
    }

    // FOLLOW THROUGH PHASE
    if (activeSequence[followIdx]?.landmarks) {
        const followFrame = activeSequence[followIdx];
        const lm = followFrame?.worldLandmarks || followFrame?.landmarks;
        let followThroughAnalysis = 'Unable to analyze follow-through';
        if (lm) {
            const shoulder = lm[hitting.shoulder]; const wrist = lm[hitting.wrist]; const hip = lm[hitting.hip];
            if (shoulder && wrist && hip) {
                const wristAcrossBody = detectedIsRightHanded
                    ? (wrist.x || 0) < (shoulder.x || 0)
                    : (wrist.x || 0) > (shoulder.x || 0);
                const followHeight = (shoulder.y || 0) - (wrist.y || 0);
                if (wristAcrossBody && followHeight < 0.1) followThroughAnalysis = `Excellent follow-through: Racket crosses body and finishes low. Perfect overhead technique.`;
                else if (!wristAcrossBody) followThroughAnalysis = `Follow-through needs work: Racket should cross body for power and control.`;
                else followThroughAnalysis = `Good follow-through direction: Finishes ${Math.round(Math.abs(followHeight) * 100)}cm relative to shoulder.`;
            }
        }
        issues.push({
            phase: 'Follow Through',
            issue: `Overhead Follow-Through Analysis:\n• ${followThroughAnalysis}\n• ${analyzeLegDrive(followFrame)}`,
            timestamp: followFrame.timestamp,
            landmarks: followFrame.landmarks,
            worldLandmarks: followFrame.worldLandmarks,
            visualCue: { targetIndex: hitting.wrist, cueType: 'circle', color: 'green' },
        });
    }

    console.log(`[Tennis Overhead Analysis] Generated ${issues.length} biomechanical analysis points`);
    return issues;
}
