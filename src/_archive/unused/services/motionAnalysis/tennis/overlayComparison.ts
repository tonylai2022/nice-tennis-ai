import type { PoseResult, AlignmentIssue } from '../BaseMotionAnalysis';
import type { OverlayComparisonResult, FrameComparisonResult } from './types';
import type { StrokeType, PhaseType } from '../../CalibrationService';
import { CalibrationService } from '../../CalibrationService';
import {
  normalizeLandmarks, calculateFrameSimilarity, resampleSequence,
  trimStaticFrames,
} from './poseUtils';
import { shouldUseDtwAlignment } from './phaseConfig';
import { KEY_TENNIS_JOINTS, JOINT_NAMES } from './phaseConfig';

export function alignSequencesDTW(
    userSequence: PoseResult[],
    refSequence: PoseResult[]
  ): { userIdx: number; refIdx: number }[] {
    const n = userSequence.length;
    const m = refSequence.length;

    if (n === 0 || m === 0) return [];

    // Cost function: sum of squared differences for key joints
    const cost = (userFrame: PoseResult, refFrame: PoseResult): number => {
      const userMirrored = false; const refMirrored = false;
      const userNorm = normalizeLandmarks(userFrame.landmarks, userMirrored);
      const refNorm = normalizeLandmarks(refFrame.landmarks, refMirrored);

      if (userNorm.length === 0 || refNorm.length === 0) return Infinity;

      let totalDist = 0;
      for (const jointIdx of KEY_TENNIS_JOINTS) {
        if (userNorm[jointIdx] && refNorm[jointIdx]) {
          const dx = userNorm[jointIdx].x - refNorm[jointIdx].x;
          const dy = userNorm[jointIdx].y - refNorm[jointIdx].y;
          totalDist += dx * dx + dy * dy;
        }
      }
      return totalDist;
    };

    // DTW matrix
    const dtw: number[][] = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
    dtw[0][0] = 0;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const c = cost(userSequence[i - 1], refSequence[j - 1]);
        dtw[i][j] = c + Math.min(
          dtw[i - 1][j],     // Insertion
          dtw[i][j - 1],     // Deletion
          dtw[i - 1][j - 1]  // Match
        );
      }
    }

    // Backtrack to find alignment
    const alignment: { userIdx: number; refIdx: number }[] = [];
    let i = n, j = m;

    while (i > 0 && j > 0) {
      alignment.unshift({ userIdx: i - 1, refIdx: j - 1 });

      const diag = dtw[i - 1][j - 1];
      const up = dtw[i - 1][j];
      const left = dtw[i][j - 1];

      if (diag <= up && diag <= left) {
        i--; j--;
      } else if (up <= left) {
        i--;
      } else {
        j--;
      }
    }

    return alignment;
  }

export function compareFramePair(
    userFrame: PoseResult,
    refFrame: PoseResult,
    frameIndex: number
  ): FrameComparisonResult | null {
    const userMirrored = false; const refMirrored = false;
    const userNorm = normalizeLandmarks(userFrame.landmarks, userMirrored);
    const refNorm = normalizeLandmarks(refFrame.landmarks, refMirrored);

    if (userNorm.length === 0 || refNorm.length === 0) return null;

    const jointDifferences: FrameComparisonResult['jointDifferences'] = [];
    let totalDiff = 0;
    let validJoints = 0;

    for (const jointIdx of KEY_TENNIS_JOINTS) {
      if (!userNorm[jointIdx] || !refNorm[jointIdx]) continue;

      const dx = userNorm[jointIdx].x - refNorm[jointIdx].x;
      const dy = userNorm[jointIdx].y - refNorm[jointIdx].y;
      const dz = userNorm[jointIdx].z - refNorm[jointIdx].z;

      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const normalizedDiff = Math.min(distance / 2, 1); // Clamp to 0-1

      // Generate human-readable description
      let description = '';
      if (normalizedDiff > 0.1) {
        const jointName = JOINT_NAMES[jointIdx] || `joint_${jointIdx}`;
        const direction = dy > 0.05 ? 'lower' : dy < -0.05 ? 'higher' :
          dx > 0.05 ? 'more right' : dx < -0.05 ? 'more left' : 'offset';
        description = `${jointName} is ${(normalizedDiff * 100).toFixed(0)}% ${direction} than reference`;
      }

      jointDifferences.push({
        jointName: JOINT_NAMES[jointIdx] || `joint_${jointIdx}`,
        jointIndex: jointIdx,
        difference: normalizedDiff,
        userPosition: userNorm[jointIdx],
        refPosition: refNorm[jointIdx],
        description
      });

      totalDiff += normalizedDiff;
      validJoints++;
    }

    const overallSimilarity = validJoints > 0 ? 1 - (totalDiff / validJoints) : 0;

    return {
      frameIndex,
      userTimestamp: userFrame.timestamp,
      refTimestamp: refFrame.timestamp,
      jointDifferences,
      overallSimilarity,
      userFrameImage: userFrame.frameData,
      refFrameImage: refFrame.frameData
    };
  }

export function compareWithOverlay(
    userSequence: PoseResult[],
    refSequence: PoseResult[],
    strokeType: StrokeType
  ): OverlayComparisonResult {
    console.log(`[OverlayCompare] Comparing ${userSequence.length} user frames to ${refSequence.length} ref frames`);

    // Trim static frames
    const activeUser = trimStaticFrames(userSequence);
    const activeRef = trimStaticFrames(refSequence);

    console.log(`[OverlayCompare] After trim: ${activeUser.length} user, ${activeRef.length} ref`);

    // Align sequences using DTW
    const alignment = alignSequencesDTW(activeUser, activeRef);
    console.log(`[OverlayCompare] DTW aligned ${alignment.length} frame pairs`);

    // Compare each aligned frame pair
    const alignedFrames: FrameComparisonResult[] = [];
    const differenceTimeline: { timestamp: number; similarity: number }[] = [];

    // Sample alignment to avoid too many comparisons
    const sampleRate = Math.max(1, Math.floor(alignment.length / 30));

    for (let i = 0; i < alignment.length; i += sampleRate) {
      const { userIdx, refIdx } = alignment[i];
      const comparison = compareFramePair(activeUser[userIdx], activeRef[refIdx], i);

      if (comparison) {
        alignedFrames.push(comparison);
        differenceTimeline.push({
          timestamp: comparison.userTimestamp,
          similarity: comparison.overallSimilarity
        });
      }
    }

    // Find top issues (joints with biggest average differences)
    // NOTE: FrameComparisonResult.frameIndex is the sampled DTW index (i), not an index into alignedFrames.
    // Store the alignedFrames array index so overlayToIssues can reliably dereference.
    const jointStats: Map<string, { total: number; count: number; worst: number; worstFrame: number }> = new Map();

    for (let alignedIdx = 0; alignedIdx < alignedFrames.length; alignedIdx++) {
      const frame = alignedFrames[alignedIdx];
      for (const joint of frame.jointDifferences) {
        if (!jointStats.has(joint.jointName)) {
          jointStats.set(joint.jointName, { total: 0, count: 0, worst: 0, worstFrame: 0 });
        }
        const stat = jointStats.get(joint.jointName)!;
        stat.total += joint.difference;
        stat.count++;
        if (joint.difference > stat.worst) {
          stat.worst = joint.difference;
          stat.worstFrame = alignedIdx;
        }
      }
    }

    // Sort joints by average difference
    const topIssues = Array.from(jointStats.entries())
      .map(([name, stat]) => ({
        jointName: name,
        avgDifference: stat.total / stat.count,
        worstFrame: stat.worstFrame,
        description: `${name}: ${(stat.total / stat.count * 100).toFixed(0)}% avg difference, worst at frame ${stat.worstFrame}`
      }))
      .filter(issue => issue.avgDifference > 0.08) // Only significant differences
      .sort((a, b) => b.avgDifference - a.avgDifference)
      .slice(0, 5); // Top 5 issues

    // Generate AI prompt with all metrics
    const aiPrompt = generateAIPrompt(strokeType, alignedFrames, topIssues, differenceTimeline);

    console.log(`[OverlayCompare] Found ${topIssues.length} significant issues`);
    console.log(`[OverlayCompare] Top issues:`, topIssues.map(i => i.jointName).join(', '));

    return {
      alignedFrames,
      topIssues,
      differenceTimeline,
      aiPrompt
    };
  }

export function overlayToIssues(
    overlay: OverlayComparisonResult,
    userSequence: PoseResult[],
    refSequence: PoseResult[],
    strokeType: StrokeType
  ): AlignmentIssue[] {
    const issues: AlignmentIssue[] = [];

    const findClosestByTimestamp = (sequence: PoseResult[], timestamp: number): PoseResult | null => {
      if (!sequence.length) return null;
      let best = sequence[0];
      let bestDist = Math.abs(best.timestamp - timestamp);
      for (let i = 1; i < sequence.length; i++) {
        const d = Math.abs(sequence[i].timestamp - timestamp);
        if (d < bestDist) {
          best = sequence[i];
          bestDist = d;
        }
      }
      return best;
    };

    const mirrorLandmarksX = (landmarks: any[] | undefined): any[] | undefined => {
      if (!landmarks) return undefined;
      return landmarks.map((lm: any) => {
        if (!lm) return lm;
        return { ...lm, x: 1 - lm.x };
      });
    };

    const phaseLabelForTimestamp = (sequenceForPhases: PoseResult[], timestamp: number): string => {
      // Prefer calibration-driven phase boundaries (anchor segments) when available.
      const calibrated = CalibrationService.findPhasesWithCalibration(strokeType, sequenceForPhases);
      const mapPhase = (p: PhaseType): string => {
        if (strokeType === 'serve') {
          const m: Record<string, string> = {
            preparation: 'preparation',
            ball_toss: 'toss',
            loading: 'backswing',
            contact: 'contact',
            finish: 'followThrough'
          };
          return m[String(p)] ?? String(p);
        }
        const m: Record<string, string> = {
          unit_turn: 'unitTurn',
          racket_drop: 'backswing',
          contact: 'contact',
          follow_through: 'followThrough'
        };
        return m[String(p)] ?? String(p);
      };

      if (calibrated && calibrated.length) {
        const pts = calibrated
          .slice()
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(p => ({ label: mapPhase(p.phase), t: p.timestamp }));

        let label = pts[0].label;
        for (const pt of pts) {
          if (timestamp >= pt.t) label = pt.label;
        }
        return label;
      }

      // Fallback: progress-based segmentation.
      const labels = strokeType === 'serve'
        ? ['preparation', 'toss', 'backswing', 'contact', 'followThrough']
        : ['unitTurn', 'backswing', 'contact', 'followThrough'];

      const start = sequenceForPhases[0]?.timestamp ?? 0;
      const end = sequenceForPhases[sequenceForPhases.length - 1]?.timestamp ?? (start + 1);
      const denom = Math.max(1e-6, end - start);
      const prog = Math.max(0, Math.min(0.999, (timestamp - start) / denom));
      const idx = Math.max(0, Math.min(labels.length - 1, Math.floor(prog * labels.length)));
      return labels[idx];
    };

    const userMirrored = false; const refMirrored = false;
    const userForPhases = userMirrored
      ? userSequence.map(f => ({ ...f, landmarks: mirrorLandmarksX(f.landmarks) }))
      : userSequence;
    // (Optional) if we later want phase labels from reference timestamps too, we can mirror + run calibration here.

    // Generate one issue per significant joint difference
    for (const issue of overlay.topIssues) {
      // Find the frame with the worst difference for this joint
      const worstFrameData = overlay.alignedFrames[issue.worstFrame];
      if (!worstFrameData) continue;

      // Find the joint info
      const jointInfo = worstFrameData.jointDifferences.find(j => j.jointName === issue.jointName);
      if (!jointInfo) continue;

      // Generate human-readable feedback
      let feedback = '';
      const diffPercent = Math.round(issue.avgDifference * 100);

      if (issue.jointName.includes('wrist')) {
        feedback = `Wrist position is ${diffPercent}% different from pro - check your racket path`;
      } else if (issue.jointName.includes('elbow')) {
        feedback = `Elbow is ${diffPercent}% off - focus on arm shape during the swing`;
      } else if (issue.jointName.includes('shoulder')) {
        feedback = `Shoulder rotation is ${diffPercent}% different - work on upper body coil`;
      } else if (issue.jointName.includes('hip')) {
        feedback = `Hip position ${diffPercent}% off - focus on weight transfer`;
      } else if (issue.jointName.includes('knee')) {
        feedback = `Knee bend is ${diffPercent}% different - check your leg drive`;
      } else {
        feedback = `${issue.jointName} is ${diffPercent}% different from reference`;
      }

      // Determine color based on severity
      const color = diffPercent > 25 ? 'red' : diffPercent > 15 ? 'orange' : 'yellow';

      // Pick frames by nearest timestamp (FPS independent; works across devices).
      const userFrame = findClosestByTimestamp(userSequence, worstFrameData.userTimestamp)
        ?? userSequence[Math.floor(userSequence.length / 2)];
      const refFrame = findClosestByTimestamp(refSequence, worstFrameData.refTimestamp)
        ?? refSequence[Math.floor(refSequence.length / 2)];

      // Assign a phase label using calibration (anchor-based) when available.
      const phase = phaseLabelForTimestamp(userForPhases, worstFrameData.userTimestamp);

      issues.push({
        phase,
        issue: feedback,
        timestamp: worstFrameData.userTimestamp,
        landmarks: userFrame.landmarks,
        worldLandmarks: userFrame.worldLandmarks,
        strokeType,
        visualCue: {
          targetIndex: jointInfo.jointIndex,
          cueType: 'circle',
          color
        },
        frameImage: worstFrameData.userFrameImage,
        refTimestamp: worstFrameData.refTimestamp,
        refLandmarks: refFrame.landmarks,
        refWorldLandmarks: refFrame.worldLandmarks,
        refFrameImage: worstFrameData.refFrameImage,
        refVisualCue: {
          targetIndex: jointInfo.jointIndex,
          cueType: 'circle',
          color: 'emerald'
        }
      });
    }

    return issues;
  }

export function analyzeStrokeWithOverlay(
    userSequence: PoseResult[],
    refSequence: PoseResult[],
    strokeType: StrokeType
  ): { issues: AlignmentIssue[]; overlay: OverlayComparisonResult } {
    console.log(`[OverlayAPI] Analyzing ${strokeType} with overlay comparison`);

    // Run overlay comparison
    const overlay = compareWithOverlay(userSequence, refSequence, strokeType);

    // Convert to issues for display
    const issues = overlayToIssues(overlay, userSequence, refSequence, strokeType);

    console.log(`[OverlayAPI] Generated ${issues.length} issues from overlay analysis`);
    console.log(`[OverlayAPI] AI Prompt ready: ${overlay.aiPrompt.substring(0, 100)}...`);

    return { issues, overlay };
  }

export function generateAIPrompt(
    strokeType: StrokeType,
    alignedFrames: FrameComparisonResult[],
    topIssues: { jointName: string; avgDifference: number; worstFrame: number; description: string }[],
    timeline: { timestamp: number; similarity: number }[]
  ): string {
    // Find worst frame overall
    const worstFrame = alignedFrames.reduce((worst, frame) =>
      frame.overallSimilarity < worst.overallSimilarity ? frame : worst
      , alignedFrames[0]);

    // Find best frame overall
    const bestFrame = alignedFrames.reduce((best, frame) =>
      frame.overallSimilarity > best.overallSimilarity ? frame : best
      , alignedFrames[0]);

    const avgSimilarity = timeline.reduce((sum, t) => sum + t.similarity, 0) / timeline.length;

    let prompt = `Analyze this ${strokeType} comparison:\n\n`;
    prompt += `OVERALL: ${(avgSimilarity * 100).toFixed(0)}% similar to professional reference\n`;
    prompt += `BEST MATCH: Frame ${bestFrame?.frameIndex} at ${bestFrame?.userTimestamp.toFixed(2)}s (${(bestFrame?.overallSimilarity * 100).toFixed(0)}% match)\n`;
    prompt += `WORST MATCH: Frame ${worstFrame?.frameIndex} at ${worstFrame?.userTimestamp.toFixed(2)}s (${(worstFrame?.overallSimilarity * 100).toFixed(0)}% match)\n\n`;

    prompt += `TOP DIFFERENCES (joints that differ most from pro):\n`;
    for (const issue of topIssues) {
      prompt += `- ${issue.jointName}: ${(issue.avgDifference * 100).toFixed(0)}% off on average\n`;
    }

    prompt += `\nFRAME-BY-FRAME JOINT OFFSETS AT WORST MATCH:\n`;
    if (worstFrame) {
      const significantJoints = worstFrame.jointDifferences
        .filter(j => j.difference > 0.1)
        .sort((a, b) => b.difference - a.difference);

      for (const joint of significantJoints.slice(0, 5)) {
        prompt += `- ${joint.description}\n`;
      }
    }

    prompt += `\nPlease explain what the player should focus on improving based on these metrics.`;

    return prompt;
  }
