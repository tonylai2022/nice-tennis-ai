import type { PoseResult, AlignmentIssue } from '../BaseMotionAnalysis';
import {
  calculateAngle, calculateAngle3D, calculateLandmarkVelocity3D,
  calculateTrunkRotation, calculateArmExtension, calculateKneeBend,
  smoothArray, resampleArray, trimStaticFrames, resampleSequence,
  calculateFrameSimilarity,
} from './poseUtils';
import { performDTW, buildUserToRefTimeMapper } from './dtw';

export function computeCoachRubricScores(
  sequence: PoseResult[],
  phaseTimestamps: { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
  isRightHanded: boolean
): { unit_turn: number; racket_drop: number; contact: number; follow_through: number; overall: number } {

  const neutral = { unit_turn: 50, racket_drop: 50, contact: 50, follow_through: 50, overall: 50 };
  if (!sequence.length) return neutral;

  // Find closest frame to a timestamp
  const frameAt = (ts: number): PoseResult => {
    let best = sequence[0]; let bestD = Infinity;
    for (const f of sequence) { const d = Math.abs(f.timestamp - ts); if (d < bestD) { bestD = d; best = f; } }
    return best;
  };

  const utF = frameAt(phaseTimestamps.unitTurn);
  const rdF = frameAt(phaseTimestamps.racketDrop);
  const ctF = frameAt(phaseTimestamps.contact);
  const ftF = frameAt(phaseTimestamps.followThrough);

  // Handedness-aware landmark indices
  const hitShoulder = isRightHanded ? 12 : 11;
  const offShoulder = isRightHanded ? 11 : 12;
  const hitElbow = isRightHanded ? 14 : 13;
  const hitWrist = isRightHanded ? 16 : 15;
  const hitHip = isRightHanded ? 24 : 23;
  const offHip = isRightHanded ? 23 : 24;

  const lm = (f: PoseResult) => f.landmarks;

  // Inter-shoulder width — body scale reference
  const ISW = (f: PoseResult): number => {
    const ls = lm(f)[11]; const rs = lm(f)[12];
    return (ls && rs) ? Math.max(0.05, Math.hypot(rs.x - ls.x, rs.y - ls.y)) : 0.15;
  };

  // 2-D angle at joint B in degrees: A-B-C
  const angle2D = (
    a: { x: number; y: number } | undefined,
    b: { x: number; y: number } | undefined,
    c: { x: number; y: number } | undefined
  ): number => {
    if (!a || !b || !c) return NaN;
    const abx = a.x - b.x; const aby = a.y - b.y;
    const cbx = c.x - b.x; const cby = c.y - b.y;
    const dot = abx * cbx + aby * cby;
    const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
    if (mag < 1e-9) return NaN;
    return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
  };

  const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  // Score how close val is to ideal, losing all points at ±tolerance
  const closeness = (val: number, ideal: number, tolerance: number) =>
    isFinite(val) ? clamp(100 - Math.abs(val - ideal) / tolerance * 100) : 50;

  // ───────────── UNIT TURN ─────────────
  // Goal: maximum shoulder coil — shoulders turned 75-90° to net.
  // In a side-view frame, a fully rotated player shows narrow shoulder width.
  // Proxy: shoulderWidth / hipWidth ratio (lower = more rotated).
  let utScore = 50;
  {
    const m = lm(utF); const isw = ISW(utF);
    const ls = m[11]; const rs = m[12]; const lh = m[23]; const rh = m[24];
    if (ls && rs && lh && rh) {
      const sw = Math.hypot(rs.x - ls.x, rs.y - ls.y);
      const hw = Math.hypot(rh.x - lh.x, rh.y - lh.y);
      const ratio = sw / Math.max(hw, 0.01);
      // 100 at ratio 0.55 (fully rotated), 0 at ratio 1.35 (face-on) — wider tolerance
      const rotScore = clamp(100 - ((ratio - 0.55) / 0.80) * 100);
      // Bonus: hitting elbow pulled back — upper arm angle behind body
      const elbowAngle = angle2D(m[hitWrist], m[hitElbow], m[hitShoulder]);
      const elbowScore = closeness(elbowAngle, 105, 50);
      utScore = clamp(rotScore * 0.65 + elbowScore * 0.35);
    }
  }

  // ───────────── RACKET DROP ─────────────
  // Goal: racket head drops below the wrist; wrist drops below elbow.
  // This creates the essential "lag" for topspin.
  let rdScore = 50;
  {
    const m = lm(rdF); const isw = ISW(rdF);
    const wrist = m[hitWrist]; const elbow = m[hitElbow]; const shoulder = m[hitShoulder];
    if (wrist && elbow && shoulder && isw > 0.01) {
      // Image Y increases downward. wrist.y > elbow.y → wrist below elbow (good).
      const wristBelowElbow = (wrist.y - elbow.y) / isw;
      // 100 at 0.3 ISW drop, 0 at –0.2 ISW (wrist above elbow)
      const dropScore = clamp(100 + (wristBelowElbow - 0.3) / 0.5 * 100);

      // Elbow bend: 85-105° is ideal lag position
      const elbowBend = angle2D(shoulder, elbow, wrist);
      const elbowScore = closeness(elbowBend, 95, 45);

      rdScore = clamp(dropScore * 0.60 + elbowScore * 0.40);
    }
  }

  // ───────────── CONTACT POINT ─────────────
  // Goal: arm nearly extended (150-165°), contact in front of body.
  let ctScore = 50;
  {
    const m = lm(ctF); const isw = ISW(ctF);
    const wrist = m[hitWrist]; const elbow = m[hitElbow]; const shoulder = m[hitShoulder];
    const lh = m[hitHip]; const rh = m[offHip];
    if (wrist && elbow && shoulder && isw > 0.01) {
      // Arm extension at contact
      const ext = angle2D(shoulder, elbow, wrist);
      const extScore = closeness(ext, 157, 38);

      // Contact in front: wrist displaced toward net from body center.
      // Hip center is reliable reference for "where the body is".
      let frontScore = 50;
      if (lh && rh) {
        const hipCX = (lh.x + rh.x) / 2;
        const sCX = (m[11]!.x + m[12]!.x) / 2;
        const wristAhead = (hitShoulder === 12)
          ? (sCX - wrist.x) / isw
          : (wrist.x - sCX) / isw;
        frontScore = clamp(50 + wristAhead * 85);
      }
      ctScore = clamp(extScore * 0.60 + frontScore * 0.40);
    }
  }

  // ───────────── FOLLOW THROUGH ─────────────
  // Goal: high finish (wrist above nose), cross-body wrap (wrist past off-shoulder).
  let ftScore = 50;
  {
    const m = lm(ftF); const isw = ISW(ftF);
    const wrist = m[hitWrist]; const elbow = m[hitElbow]; const shoulder = m[hitShoulder];
    const offSho = m[offShoulder]; const nose = m[0];
    if (wrist && elbow && shoulder && isw > 0.01) {
      // High finish: wrist.y < nose.y (higher in image = smaller y)
      let highScore = 50;
      if (nose && isFinite(nose.y)) {
        const highness = (nose.y - wrist.y) / isw;
        highScore = clamp(50 + highness * 130);
      }
      // Cross-body wrap: wrist past off-shoulder
      let wrapScore = 50;
      if (offSho && isFinite(offSho.x)) {
        const wrapDist = (hitShoulder === 12)
          ? (offSho.x - wrist.x) / isw
          : (wrist.x - offSho.x) / isw;
        wrapScore = clamp(50 + wrapDist * 100);
      }
      // Elbow elevation: elbow above shoulder level
      let elbowElev = 50;
      if (isFinite(shoulder.y) && elbow && isFinite(elbow.y)) {
        elbowElev = clamp(50 + (shoulder.y - elbow.y) / isw * 130);
      }
      ftScore = clamp(highScore * 0.40 + wrapScore * 0.40 + elbowElev * 0.20);
    }
  }

  const overall = Math.round((utScore + rdScore + ctScore + ftScore) / 4);

  // Apply beginner-friendly floor scaling: maps raw [0,100] → [38,97].
  // A beginner doing recognizable phases (raw ~30-45) scores ~68-74%.
  // A decent player (raw ~55-65) scores ~78-82%. A near-pro (raw ~88) scores ~92%.
  // Floor at 55 ensures DTW drag can't kill a genuine effort.
  const rescale = (s: number) => clamp(55 + s * 0.42);

  return {
    unit_turn: Math.round(rescale(utScore)),
    racket_drop: Math.round(rescale(rdScore)),
    contact: Math.round(rescale(ctScore)),
    follow_through: Math.round(rescale(ftScore)),
    overall: Math.round(rescale(overall)),
  };
}

export function comparePerformances(refSequence: PoseResult[], userSequence: PoseResult[]) {
  const trimmedRef = trimStaticFrames(refSequence);
  const trimmedUser = trimStaticFrames(userSequence);

  const resampledRef = resampleSequence(trimmedRef, 50);
  const resampledUser = resampleSequence(trimmedUser, 50);

  const { alignedRef, alignedUser } = performDTW(resampledRef, resampledUser);

  const frameScores: number[] = [];
  let totalScore = 0;

  for (let i = 0; i < alignedRef.length; i++) {
    const score = calculateFrameSimilarity(alignedRef[i], alignedUser[i]);
    frameScores.push(score);
    totalScore += score;
  }

  return {
    overallScore: Math.round(totalScore / Math.max(alignedRef.length, 1)),
    frameScores: resampleArray(frameScores, 50),
  };
}

export function comparePerformancesByPhase(
  refSequence: PoseResult[],
  userSequence: PoseResult[],
  userPhaseTimestamps: { unitTurn: number; racketDrop: number; contact: number; followThrough: number } | null,
  refPhaseTimestamps: { unitTurn: number; racketDrop: number; contact: number; followThrough: number } | null
): { overallScore: number; frameScores: number[]; phaseScores: Record<string, number> } {
  // If we don't have both sets of timestamps, fall back to global comparison
  if (!userPhaseTimestamps || !refPhaseTimestamps) {
    const base = comparePerformances(refSequence, userSequence);
    return { ...base, phaseScores: {} };
  }

  const trimmedUser = trimStaticFrames(userSequence);
  const trimmedRef = trimStaticFrames(refSequence);
  if (trimmedUser.length < 8 || trimmedRef.length < 8) {
    const base = comparePerformances(refSequence, userSequence);
    return { ...base, phaseScores: {} };
  }

  // Resolve timestamp → index helper
  const tsToIdx = (seq: PoseResult[], ts: number) => {
    let best = 0;
    let bestD = Math.abs((seq[0]?.timestamp ?? 0) - ts);
    for (let i = 1; i < seq.length; i++) {
      const d = Math.abs((seq[i]?.timestamp ?? 0) - ts);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  // Phase windows in sequence space (user)
  const uUT = tsToIdx(trimmedUser, userPhaseTimestamps.unitTurn);
  const uRD = tsToIdx(trimmedUser, userPhaseTimestamps.racketDrop);
  const uCT = tsToIdx(trimmedUser, userPhaseTimestamps.contact);
  const uFT = tsToIdx(trimmedUser, userPhaseTimestamps.followThrough);

  // Phase windows in sequence space (ref)
  const rUT = tsToIdx(trimmedRef, refPhaseTimestamps.unitTurn);
  const rRD = tsToIdx(trimmedRef, refPhaseTimestamps.racketDrop);
  const rCT = tsToIdx(trimmedRef, refPhaseTimestamps.contact);
  const rFT = tsToIdx(trimmedRef, refPhaseTimestamps.followThrough);

  // Define windows: [start, end] inclusive for each phase
  const uStart = 0;
  const rStart = 0;

  const phaseWindowsUser: [number, number][] = [
    [uStart, uUT],
    [uUT, uRD],
    [uRD, uCT],
    [uCT, Math.min(trimmedUser.length - 1, uFT + Math.round((trimmedUser.length - uFT) * 0.5))],
  ];
  const phaseWindowsRef: [number, number][] = [
    [rStart, rUT],
    [rUT, rRD],
    [rRD, rCT],
    [rCT, Math.min(trimmedRef.length - 1, rFT + Math.round((trimmedRef.length - rFT) * 0.5))],
  ];

  const PHASE_KEYS = ['unit_turn', 'racket_drop', 'contact', 'follow_through'];
  // Target frame counts per phase (proportional weighting, sum = 50)
  const PHASE_FRAMES = [13, 13, 12, 12];

  const allFrameScores: number[] = [];
  const phaseScores: Record<string, number> = {};

  for (let p = 0; p < 4; p++) {
    const [us, ue] = phaseWindowsUser[p];
    const [rs, re] = phaseWindowsRef[p];

    // Slice the window (ensure at least 2 frames each side)
    const uWin = trimmedUser.slice(us, Math.max(us + 2, ue + 1));
    const rWin = trimmedRef.slice(rs, Math.max(rs + 2, re + 1));

    const targetFrames = PHASE_FRAMES[p];

    // Resample each window to targetFrames, then DTW with tight ±8 band
    const uRes = resampleSequence(uWin, Math.min(targetFrames, uWin.length));
    const rRes = resampleSequence(rWin, Math.min(targetFrames, rWin.length));

    const n = uRes.length;
    const m = rRes.length;
    const dtwBand = 8;
    const dtwMat = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    dtwMat[0][0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(1, i - dtwBand); j <= Math.min(m, i + dtwBand); j++) {
        const c = 100 - calculateFrameSimilarity(uRes[i - 1], rRes[j - 1]);
        dtwMat[i][j] = c + Math.min(dtwMat[i - 1][j], dtwMat[i][j - 1], dtwMat[i - 1][j - 1]);
      }
    }

    // Traceback
    const windowScores: number[] = [];
    let i = n; let j = m;
    while (i > 0 && j > 0) {
      windowScores.unshift(calculateFrameSimilarity(uRes[i - 1], rRes[j - 1]));
      const up = dtwMat[i - 1][j], left = dtwMat[i][j - 1], diag = dtwMat[i - 1][j - 1];
      const minVal = Math.min(up, left, diag);
      if (minVal === diag) { i--; j--; }
      else if (minVal === up) { i--; }
      else { j--; }
    }

    const phaseAvg = windowScores.length > 0
      ? Math.round(windowScores.reduce((a, b) => a + b, 0) / windowScores.length)
      : 0;

    phaseScores[PHASE_KEYS[p]] = phaseAvg;

    // Stitch into 50-frame array (proportional)
    const stitched = resampleArray(windowScores, targetFrames);
    allFrameScores.push(...stitched);
  }

  // Pad/trim to exactly 50 frames
  const frameScores50 = resampleArray(allFrameScores, 50);

  const phaseVals = Object.values(phaseScores).filter(v => isFinite(v));
  const overallScore = phaseVals.length > 0
    ? Math.round(phaseVals.reduce((a, b) => a + b, 0) / phaseVals.length)
    : Math.round(frameScores50.reduce((a, b) => a + b, 0) / Math.max(frameScores50.length, 1));

  return { overallScore, frameScores: frameScores50, phaseScores };
}
