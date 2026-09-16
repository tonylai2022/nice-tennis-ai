import type { PoseResult } from '../BaseMotionAnalysis';
import type { SubtleMovementMetrics, SubtleMovementSeries, SubtleMovementResult } from './types';
import type { StrokeType } from '../../CalibrationService';
import {
  smoothArray, safeMean, safeStd, peakOf,
  computeAngularVelocityDegPerSec, kneeAngleDeg, headRelativeSway,
  trimStaticFrames, resampleSequence, extractKinematicFeatures,
  detectDominantArmIsRight,
} from './poseUtils';
import { performDTW } from './dtw';

export function computeSubtleMovement(
    refSequence: PoseResult[],
    userSequence: PoseResult[],
    strokeType: StrokeType
  ): SubtleMovementResult {
    const trimmedRef = trimStaticFrames(refSequence);
    const trimmedUser = trimStaticFrames(userSequence);
    if (trimmedRef.length < 8 || trimmedUser.length < 8) {
      return { summary: `SUBTLE MOVEMENT METRICS: Not enough valid pose frames to compute timing/kinematics.` };
    }

    // Resample to a stable length for robust timing comparisons.
    const targetLen = 60;
    const resampledRef = resampleSequence(trimmedRef, targetLen);
    const resampledUser = resampleSequence(trimmedUser, targetLen);

    // Align by motion shape (DTW) so timing differences don't dominate form comparisons.
    const { alignedRef, alignedUser } = performDTW(resampledRef, resampledUser);
    if (alignedRef.length < 10 || alignedUser.length < 10) {
      return { summary: `SUBTLE MOVEMENT METRICS: DTW alignment failed (insufficient aligned frames).` };
    }

    const pref = 'auto';
    const userIsRight = pref === 'auto' ? detectDominantArmIsRight(alignedUser) : pref === 'right';
    const refIsRight = detectDominantArmIsRight(alignedRef);

    console.log(`[SubtleMovement] ${strokeType}: User dominant arm=${userIsRight ? 'RIGHT' : 'LEFT'}, Ref dominant arm=${refIsRight ? 'RIGHT' : 'LEFT'}`);

    const userKin = extractKinematicFeatures(alignedUser, userIsRight);
    const refKin = extractKinematicFeatures(alignedRef, refIsRight);

    const userT = alignedUser.map(f => f.timestamp);
    const refT = alignedRef.map(f => f.timestamp);

    const userTrunkVel = computeAngularVelocityDegPerSec(userKin.trunkAngle, userT);
    const refTrunkVel = computeAngularVelocityDegPerSec(refKin.trunkAngle, refT);

    const userTrunkPeak = peakOf(userKin.trunkAngle);
    const refTrunkPeak = peakOf(refKin.trunkAngle);
    const userUncoilPeak = peakOf(userTrunkVel);
    const refUncoilPeak = peakOf(refTrunkVel);
    const userArmPeak = peakOf(userKin.armAngularVelocity);
    const refArmPeak = peakOf(refKin.armAngularVelocity);

    const userContactIdx = userArmPeak.index;
    const refContactIdx = refArmPeak.index;

    const userContactTime = userT[userContactIdx] ?? userT[Math.floor(userT.length / 2)] ?? 0;
    const refContactTime = refT[refContactIdx] ?? refT[Math.floor(refT.length / 2)] ?? 0;
    const userUncoilTime = userT[userUncoilPeak.index] ?? userContactTime;
    const refUncoilTime = refT[refUncoilPeak.index] ?? refContactTime;

    const userTrunkPeakTime = userT[userTrunkPeak.index] ?? userContactTime;
    const refTrunkPeakTime = refT[refTrunkPeak.index] ?? refContactTime;

    const uncoilToArmLagUser = userContactTime - userUncoilTime;
    const uncoilToArmLagRef = refContactTime - refUncoilTime;

    // Knee bend (min angle = deepest bend) across aligned frames.
    const userKnees: number[] = [];
    const refKnees: number[] = [];
    for (let i = 0; i < alignedUser.length; i++) {
      const uL = kneeAngleDeg(alignedUser[i], 'left');
      const uR = kneeAngleDeg(alignedUser[i], 'right');
      const rL = kneeAngleDeg(alignedRef[i], 'left');
      const rR = kneeAngleDeg(alignedRef[i], 'right');
      if (uL != null) userKnees.push(uL);
      if (uR != null) userKnees.push(uR);
      if (rL != null) refKnees.push(rL);
      if (rR != null) refKnees.push(rR);
    }
    const userMinKnee = userKnees.length ? Math.min(...userKnees) : 0;
    const refMinKnee = refKnees.length ? Math.min(...refKnees) : 0;

    // Head stability (relative sway vs hips): std-dev of nose position relative to hip midpoint.
    const userSwayX: number[] = [];
    const userSwayY: number[] = [];
    const refSwayX: number[] = [];
    const refSwayY: number[] = [];
    for (let i = 0; i < alignedUser.length; i++) {
      const us = headRelativeSway(alignedUser[i]);
      const rs = headRelativeSway(alignedRef[i]);
      if (us) {
        userSwayX.push(us.x);
        userSwayY.push(us.y);
      }
      if (rs) {
        refSwayX.push(rs.x);
        refSwayY.push(rs.y);
      }
    }
    const userSway = Math.hypot(safeStd(userSwayX), safeStd(userSwayY));
    const refSway = Math.hypot(safeStd(refSwayX), safeStd(refSwayY));

    // Elbow configuration stability (useful for “arming” vs fluid whip).
    const userElbowStd = safeStd(userKin.elbowAngle);
    const refElbowStd = safeStd(refKin.elbowAngle);

    const userArmPeakTime = userT[userArmPeak.index] ?? userContactTime;
    const refArmPeakTime = refT[refArmPeak.index] ?? refContactTime;

    const warnings: string[] = [];
    if (userIsRight !== refIsRight) {
      console.warn(`[SubtleMovement] WARNING: ${strokeType} - User is ${userIsRight ? 'RIGHT' : 'LEFT'}-handed but Ref is ${refIsRight ? 'RIGHT' : 'LEFT'}-handed`);
      warnings.push('user/ref appear opposite-handed or mirrored; side-specific metrics may be less reliable');
    } else {
      console.log(`[SubtleMovement] ${strokeType} - Both using ${userIsRight ? 'RIGHT' : 'LEFT'} arm (consistent)`);
    }

    const metrics: SubtleMovementMetrics = {
      strokeType,
      userHittingArm: userIsRight ? 'right' : 'left',
      refHittingArm: refIsRight ? 'right' : 'left',
      warnings: warnings.length ? warnings : undefined,

      coilPeakDeg: userTrunkPeak.value,
      coilPeakTimeSec: userTrunkPeakTime,
      refCoilPeakDeg: refTrunkPeak.value,
      refCoilPeakTimeSec: refTrunkPeakTime,

      uncoilSpeedPeakDegPerSec: userUncoilPeak.value,
      uncoilSpeedPeakTimeSec: userUncoilTime,
      refUncoilSpeedPeakDegPerSec: refUncoilPeak.value,
      refUncoilSpeedPeakTimeSec: refUncoilTime,

      armWhipPeakDegPerSec: userArmPeak.value,
      armWhipPeakTimeSec: userArmPeakTime,
      refArmWhipPeakDegPerSec: refArmPeak.value,
      refArmWhipPeakTimeSec: refArmPeakTime,

      trunkToArmLagSec: uncoilToArmLagUser,
      refTrunkToArmLagSec: uncoilToArmLagRef,

      kneeMinAngleUserDeg: userMinKnee > 0 ? userMinKnee : undefined,
      kneeMinAngleRefDeg: refMinKnee > 0 ? refMinKnee : undefined,
      headSwayStdUser: userSway > 0 ? userSway : undefined,
      headSwayStdRef: refSway > 0 ? refSway : undefined,
      elbowAngleStdUserDeg: userElbowStd > 0 ? userElbowStd : undefined,
      elbowAngleStdRefDeg: refElbowStd > 0 ? refElbowStd : undefined,
    };

    // Build series for simple charts (same aligned length).
    const alignedLen = Math.min(
      userKin.trunkAngle.length,
      refKin.trunkAngle.length,
      userKin.elbowAngle.length,
      refKin.elbowAngle.length,
      userKin.armAngularVelocity.length,
      refKin.armAngularVelocity.length,
      userTrunkVel.length,
      refTrunkVel.length
    );

    const x = Array.from({ length: alignedLen }, (_, i) => (alignedLen <= 1 ? 0 : i / (alignedLen - 1)));
    const series: SubtleMovementSeries = {
      x,
      contactIndex: Math.min(alignedLen - 1, Math.max(0, userContactIdx)),
      trunkAngleUser: userKin.trunkAngle.slice(0, alignedLen),
      trunkAngleRef: refKin.trunkAngle.slice(0, alignedLen),
      trunkVelUser: userTrunkVel.slice(0, alignedLen),
      trunkVelRef: refTrunkVel.slice(0, alignedLen),
      elbowAngleUser: userKin.elbowAngle.slice(0, alignedLen),
      elbowAngleRef: refKin.elbowAngle.slice(0, alignedLen),
      armVelUser: userKin.armAngularVelocity.slice(0, alignedLen),
      armVelRef: refKin.armAngularVelocity.slice(0, alignedLen),
    };

    // Format for LLM consumption: compact, numeric, coach-interpretable.
    const lines: string[] = [];
    lines.push(`SUBTLE MOVEMENT METRICS (DTW-aligned, camera-robust proxies):`);
    lines.push(`- Stroke: ${strokeType}`);
    lines.push(`- Detected hitting arm: user=${metrics.userHittingArm}, reference=${metrics.refHittingArm}`);
    for (const w of warnings) lines.push(`- Note: ${w}`);

    lines.push(
      `- Coil/Separation proxy (shoulder vs hip line): user peak ${userTrunkPeak.value.toFixed(1)}° @ ${userTrunkPeakTime.toFixed(2)}s vs ref ${refTrunkPeak.value.toFixed(1)}° @ ${refTrunkPeakTime.toFixed(2)}s (Δ ${(userTrunkPeak.value - refTrunkPeak.value).toFixed(1)}°)`
    );
    lines.push(
      `- Uncoil speed proxy (dSeparation/dt): user peak ${userUncoilPeak.value.toFixed(0)}°/s @ ${userUncoilTime.toFixed(2)}s vs ref ${refUncoilPeak.value.toFixed(0)}°/s @ ${refUncoilTime.toFixed(2)}s`
    );
    lines.push(
      `- Arm whip proxy (elbow angular velocity): user peak ${userArmPeak.value.toFixed(0)}°/s @ ${userArmPeakTime.toFixed(2)}s vs ref ${refArmPeak.value.toFixed(0)}°/s @ ${refArmPeakTime.toFixed(2)}s`
    );
    lines.push(
      `- Trunk→Arm timing (contact proxy = max arm speed): user lag ${uncoilToArmLagUser.toFixed(2)}s vs ref ${uncoilToArmLagRef.toFixed(2)}s (Δ ${(uncoilToArmLagUser - uncoilToArmLagRef).toFixed(2)}s)`
    );

    if (userMinKnee > 0 && refMinKnee > 0) {
      lines.push(
        `- Knee bend depth (min knee angle): user ${userMinKnee.toFixed(0)}° vs ref ${refMinKnee.toFixed(0)}° (lower = deeper bend)`
      );
    }

    if (userSway > 0 && refSway > 0) {
      lines.push(
        `- Head stability proxy (nose sway vs hips, std): user ${userSway.toFixed(3)} vs ref ${refSway.toFixed(3)} (lower = steadier)`
      );
    }

    if (userElbowStd > 0 && refElbowStd > 0) {
      lines.push(
        `- Elbow angle variability (std): user ${userElbowStd.toFixed(1)}° vs ref ${refElbowStd.toFixed(1)}° (very high can indicate inconsistent arm shape)`
      );
    }

    lines.push(`COACHING INTERPRETATION REQUEST:`);
    lines.push(`- Use these timing/velocity metrics to explain subtle issues (late uncoil, arming, unstable head, shallow knee bend).`);
    lines.push(`- Tie fixes to drills/cues that change timing (e.g., earlier hip drive, delayed arm, stay tall through toss, deeper load).`);

    return { metrics, series, summary: lines.join('\n') };
  }

export function generateSubtleMovementSummary(
    refSequence: PoseResult[],
    userSequence: PoseResult[],
    strokeType: StrokeType
  ): string {
    return computeSubtleMovement(refSequence, userSequence, strokeType).summary;
  }
