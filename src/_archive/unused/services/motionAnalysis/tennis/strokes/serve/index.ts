import type { PoseResult, AlignmentIssue } from '../../../BaseMotionAnalysis';
import type { StrokeType, PhaseType } from '../../../../CalibrationService';
import { trimStaticFrames } from '../../poseUtils';
import { findServePhases } from './advancedDetect';
import { buildRefFrameHelpers } from './refFrames';
import { generateServeIssues } from './issues';

export { findServePhases } from './advancedDetect';

export function detectServeIssues(
    sequence: PoseResult[],
    refSequence?: PoseResult[],
    refVideoUrl?: string,
    phaseTimestamps?: Record<string, number>,
): AlignmentIssue[] {
    const activeSequence = trimStaticFrames(sequence);
    const activeRefSequence = refSequence ? trimStaticFrames(refSequence) : [];

    if (activeSequence.length < 10) return [];

    // 1. Detect user phases
    const userPhases = findServePhases(activeSequence, false);
    let prepIdx = userPhases.indices.prepIdx;
    let tossIdx = userPhases.indices.tossPeakIdx;
    let loadingIdx = userPhases.indices.loadingIdx;
    let contactIdx = userPhases.indices.contactIdx;
    let finishIdx = userPhases.indices.finishIdx;

    console.log('[Serve] User phases detected:');
    console.log(`  Prep: ${prepIdx}, Toss: ${tossIdx}, Loading: ${loadingIdx}, Contact: ${contactIdx}, Finish: ${finishIdx}`);

    const len = activeSequence.length;

    // Phase ordering validation
    if (prepIdx >= tossIdx) prepIdx = Math.max(0, tossIdx - 3);
    if (tossIdx >= loadingIdx) tossIdx = Math.max(prepIdx + 1, loadingIdx - 3);
    if (loadingIdx >= contactIdx) loadingIdx = Math.max(tossIdx + 1, contactIdx - 3);
    if (finishIdx <= contactIdx) finishIdx = Math.min(len - 1, contactIdx + 3);

    console.log(`[Serve] Final: PREP@${prepIdx} TOSS@${tossIdx} LOAD@${loadingIdx} CT@${contactIdx} FIN@${finishIdx}`);

    // 2. Build finalUserPhases map
    const finalUserPhases = new Map<PhaseType, { frame: PoseResult; timestamp: number; frameIndex: number; confidence: number }>();
    finalUserPhases.set('preparation', { frame: activeSequence[prepIdx], timestamp: activeSequence[prepIdx].timestamp, frameIndex: prepIdx, confidence: 0.80 });
    finalUserPhases.set('ball_toss', { frame: activeSequence[tossIdx], timestamp: activeSequence[tossIdx].timestamp, frameIndex: tossIdx, confidence: 0.85 });
    finalUserPhases.set('loading', { frame: activeSequence[loadingIdx], timestamp: activeSequence[loadingIdx].timestamp, frameIndex: loadingIdx, confidence: 0.80 });
    finalUserPhases.set('contact', { frame: activeSequence[contactIdx], timestamp: activeSequence[contactIdx].timestamp, frameIndex: contactIdx, confidence: 0.90 });
    finalUserPhases.set('finish', { frame: activeSequence[finishIdx], timestamp: activeSequence[finishIdx].timestamp, frameIndex: finishIdx, confidence: 0.80 });

    // 3. Detect ref phases
    const hasRefCalibration = phaseTimestamps != null && (
        phaseTimestamps.prep != null || phaseTimestamps.contact != null
    );
    let refPhases = null;
    if (!hasRefCalibration && activeRefSequence.length > 10) {
        refPhases = findServePhases(activeRefSequence, true, refVideoUrl || '');
        console.log('[Serve] Ref Phases (kinematic auto-detected):', refPhases.indices);
    } else if (hasRefCalibration) {
        console.log('[Serve] Ref Phases: using admin calibration timestamps');
    }

    // 4. Build ref frame helpers
    const { getRefFrame, getRefTimestamp } = buildRefFrameHelpers(activeRefSequence, phaseTimestamps, refPhases);

    // 5. Generate issues
    const issues = generateServeIssues({
        activeSequence,
        activeRefSequence,
        finalUserPhases,
        getRefFrame,
        getRefTimestamp,
        hasRefCalibration,
    });

    return issues.map(i => ({ ...i, strokeType: 'serve' as StrokeType }));
}
