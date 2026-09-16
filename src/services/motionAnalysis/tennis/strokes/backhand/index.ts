import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import type { StrokeType, PhaseType } from '../../../../CalibrationService';
import { trimStaticFrames } from '../../poseUtils';
import { detectBackhandPhases } from './userPhases';
import { buildRefFrameHelpers } from './refFrames';
import { generateBackhandIssues } from './issues';
import { findBackhandPhases } from './advancedDetect';

export { detectBackhandPhases } from './userPhases';
export { findBackhandPhases } from './advancedDetect';

export function detectBackhandIssues(
    sequence: PoseResult[],
    refSequence?: PoseResult[],
    _refVideoUrl?: string,
    phaseTimestamps?: Record<string, number>,
): AlignmentIssue[] {
    const activeSequence = trimStaticFrames(sequence);
    const activeRefSequence = refSequence ? trimStaticFrames(refSequence) : [];

    console.log(`Backhand detection: ${activeSequence.length} active frames`);
    if (activeSequence.length < 10) return [];

    // 1. Detect user phases
    const userPhases = detectBackhandPhases(activeSequence);
    let { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx } = userPhases;
    const { detectedIsRightHanded } = userPhases;

    console.log(`[Backhand] User phases detected:`);
    console.log(`  Unit Turn: ${unitTurnIdx}, Racket Drop: ${racketDropIdx}, Contact: ${contactIdx}, Follow Through: ${followThroughIdx}`);
    console.log(`  Detected Right-Handed: ${detectedIsRightHanded}`);

    const len = activeSequence.length;

    // Phase ordering validation
    if (unitTurnIdx >= racketDropIdx) {
        unitTurnIdx = Math.max(0, racketDropIdx - 1);
        console.warn(`[Backhand] Fixed unit turn: ${unitTurnIdx}`);
    }
    if (racketDropIdx >= contactIdx) {
        racketDropIdx = Math.max(unitTurnIdx + 1, contactIdx - 5);
        console.warn(`[Backhand] Fixed racket drop: ${racketDropIdx}`);
    }
    if (followThroughIdx <= contactIdx) {
        followThroughIdx = Math.min(len - 1, contactIdx + 5);
        console.warn(`[Backhand] Fixed follow through: ${followThroughIdx}`);
    }

    console.log(`[Backhand] ✓ FINAL SEQUENCE: UT@${unitTurnIdx} < RD@${racketDropIdx} < CT@${contactIdx} < FT@${followThroughIdx}`);

    // 2. Build finalUserPhases map
    const finalUserPhases = new Map<PhaseType, { frame: PoseResult; timestamp: number; frameIndex: number; confidence: number }>();
    finalUserPhases.set('unit_turn', { frame: activeSequence[unitTurnIdx], timestamp: activeSequence[unitTurnIdx].timestamp, frameIndex: unitTurnIdx, confidence: 0.80 });
    finalUserPhases.set('racket_drop', { frame: activeSequence[racketDropIdx], timestamp: activeSequence[racketDropIdx].timestamp, frameIndex: racketDropIdx, confidence: 0.80 });
    finalUserPhases.set('contact', { frame: activeSequence[contactIdx], timestamp: activeSequence[contactIdx].timestamp, frameIndex: contactIdx, confidence: 0.90 });
    finalUserPhases.set('follow_through', { frame: activeSequence[followThroughIdx], timestamp: activeSequence[followThroughIdx].timestamp, frameIndex: followThroughIdx, confidence: 0.80 });

    // 3. Detect ref phases (kinematic, only when no admin calibration)
    const hasRefCalibration = phaseTimestamps != null && (
        phaseTimestamps.unitTurn != null || phaseTimestamps.contact != null
    );
    let refPhases = null;
    if (!hasRefCalibration && activeRefSequence.length > 10) {
        refPhases = detectBackhandPhases(activeRefSequence);
        console.log('[Backhand] Ref Phases (kinematic auto-detected):', {
            unitTurn: refPhases.unitTurnIdx,
            racketDrop: refPhases.racketDropIdx,
            contact: refPhases.contactIdx,
            followThrough: refPhases.followThroughIdx,
        });
    } else if (hasRefCalibration) {
        console.log('[Backhand] Ref Phases: using admin calibration timestamps');
    }

    // 4. Build ref frame helpers
    const { getRefFrame, getRefTimestamp } = buildRefFrameHelpers(activeRefSequence, phaseTimestamps, refPhases);

    // 5. Hitting arm indices
    const hitting = detectedIsRightHanded ? { wrist: 15, elbow: 13, shoulder: 11 } : { wrist: 16, elbow: 14, shoulder: 12 };

    // 6. Generate issues
    const issues = generateBackhandIssues({
        activeSequence,
        activeRefSequence,
        finalUserPhases,
        getRefFrame,
        getRefTimestamp,
        detectedIsRightHanded,
        hitWristIdx: hitting.wrist,
        hitElbowIdx: hitting.elbow,
        hitShoulderIdx: hitting.shoulder,
    });

    // Attach phase detection debug info to every issue so the UI can display it
    const totalFramesBH = activeSequence.length;
    const videoDurationBH = totalFramesBH > 1
        ? activeSequence[totalFramesBH - 1].timestamp - activeSequence[0].timestamp
        : 0;
    const phaseDetectionDebugBH = {
        unitTurn: { frameIdx: unitTurnIdx, ts: activeSequence[unitTurnIdx].timestamp, pct: totalFramesBH > 1 ? Math.round(unitTurnIdx / (totalFramesBH - 1) * 100) : 0 },
        racketDrop: { frameIdx: racketDropIdx, ts: activeSequence[racketDropIdx].timestamp, pct: totalFramesBH > 1 ? Math.round(racketDropIdx / (totalFramesBH - 1) * 100) : 0 },
        contact: { frameIdx: contactIdx, ts: activeSequence[contactIdx].timestamp, pct: totalFramesBH > 1 ? Math.round(contactIdx / (totalFramesBH - 1) * 100) : 0 },
        followThrough: { frameIdx: followThroughIdx, ts: activeSequence[followThroughIdx].timestamp, pct: totalFramesBH > 1 ? Math.round(followThroughIdx / (totalFramesBH - 1) * 100) : 0 },
        totalFrames: totalFramesBH,
        videoDuration: parseFloat(videoDurationBH.toFixed(2)),
        handedness: detectedIsRightHanded ? 'right' : 'left',
        strokeType: 'backhand',
    };

    return issues.map(i => ({
        ...i,
        strokeType: 'backhand' as StrokeType,
        debug: { ...((i.debug as Record<string, unknown>) ?? {}), phaseDetection: phaseDetectionDebugBH },
    }));
}
