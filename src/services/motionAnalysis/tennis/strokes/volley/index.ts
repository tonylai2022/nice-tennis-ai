import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import {
    trimStaticFrames, calculateAngle3D,
} from '../../poseUtils';

export function detectVolleyIssues(sequence: PoseResult[], refSequence?: PoseResult[], refVideoUrl?: string): AlignmentIssue[] {
    const issues: AlignmentIssue[] = [];
    const activeSequence = trimStaticFrames(sequence);
    if (activeSequence.length < 5) return issues;

    console.log('[Tennis Volley Analysis] Starting comprehensive biomechanical analysis');

    const detectedIsRightHanded = true;
    const hitting = detectedIsRightHanded
        ? { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
        : { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };

    const len = activeSequence.length;
    const prepIdx = Math.floor(len * 0.3);
    const contactIdx = Math.floor(len * 0.6);
    const followIdx = Math.floor(len * 0.8);

    const analyzeRacketPosition = (frame: PoseResult, phase: string): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to detect racket position';
        const shoulder = lm[hitting.shoulder];
        const elbow = lm[hitting.elbow];
        const wrist = lm[hitting.wrist];
        if (!shoulder || !elbow || !wrist) return 'Key joint landmarks missing';
        const elbowAngle = calculateAngle3D(shoulder, elbow, wrist);
        const wristAboveShoulder = (shoulder.y || 0) - (wrist.y || 0);
        if (phase === 'preparation') {
            if (elbowAngle < 90) return `Ready position needs improvement: Racket too low (elbow angle ${Math.round(elbowAngle)}°). Keep racket up at shoulder height.`;
            if (wristAboveShoulder < 0) return `Racket position too low: Wrist should be at or above shoulder level in ready position.`;
            return `Good ready position: Racket up (elbow ${Math.round(elbowAngle)}°), ready for quick reaction.`;
        } else if (phase === 'contact') {
            if (elbowAngle > 150) return `Contact too extended: Elbow angle ${Math.round(elbowAngle)}° indicates overly straight arm. Keep slight bend for control.`;
            if (elbowAngle < 120) return `Contact too compressed: Elbow angle ${Math.round(elbowAngle)}° too bent. Extend more for solid contact.`;
            return `Good contact position: Elbow angle ${Math.round(elbowAngle)}° shows proper extension and control.`;
        }
        return `Racket position analysis: Elbow angle ${Math.round(elbowAngle)}°`;
    };

    const analyzeFootwork = (frame: PoseResult): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze footwork';
        const leftHip = lm[23]; const rightHip = lm[24];
        const leftAnkle = lm[27]; const rightAnkle = lm[28];
        if (!leftHip || !rightHip || !leftAnkle || !rightAnkle) return 'Foot position landmarks missing';
        const stanceWidth = Math.abs((rightAnkle.x || 0) - (leftAnkle.x || 0));
        const hipCenter = ((leftHip.x || 0) + (rightHip.x || 0)) / 2;
        const ankleCenter = ((leftAnkle.x || 0) + (rightAnkle.x || 0)) / 2;
        const lateralBalance = Math.abs(hipCenter - ankleCenter);
        if (stanceWidth < 0.15) return `Stance too narrow: Width ${Math.round(stanceWidth * 100)}cm. Widen stance for better balance.`;
        if (stanceWidth > 0.35) return `Stance too wide: Width ${Math.round(stanceWidth * 100)}cm. Narrow stance for quicker movement.`;
        if (lateralBalance > 0.08) return `Weight distribution off: ${Math.round(lateralBalance * 100)}cm off-center. Center your weight.`;
        return `Good volley stance: Balanced width (${Math.round(stanceWidth * 100)}cm) with centered weight.`;
    };

    const analyzeShoulderRotation = (frame: PoseResult): string => {
        const lm = frame?.worldLandmarks || frame?.landmarks;
        if (!lm) return 'Unable to analyze shoulder rotation';
        const leftShoulder = lm[11]; const rightShoulder = lm[12];
        const leftHip = lm[23]; const rightHip = lm[24];
        if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return 'Shoulder/hip landmarks missing';
        const shoulderAngle = Math.atan2((rightShoulder.y || 0) - (leftShoulder.y || 0), (rightShoulder.x || 0) - (leftShoulder.x || 0)) * 180 / Math.PI;
        const hipAngle = Math.atan2((rightHip.y || 0) - (leftHip.y || 0), (rightHip.x || 0) - (leftHip.x || 0)) * 180 / Math.PI;
        const separation = Math.abs(shoulderAngle - hipAngle);
        if (separation > 25) return `Too much shoulder turn: ${Math.round(separation)}° separation. Volleys need compact, minimal rotation.`;
        if (separation < 5) return `Very compact motion: ${Math.round(separation)}° separation. Good for volley control.`;
        return `Appropriate shoulder rotation: ${Math.round(separation)}° separation for volley technique.`;
    };

    // PREPARATION PHASE
    if (activeSequence[prepIdx]?.landmarks) {
        const prepFrame = activeSequence[prepIdx];
        issues.push({
            phase: 'Preparation',
            issue: `Volley Preparation Analysis:\n• ${analyzeRacketPosition(prepFrame, 'preparation')}\n• ${analyzeFootwork(prepFrame)}`,
            timestamp: prepFrame.timestamp,
            landmarks: prepFrame.landmarks,
            worldLandmarks: prepFrame.worldLandmarks,
            visualCue: { targetIndex: hitting.wrist, cueType: 'circle', color: 'orange' },
        });
    }

    // CONTACT PHASE
    if (activeSequence[contactIdx]?.landmarks) {
        const contactFrame = activeSequence[contactIdx];
        const lm = contactFrame?.worldLandmarks || contactFrame?.landmarks;
        let contactHeightAnalysis = 'Unable to analyze contact height';
        if (lm) {
            const wrist = lm[hitting.wrist];
            const shoulder = lm[hitting.shoulder];
            if (wrist && shoulder) {
                const contactHeight = (shoulder.y || 0) - (wrist.y || 0);
                if (contactHeight < -0.1) contactHeightAnalysis = `Contact too low: ${Math.round(Math.abs(contactHeight) * 100)}cm below shoulder. Hit higher for better control.`;
                else if (contactHeight > 0.2) contactHeightAnalysis = `Contact very high: ${Math.round(contactHeight * 100)}cm above shoulder. Good for attacking volleys.`;
                else contactHeightAnalysis = `Good contact height: ${Math.round(Math.abs(contactHeight) * 100)}cm relative to shoulder.`;
            }
        }
        issues.push({
            phase: 'Contact',
            issue: `Volley Contact Analysis:\n• ${analyzeRacketPosition(contactFrame, 'contact')}\n• ${analyzeShoulderRotation(contactFrame)}\n• ${contactHeightAnalysis}`,
            timestamp: contactFrame.timestamp,
            landmarks: contactFrame.landmarks,
            worldLandmarks: contactFrame.worldLandmarks,
            visualCue: { targetIndex: hitting.wrist, cueType: 'circle', color: 'blue' },
        });
    }

    // FOLLOW THROUGH PHASE
    if (activeSequence[followIdx]?.landmarks) {
        const followFrame = activeSequence[followIdx];
        const lm = followFrame?.worldLandmarks || followFrame?.landmarks;
        let followThroughAnalysis = 'Unable to analyze follow-through';
        if (lm) {
            const shoulder = lm[hitting.shoulder];
            const elbow = lm[hitting.elbow];
            const wrist = lm[hitting.wrist];
            if (shoulder && elbow && wrist) {
                const finalElbowAngle = calculateAngle3D(shoulder, elbow, wrist);
                if (finalElbowAngle < 90) followThroughAnalysis = `Over-rotation in follow-through: Elbow ${Math.round(finalElbowAngle)}°. Keep follow-through compact for volleys.`;
                else if (finalElbowAngle > 150) followThroughAnalysis = `Good controlled finish: Elbow ${Math.round(finalElbowAngle)}° shows proper volley technique.`;
                else followThroughAnalysis = `Adequate follow-through: Elbow ${Math.round(finalElbowAngle)}° with controlled motion.`;
            }
        }
        issues.push({
            phase: 'Follow Through',
            issue: `Volley Follow-Through Analysis:\n• ${followThroughAnalysis}\n• ${analyzeFootwork(followFrame)}`,
            timestamp: followFrame.timestamp,
            landmarks: followFrame.landmarks,
            worldLandmarks: followFrame.worldLandmarks,
            visualCue: { targetIndex: hitting.wrist, cueType: 'circle', color: 'green' },
        });
    }

    console.log(`[Tennis Volley Analysis] Generated ${issues.length} biomechanical analysis points`);
    return issues;
}
