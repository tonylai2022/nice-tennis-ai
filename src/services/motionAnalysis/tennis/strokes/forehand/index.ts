import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import type { StrokeType, PhaseType } from '../../../../CalibrationService';
import { trimStaticFrames, smoothArray, calculateLandmarkVelocity3D } from '../../poseUtils';
import { detectForehandPhases } from './userPhases';
import { buildRefFrameHelpers } from './refFrames';
import { findForehandPhases } from './advancedDetect';
import { generateForehandIssues } from './issues';

export { detectForehandPhases } from './userPhases';
export { findForehandPhases } from './advancedDetect';

export function detectForehandIssues(
    sequence: PoseResult[],
    refSequence?: PoseResult[],
    refVideoUrl?: string,
    phaseTimestamps?: Record<string, number>
): AlignmentIssue[] {
    const issues: AlignmentIssue[] = [];
    const activeSequence = trimStaticFrames(sequence);
    const activeRefSequence = refSequence ? trimStaticFrames(refSequence) : [];

    console.log(`Forehand detection: ${activeSequence.length} active frames (from ${sequence.length} total)`);
    if (activeSequence.length < 10) return issues;

    // 1. Detect user phases using the kinematic + kNN pipeline
    const userPhases = findForehandPhases(activeSequence, false);
    let unitTurnIdx = userPhases.indices.unitTurnIdx;
    let racketDropIdx = userPhases.indices.racketDropIdx;
    let contactIdx = userPhases.indices.contactIdx;
    let followThroughIdx = userPhases.indices.followThroughIdx;

    // Detect handedness from wrist velocities
    const _rVel = smoothArray(calculateLandmarkVelocity3D(activeSequence, 16), 5);
    const _lVel = smoothArray(calculateLandmarkVelocity3D(activeSequence, 15), 5);
    const _avgVel = (arr: number[]) => { const v = arr.filter(x => isFinite(x) && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    const detectedIsRightHanded = _avgVel(_rVel) >= _avgVel(_lVel);

    console.log(`[Forehand] User phases: UT=${unitTurnIdx}, RD=${racketDropIdx}, CT=${contactIdx}, FT=${followThroughIdx}`);
    console.log(`[Forehand] Detected Right-Handed: ${detectedIsRightHanded}`);

    const len = activeSequence.length;

    // Enforce proper phase ordering.
    // Prefer bumping unit turn back by 1 rather than collapsing all the way to 0,
    // which produces a misleading 0% position in the debug UI.
    if (unitTurnIdx >= racketDropIdx) {
        unitTurnIdx = Math.max(0, racketDropIdx - 1);
        console.warn(`[Forehand] Fixed unit turn: ${unitTurnIdx}`);
    }
    if (racketDropIdx >= contactIdx) {
        racketDropIdx = Math.max(unitTurnIdx + 1, contactIdx - 5);
        console.warn(`[Forehand] Fixed racket drop: ${racketDropIdx}`);
    }
    if (followThroughIdx <= contactIdx) {
        followThroughIdx = Math.min(len - 1, contactIdx + 5);
        console.warn(`[Forehand] Fixed follow through: ${followThroughIdx}`);
    }

    console.log(`[Forehand] ✓ FINAL: UT@${unitTurnIdx} < RD@${racketDropIdx} < CT@${contactIdx} < FT@${followThroughIdx}`);

    // 2. Build user phase map
    const finalUserPhases = new Map<string, { frame: PoseResult; timestamp: number; frameIndex: number; confidence: number }>();
    finalUserPhases.set('unit_turn', { frame: activeSequence[unitTurnIdx], timestamp: activeSequence[unitTurnIdx].timestamp, frameIndex: unitTurnIdx, confidence: 0.80 });
    finalUserPhases.set('racket_drop', { frame: activeSequence[racketDropIdx], timestamp: activeSequence[racketDropIdx].timestamp, frameIndex: racketDropIdx, confidence: 0.80 });
    finalUserPhases.set('contact', { frame: activeSequence[contactIdx], timestamp: activeSequence[contactIdx].timestamp, frameIndex: contactIdx, confidence: 0.90 });
    finalUserPhases.set('follow_through', { frame: activeSequence[followThroughIdx], timestamp: activeSequence[followThroughIdx].timestamp, frameIndex: followThroughIdx, confidence: 0.80 });

    // 3. Detect reference video phases (kinematic auto-detect or skip if admin-calibrated)
    const hasRefCalibration = phaseTimestamps != null && (
        phaseTimestamps.unitTurn != null || phaseTimestamps.contact != null
    );

    let refPhases: { frames: { unitTurn: PoseResult; racketDrop: PoseResult; contact: PoseResult; followThrough: PoseResult } } | null = null;
    if (!hasRefCalibration && activeRefSequence.length > 10) {
        const detected = findForehandPhases(activeRefSequence, false);
        refPhases = { frames: { unitTurn: detected.frames.unitTurn, racketDrop: detected.frames.racketDrop, contact: detected.frames.contact, followThrough: detected.frames.followThrough } };
        console.log('[Forehand] Ref phases (kinematic auto-detected):', detected.indices);
    } else if (hasRefCalibration) {
        console.log('[Forehand] Ref phases: using admin calibration (skipping auto-detector)');
    }

    // 4. Build ref frame helpers
    const { getRefFrame, getRefTimestamp } = buildRefFrameHelpers(activeRefSequence, phaseTimestamps, refPhases);

    console.log(`[Forehand] Using detected hitting arm: ${detectedIsRightHanded ? 'right' : 'left'}`);

    // 5. Generate coaching issues
    const generatedIssues = generateForehandIssues({
        activeSequence,
        activeRefSequence,
        unitTurnIdx,
        racketDropIdx,
        contactIdx,
        followThroughIdx,
        isRightHanded: detectedIsRightHanded,
        finalUserPhases,
        getRefFrame,
        getRefTimestamp,
    });

    // Attach phase detection debug info to every issue so the UI can display it
    const totalFrames = activeSequence.length;
    const videoDuration = totalFrames > 1
        ? activeSequence[totalFrames - 1].timestamp - activeSequence[0].timestamp
        : 0;
    const phaseDetectionDebug = {
        unitTurn: { frameIdx: unitTurnIdx, ts: activeSequence[unitTurnIdx].timestamp, pct: totalFrames > 1 ? Math.round(unitTurnIdx / (totalFrames - 1) * 100) : 0 },
        racketDrop: { frameIdx: racketDropIdx, ts: activeSequence[racketDropIdx].timestamp, pct: totalFrames > 1 ? Math.round(racketDropIdx / (totalFrames - 1) * 100) : 0 },
        contact: { frameIdx: contactIdx, ts: activeSequence[contactIdx].timestamp, pct: totalFrames > 1 ? Math.round(contactIdx / (totalFrames - 1) * 100) : 0 },
        followThrough: { frameIdx: followThroughIdx, ts: activeSequence[followThroughIdx].timestamp, pct: totalFrames > 1 ? Math.round(followThroughIdx / (totalFrames - 1) * 100) : 0 },
        totalFrames,
        videoDuration: parseFloat(videoDuration.toFixed(2)),
        handedness: detectedIsRightHanded ? 'right' : 'left',
        strokeType: 'forehand',
        scoreArrays: userPhases.scoreArrays ?? null,
        correctionKey: userPhases.correctionKey ?? null,
    };

    return generatedIssues.map(i => ({
        ...i,
        strokeType: 'forehand' as StrokeType,
        debug: { ...((i.debug as Record<string, unknown>) ?? {}), phaseDetection: phaseDetectionDebug },
    }));
}
