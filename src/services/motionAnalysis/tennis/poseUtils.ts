/**
 * Tennis Pose Utilities
 *
 * Pure functions that operate on pose landmark data.
 * No class state — safe to import from any module without circular dependencies.
 *
 * Adding a new tennis skill?  You probably only need to import from here.
 */

import type { PoseResult } from '../../motionAnalysis/BaseMotionAnalysis';

export type { PoseResult };

// ─── Angle Calculations ────────────────────────────────────────────────────────

/** 3-D angle at vertex `b` (degrees). Returns 0 if any point is missing. */
export function calculateAngle3D(a: any, b: any, c: any): number {
    if (!a || !b || !c) return 0;
    const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2 + v1.z ** 2);
    const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);
    if (mag1 * mag2 === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI);
}

/** 2-D angle at vertex `b` (degrees). */
export function calculateAngle(a: any, b: any, c: any): number {
    if (!a || !b || !c) return 0;
    const v1x = a.x - b.x; const v1y = a.y - b.y;
    const v2x = c.x - b.x; const v2y = c.y - b.y;
    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.hypot(v1x, v1y);
    const mag2 = Math.hypot(v2x, v2y);
    if (mag1 * mag2 === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI);
}

// ─── Landmark Motion Helpers ───────────────────────────────────────────────────

/** Average L2 movement over a small stable set of joints between two frames. */
export function estimateLandmarkMovement(prev: any[], cur: any[]): number {
    const idxs = [11, 12, 13, 14, 15, 16, 23, 24];
    let sum = 0; let n = 0;
    for (const i of idxs) {
        const a = prev[i]; const b = cur[i];
        if (!a || !b) continue;
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        sum += Math.sqrt(dx * dx + dy * dy);
        n++;
    }
    return n ? sum / n : 0;
}

/** EMA smoothing over landmark arrays. alpha=1 → no smoothing. */
export function smoothLandmarks(prev: any[], cur: any[], alpha: number): any[] {
    const out: any[] = [];
    const a = Math.max(0, Math.min(1, alpha));
    for (let i = 0; i < cur.length; i++) {
        const p = prev[i]; const c = cur[i];
        if (!c || !p) { out[i] = c; continue; }
        out[i] = {
            ...c,
            x: (p.x ?? 0) * (1 - a) + (c.x ?? 0) * a,
            y: (p.y ?? 0) * (1 - a) + (c.y ?? 0) * a,
            z: (p.z ?? 0) * (1 - a) + (c.z ?? 0) * a,
            visibility: Math.max(p.visibility ?? 0, c.visibility ?? 0),
        };
    }
    return out;
}

// ─── Frame Lookup ─────────────────────────────────────────────────────────────

/** Closest frame that has a captured `frameData` thumbnail. */
export function findClosestFrameWithData(sequence: PoseResult[], targetTimestamp: number): PoseResult | null {
    let closest: PoseResult | null = null;
    let closestDiff = Infinity;
    for (const frame of sequence) {
        if (frame.frameData) {
            const diff = Math.abs(frame.timestamp - targetTimestamp);
            if (diff < closestDiff) { closestDiff = diff; closest = frame; }
        }
    }
    return closest;
}

/** Closest frame by timestamp (no frameData requirement). */
export function findClosestFrame(sequence: PoseResult[], targetTimestamp: number): PoseResult | null {
    if (!sequence?.length) return null;
    let best = sequence[0];
    let bestDist = Math.abs((best.timestamp ?? 0) - targetTimestamp);
    for (let i = 1; i < sequence.length; i++) {
        const d = Math.abs((sequence[i].timestamp ?? 0) - targetTimestamp);
        if (d < bestDist) { best = sequence[i]; bestDist = d; }
    }
    return best;
}

// ─── Velocity / Kinematics ────────────────────────────────────────────────────

/** Per-frame 3-D velocity of a single landmark (units/sec). Output length = sequence length. */
export function calculateLandmarkVelocity3D(sequence: PoseResult[], landmarkIdx: number): number[] {
    const velocities: number[] = [0];
    for (let i = 1; i < sequence.length; i++) {
        const prev = sequence[i - 1].worldLandmarks?.[landmarkIdx] || sequence[i - 1].landmarks[landmarkIdx];
        const curr = sequence[i].worldLandmarks?.[landmarkIdx] || sequence[i].landmarks[landmarkIdx];
        const dt = sequence[i].timestamp - sequence[i - 1].timestamp;
        if (prev && curr && dt > 0.001) {
            const dx = curr.x - prev.x; const dy = curr.y - prev.y;
            const dz = (curr.z || 0) - (prev.z || 0);
            velocities.push(Math.sqrt(dx * dx + dy * dy + dz * dz) / dt);
        } else {
            velocities.push(velocities[velocities.length - 1] || 0);
        }
    }
    return velocities;
}

/** Right wrist (idx 16) velocity specifically — convenience wrapper. */
export function calculateWristVelocities3D(sequence: PoseResult[]): number[] {
    const velocities: number[] = [0];
    for (let i = 1; i < sequence.length; i++) {
        const prev = sequence[i - 1].worldLandmarks?.[16] || sequence[i - 1].landmarks[16];
        const curr = sequence[i].worldLandmarks?.[16] || sequence[i].landmarks[16];
        const dt = sequence[i].timestamp - sequence[i - 1].timestamp;
        if (prev && curr && dt > 0.001) {
            const dx = curr.x - prev.x; const dy = curr.y - prev.y;
            const dz = (curr.z || 0) - (prev.z || 0);
            velocities.push(Math.sqrt(dx * dx + dy * dy + dz * dz) / dt);
        } else {
            velocities.push(velocities[velocities.length - 1] || 0);
        }
    }
    return velocities;
}

/** Finite-difference acceleration from a velocity array. */
export function calculateAcceleration(velocities: number[], sequence: PoseResult[]): number[] {
    const accel: number[] = [0];
    for (let i = 1; i < velocities.length; i++) {
        const dt = sequence[i].timestamp - sequence[i - 1].timestamp;
        accel.push(dt > 0.001 ? (velocities[i] - velocities[i - 1]) / dt : 0);
    }
    return accel;
}

/** Shoulder-hip separation angle (trunk rotation indicator), per frame. */
export function calculateTrunkRotation(sequence: PoseResult[]): number[] {
    const rotations: number[] = [];
    for (const frame of sequence) {
        const wl = frame.worldLandmarks || frame.landmarks;
        if (wl[11] && wl[12] && wl[23] && wl[24]) {
            const sVec = { x: wl[12].x - wl[11].x, z: (wl[12].z || 0) - (wl[11].z || 0) };
            const hVec = { x: wl[24].x - wl[23].x, z: (wl[24].z || 0) - (wl[23].z || 0) };
            const dot = sVec.x * hVec.x + sVec.z * hVec.z;
            const mag1 = Math.sqrt(sVec.x ** 2 + sVec.z ** 2);
            const mag2 = Math.sqrt(hVec.x ** 2 + hVec.z ** 2);
            if (mag1 > 0 && mag2 > 0) {
                rotations.push(Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI));
            } else {
                rotations.push(rotations[rotations.length - 1] ?? 0);
            }
        } else {
            rotations.push(rotations[rotations.length - 1] ?? 0);
        }
    }
    return rotations;
}

/** Shoulder-elbow-wrist extension angle series. */
export function calculateArmExtension(sequence: PoseResult[], isRightArm = true): number[] {
    const shoulderIdx = isRightArm ? 12 : 11;
    const elbowIdx = isRightArm ? 14 : 13;
    const wristIdx = isRightArm ? 16 : 15;
    const out: number[] = [];
    for (const frame of sequence) {
        const wl = frame.worldLandmarks || frame.landmarks;
        if (wl[shoulderIdx] && wl[elbowIdx] && wl[wristIdx]) {
            out.push(calculateAngle3D(wl[shoulderIdx], wl[elbowIdx], wl[wristIdx]));
        } else {
            out.push(out.length > 0 ? out[out.length - 1] : 90);
        }
    }
    return out;
}

/** Hip-knee-ankle bend angle series. */
export function calculateKneeBend(sequence: PoseResult[], isRightLeg = true): number[] {
    const hipIdx = isRightLeg ? 24 : 23;
    const kneeIdx = isRightLeg ? 26 : 25;
    const ankleIdx = isRightLeg ? 28 : 27;
    const out: number[] = [];
    for (const frame of sequence) {
        const wl = frame.worldLandmarks || frame.landmarks;
        if (wl[hipIdx] && wl[kneeIdx] && wl[ankleIdx]) {
            out.push(calculateAngle3D(wl[hipIdx], wl[kneeIdx], wl[ankleIdx]));
        } else {
            out.push(out.length > 0 ? out[out.length - 1] : 170);
        }
    }
    return out;
}

/**
 * Wrist position relative to hip center along the "forward" axis.
 * Positive = wrist in front of hips.
 * Uses worldLandmarks Z when available, falls back to 2D PCA projection.
 */
export function calculateWristForwardPosition(sequence: PoseResult[], isRightArm = true): number[] {
    const wristIdx = isRightArm ? 16 : 15;
    if (sequence.length === 0) return [];

    const worldAvailableCount = sequence.reduce((acc, f) => {
        const wl = f.worldLandmarks;
        return (wl && wl[wristIdx] && wl[23] && wl[24]) ? acc + 1 : acc;
    }, 0);

    if (worldAvailableCount / Math.max(1, sequence.length) >= 0.6) {
        const positions: number[] = [];
        for (const frame of sequence) {
            const wl = frame.worldLandmarks;
            if (wl && wl[wristIdx] && wl[23] && wl[24]) {
                const hipCenterZ = ((wl[23].z || 0) + (wl[24].z || 0)) / 2;
                const wristZ = wl[wristIdx].z || 0;
                positions.push(hipCenterZ - wristZ);
            } else {
                positions.push(positions.length > 0 ? positions[positions.length - 1] : 0);
            }
        }
        return positions;
    }

    // Fallback: 2-D PCA projection of wrist relative to hips
    const rel: Array<{ x: number; y: number }> = [];
    for (const frame of sequence) {
        const lm = frame.landmarks;
        if (lm?.[wristIdx] && lm?.[23] && lm?.[24]) {
            const hipX = (lm[23].x + lm[24].x) / 2;
            const hipY = (lm[23].y + lm[24].y) / 2;
            rel.push({ x: lm[wristIdx].x - hipX, y: lm[wristIdx].y - hipY });
        } else {
            rel.push(rel.length > 0 ? rel[rel.length - 1] : { x: 0, y: 0 });
        }
    }

    let meanX = 0; let meanY = 0;
    for (const p of rel) { meanX += p.x; meanY += p.y; }
    meanX /= rel.length; meanY /= rel.length;

    let varX = 0; let varY = 0; let covXY = 0;
    for (const p of rel) {
        const dx = p.x - meanX; const dy = p.y - meanY;
        varX += dx * dx; varY += dy * dy; covXY += dx * dy;
    }
    varX /= rel.length; varY /= rel.length; covXY /= rel.length;

    let vx = 1; let vy = 0;
    const eps = 1e-8;
    if (Math.abs(covXY) > eps) {
        const trace = varX + varY;
        const det = varX * varY - covXY * covXY;
        const disc = Math.max(0, trace * trace - 4 * det);
        const lambda1 = (trace + Math.sqrt(disc)) / 2;
        vx = covXY; vy = lambda1 - varX;
        const norm = Math.sqrt(vx * vx + vy * vy) || 1;
        vx /= norm; vy /= norm;
    } else if (varY > varX) {
        vx = 0; vy = 1;
    }

    const proj = rel.map(p => (p.x - meanX) * vx + (p.y - meanY) * vy);

    let peakIdx = Math.floor(proj.length / 2); let peakSpeed = -Infinity;
    for (let i = 1; i < rel.length; i++) {
        const dt = Math.max(1e-3, sequence[i].timestamp - sequence[i - 1].timestamp);
        const dx = rel[i].x - rel[i - 1].x; const dy = rel[i].y - rel[i - 1].y;
        const speed = Math.sqrt(dx * dx + dy * dy) / dt;
        if (speed > peakSpeed) { peakSpeed = speed; peakIdx = i; }
    }

    const earlyIdx = Math.min(3, proj.length - 1);
    if (proj[peakIdx] < proj[earlyIdx]) {
        for (let i = 0; i < proj.length; i++) proj[i] = -proj[i];
    }
    return proj;
}

// ─── Ensemble Phase Voting ────────────────────────────────────────────────────

/** Weighted majority vote across multiple phase-detection candidates. */
export function ensembleVote(candidates: { idx: number; confidence: number; method: string }[]): number {
    if (candidates.length === 0) return 0;
    const valid = candidates.filter(c => c.idx >= 0 && isFinite(c.confidence));
    if (valid.length === 0) return candidates[0].idx;

    const totalConf = valid.reduce((s, c) => s + c.confidence, 0);
    const weightedAvg = totalConf > 0
        ? Math.round(valid.reduce((s, c) => s + c.idx * c.confidence, 0) / totalConf)
        : valid[0].idx;

    const sorted = [...valid].sort((a, b) => a.idx - b.idx);
    const range = sorted[sorted.length - 1].idx - sorted[0].idx;
    if (range <= 5) return weightedAvg;

    const best = valid.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return best.idx;
}

/** Expert 1: velocity-based phase detection (peak / minimum / sign-change). */
export function detectByVelocity(
    velocities: number[],
    accelerations: number[],
    startIdx: number,
    endIdx: number,
    mode: 'peak' | 'minimum' | 'accel_sign_change'
): { idx: number; confidence: number } {
    const len = velocities.length;
    const start = Math.max(0, startIdx);
    const end = Math.min(len, endIdx);

    if (mode === 'peak') {
        let maxVel = -Infinity; let maxIdx = Math.floor((start + end) / 2);
        for (let i = start; i < end; i++) {
            if (velocities[i] > maxVel) { maxVel = velocities[i]; maxIdx = i; }
        }
        const avgVel = velocities.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
        const peakRatio = avgVel > 0 ? maxVel / avgVel : 1;
        return { idx: maxIdx, confidence: Math.min(1, peakRatio / 2) };
    }

    if (mode === 'minimum') {
        let minVel = Infinity; let minIdx = Math.floor((start + end) / 2);
        for (let i = start; i < end; i++) {
            if (velocities[i] < minVel) { minVel = velocities[i]; minIdx = i; }
        }
        const avgVel = velocities.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
        const minRatio = avgVel > 0 ? (avgVel - minVel) / avgVel : 0.5;
        return { idx: minIdx, confidence: Math.min(1, minRatio) };
    }

    if (mode === 'accel_sign_change') {
        for (let i = start + 1; i < end - 1; i++) {
            if (accelerations[i - 1] > 0 && accelerations[i + 1] < 0) {
                return { idx: i, confidence: 0.9 };
            }
        }
        return detectByVelocity(velocities, accelerations, start, end, 'peak');
    }

    return { idx: Math.floor((start + end) / 2), confidence: 0.3 };
}

/** Expert 2: geometric position-based phase detection. */
export function detectByPosition(
    sequence: PoseResult[],
    startIdx: number,
    endIdx: number,
    criterion:
        | 'max_shoulder_rotation'
        | 'lowest_wrist'
        | 'lowest_racket_head'
        | 'highest_wrist'
        | 'max_arm_extension'
        | 'wrist_crossed_left'
        | 'wrist_crossed_right'
        | 'deepest_knee_bend'
): { idx: number; confidence: number } {
    const start = Math.max(0, startIdx);
    const end = Math.min(sequence.length, endIdx);
    let bestIdx = Math.floor((start + end) / 2);
    let bestVal = -Infinity;

    for (let i = start; i < end; i++) {
        const wl = sequence[i].worldLandmarks || sequence[i].landmarks;
        let value = 0;
        switch (criterion) {
            case 'max_shoulder_rotation':
                if (wl[11] && wl[12] && wl[23] && wl[24]) {
                    const sv = { x: wl[12].x - wl[11].x, z: (wl[12].z || 0) - (wl[11].z || 0) };
                    const hv = { x: wl[24].x - wl[23].x, z: (wl[24].z || 0) - (wl[23].z || 0) };
                    const dot = sv.x * hv.x + sv.z * hv.z;
                    const m1 = Math.sqrt(sv.x ** 2 + sv.z ** 2);
                    const m2 = Math.sqrt(hv.x ** 2 + hv.z ** 2);
                    if (m1 > 0.001 && m2 > 0.001) value = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2))));
                }
                break;
            case 'lowest_wrist':
                if (wl[16]) value = wl[16].y;
                break;
            case 'lowest_racket_head': {
                const racket = (sequence[i] as any)?.racket;
                if (racket && racket.confidence >= 0.25 && Number.isFinite(racket.y1)) {
                    value = racket.y1;
                } else if (wl[16] && wl[14]) {
                    const wrist = wl[16]; const elbow = wl[14];
                    if (Number.isFinite(wrist.y) && Number.isFinite(elbow.y)) {
                        const tipY = wrist.y + (wrist.y - elbow.y) * 1.35;
                        value = Number.isFinite(tipY) ? tipY : wrist.y;
                    }
                }
                break;
            }
            case 'highest_wrist':
                if (wl[16]) value = -wl[16].y;
                break;
            case 'max_arm_extension':
                if (wl[12] && wl[14] && wl[16]) value = calculateAngle3D(wl[12], wl[14], wl[16]);
                break;
            case 'wrist_crossed_left':
                if (wl[16] && wl[11]) value = wl[11].x - wl[16].x;
                break;
            case 'wrist_crossed_right':
                if (wl[16] && wl[12]) value = wl[16].x - wl[12].x;
                break;
            case 'deepest_knee_bend':
                if (wl[24] && wl[26] && wl[28]) value = 180 - calculateAngle3D(wl[24], wl[26], wl[28]);
                break;
        }
        if (value > bestVal) { bestVal = value; bestIdx = i; }
    }
    return { idx: bestIdx, confidence: 0.7 };
}

/** Expert 3: multi-signal biomechanical scoring. */
export function detectByBiomechanicalScore(
    sequence: PoseResult[],
    normVelocity: number[],
    normTrunk: number[],
    normExtension: number[],
    normKnee: number[],
    normForward: number[],
    wristAccel: number[],
    startIdx: number,
    endIdx: number,
    phaseType: 'unit_turn' | 'racket_drop' | 'contact' | 'follow_through'
): { idx: number; confidence: number } {
    const start = Math.max(0, startIdx);
    const end = Math.min(sequence.length, endIdx);
    const len = sequence.length;
    let bestScore = -Infinity;
    let bestIdx = Math.floor((start + end) / 2);

    for (let i = start; i < end; i++) {
        const wl = sequence[i].worldLandmarks || sequence[i].landmarks;
        let score = 0;
        switch (phaseType) {
            case 'unit_turn':
                score = normTrunk[i] * 3.0 + (1 - normForward[i]) * 2.5 + (1 - normVelocity[i]) * 1.5 + (1 - i / len) * 1.5;
                break;
            case 'racket_drop': {
                const wristBelowElbow = wl[16] && wl[14] ? (wl[16].y > wl[14].y ? 1 : 0) : 0;
                score = (1 - normVelocity[i]) * 2.5 + (1 - normKnee[i]) * 2.0 + wristBelowElbow * 2.0 + (1 - normExtension[i]) * 1.5;
                break;
            }
            case 'contact': {
                const accelSign = (i > 0 && i < len - 1 && wristAccel[i - 1] > 0 && wristAccel[i + 1] < 0) ? 1 : 0;
                score = normVelocity[i] * 4.0 + normExtension[i] * 3.0 + normForward[i] * 2.5 + accelSign * 3.5;
                break;
            }
            case 'follow_through': {
                const wristCrossed = wl[16] && wl[11] ? (wl[16].x < wl[11].x ? 1 : 0) : 0;
                score = (1 - normVelocity[i]) * 2.0 + normExtension[i] * 1.5 + wristCrossed * 3.0 + (i / len) * 1.0;
                break;
            }
        }
        if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return { idx: bestIdx, confidence: Math.min(1, bestScore / 10) };
}

// ─── Array Signal Processing ───────────────────────────────────────────────────

/** Moving-average smoothing. windowSize = 1 → no change. */
export function smoothArray(arr: number[], windowSize = 5): number[] {
    const result: number[] = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < arr.length; i++) {
        let sum = 0; let count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
            sum += arr[j]; count++;
        }
        result.push(sum / count);
    }
    return result;
}

/** Index of local minimum in `velocities[start..end)`. */
export function findVelocityMinimum(velocities: number[], start: number, end: number): number {
    let minVel = Infinity; let minIdx = Math.floor((start + end) / 2);
    for (let i = start; i < end && i < velocities.length; i++) {
        if (velocities[i] < minVel) { minVel = velocities[i]; minIdx = i; }
    }
    return minIdx;
}

/** Index of local maximum in `velocities[start..end)`. */
export function findVelocityPeak(velocities: number[], start: number, end: number): number {
    let maxVel = -Infinity; let maxIdx = Math.floor((start + end) / 2);
    for (let i = start; i < end && i < velocities.length; i++) {
        if (velocities[i] > maxVel) { maxVel = velocities[i]; maxIdx = i; }
    }
    return maxIdx;
}

// ─── Statistical Helpers ───────────────────────────────────────────────────────

export function safeMean(values: number[]): number {
    if (!values?.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

export function safeStd(values: number[]): number {
    if (!values || values.length < 2) return 0;
    const m = safeMean(values);
    const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(v);
}

export function peakOf(values: number[]): { value: number; index: number } {
    if (!values?.length) return { value: 0, index: 0 };
    let bestV = values[0]; let bestI = 0;
    for (let i = 1; i < values.length; i++) {
        if (values[i] > bestV) { bestV = values[i]; bestI = i; }
    }
    return { value: bestV, index: bestI };
}

/** Angular velocity (deg/sec) from an angle series + timestamp series. */
export function computeAngularVelocityDegPerSec(angleDeg: number[], timestamps: number[]): number[] {
    const out: number[] = [0];
    for (let i = 1; i < angleDeg.length; i++) {
        const dt = Math.max(0.001, (timestamps[i] ?? timestamps[i - 1] ?? 0) - (timestamps[i - 1] ?? 0));
        out.push(Math.abs(angleDeg[i] - angleDeg[i - 1]) / dt);
    }
    return smoothArray(out, 5);
}

/** Hip-knee-ankle angle for a single frame (degrees), or null if landmarks missing. */
export function kneeAngleDeg(frame: PoseResult, side: 'left' | 'right'): number | null {
    const lm = frame.landmarks;
    if (!lm) return null;
    const hip = side === 'left' ? lm[23] : lm[24];
    const knee = side === 'left' ? lm[25] : lm[26];
    const ankle = side === 'left' ? lm[27] : lm[28];
    if (!hip || !knee || !ankle) return null;
    return calculateAngle(hip, knee, ankle);
}

/** Nose position relative to hip midpoint (normalized coords). */
export function headRelativeSway(frame: PoseResult): { x: number; y: number } | null {
    const lm = frame.landmarks;
    if (!lm) return null;
    const nose = lm[0]; const lHip = lm[23]; const rHip = lm[24];
    if (!nose || !lHip || !rHip) return null;
    return { x: nose.x - (lHip.x + rHip.x) / 2, y: nose.y - (lHip.y + rHip.y) / 2 };
}

// ─── Landmark Normalization ───────────────────────────────────────────────────

/**
 * Normalizes landmarks to a body-centered, body-scale invariant system.
 * Centre = hip midpoint; scale = shoulder-hip distance.
 */
export function normalizeLandmarks(landmarks: any[], mirrorX = false): { x: number; y: number; z: number }[] {
    if (!landmarks || landmarks.length < 25) return [];
    const getX = (lm: any) => (mirrorX ? 1 - lm.x : lm.x);

    const hipMidX = (getX(landmarks[23]) + getX(landmarks[24])) / 2;
    const hipMidY = (landmarks[23].y + landmarks[24].y) / 2;
    const hipMidZ = ((landmarks[23].z || 0) + (landmarks[24].z || 0)) / 2;

    const shoulderMidY = (landmarks[11].y + landmarks[12].y) / 2;
    const bodyScale = Math.abs(hipMidY - shoulderMidY);
    if (bodyScale < 0.01) return [];

    return landmarks.map(lm => ({
        x: (getX(lm) - hipMidX) / bodyScale,
        y: (lm.y - hipMidY) / bodyScale,
        z: ((lm.z || 0) - hipMidZ) / bodyScale,
    }));
}

// ─── Frame Similarity ─────────────────────────────────────────────────────────

/**
 * Pose similarity score 0-100.
 * Weighted by joint importance; invariant to player position and camera distance.
 */
export function calculateFrameSimilarity(frame1: PoseResult, frame2: PoseResult): number {
    const kp1 = frame1.landmarks;
    const kp2 = frame2.landmarks;
    const len = Math.min(kp1.length, kp2.length, 33);
    if (len === 0) return 0;

    const LANDMARK_WEIGHTS: number[] = [
        0.15, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.15,
        0.15, 0.10, 0.10, 3.00, 3.00, 3.00, 3.00, 3.50,
        3.50, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 2.50,
        2.50, 1.50, 1.50, 0.80, 0.80, 0.50, 0.50, 0.40, 0.40,
    ];

    const hipCenter = (kp: { x: number; y: number }[]) => {
        const lh = kp[23]; const rh = kp[24];
        if (lh && rh) return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
        const ls = kp[11]; const rs = kp[12];
        if (ls && rs) return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        return { x: 0, y: 0 };
    };
    const c1 = hipCenter(kp1);
    const c2 = hipCenter(kp2);

    const interShoulder = (kp: { x: number; y: number }[]) => {
        const ls = kp[11]; const rs = kp[12];
        if (!ls || !rs) return 0.15;
        return Math.hypot(rs.x - ls.x, rs.y - ls.y);
    };
    const normScale = Math.max(0.05, (interShoulder(kp1) + interShoulder(kp2)) / 2);

    let weightedScore = 0; let totalWeight = 0;
    for (let i = 0; i < len; i++) {
        const w = i < LANDMARK_WEIGHTS.length ? LANDMARK_WEIGHTS[i] : 1.0;
        const dx = (kp1[i].x - c1.x) - (kp2[i].x - c2.x);
        const dy = (kp1[i].y - c1.y) - (kp2[i].y - c2.y);
        const normDist = Math.hypot(dx, dy) / normScale;
        weightedScore += w * 100 * Math.exp(-(normDist * normDist) * 2.5);
        totalWeight += w;
    }
    return totalWeight > 0 ? weightedScore / totalWeight : 0;
}

// ─── Sequence Resampling ──────────────────────────────────────────────────────

export function resampleSequence(seq: PoseResult[], targetLen: number): PoseResult[] {
    if (seq.length === 0) return [];
    if (seq.length <= targetLen) return seq;
    const step = seq.length / targetLen;
    return Array.from({ length: targetLen }, (_, i) =>
        seq[Math.min(Math.floor(i * step), seq.length - 1)]
    );
}

export function resampleArray(arr: number[], targetLen: number): number[] {
    if (arr.length === 0) return Array(targetLen).fill(0);
    if (arr.length === targetLen) return arr;
    const step = arr.length / targetLen;
    return Array.from({ length: targetLen }, (_, i) =>
        arr[Math.min(Math.floor(i * step), arr.length - 1)]
    );
}

// ─── Active Segment Detection ─────────────────────────────────────────────────

/**
 * Trims static/idle frames from start and end of a pose sequence.
 * Returns the "active" segment that contains the peak motion energy.
 *
 * Used by every stroke analyser to remove setup, walking, or post-stroke idle.
 */
export function trimStaticFrames(sequence: PoseResult[]): PoseResult[] {
    if (sequence.length < 10) return sequence;

    // ── Timestamp sanitisation ──────────────────────────────────────────────
    // Sort by timestamp ascending, then drop any frame whose timestamp is not
    // strictly greater than the previous frame's timestamp.  Non-monotonic
    // timestamps corrupt every velocity signal downstream.
    const sorted = [...sequence].sort((a, b) => a.timestamp - b.timestamp);
    const monotonic: PoseResult[] = [sorted[0]];
    for (let k = 1; k < sorted.length; k++) {
        if (sorted[k].timestamp > monotonic[monotonic.length - 1].timestamp) {
            monotonic.push(sorted[k]);
        }
    }
    if (monotonic.length < 10) return monotonic;
    // ────────────────────────────────────────────────────────────────────────
    const seq = monotonic;
    const len = seq.length;
    const durationSec = Math.max(0.001, seq[len - 1].timestamp - seq[0].timestamp);
    const fpsApprox = (len - 1) / durationSec;
    const fps = isFinite(fpsApprox) && fpsApprox > 1 ? fpsApprox : 30;

    const percentile = (arr: number[], p: number) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].filter(v => isFinite(v)).sort((a, b) => a - b);
        if (sorted.length === 0) return 0;
        const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1))));
        return sorted[idx];
    };

    const rW = smoothArray(calculateLandmarkVelocity3D(seq, 16), 5);
    const lW = smoothArray(calculateLandmarkVelocity3D(seq, 15), 5);
    const lHip = smoothArray(calculateLandmarkVelocity3D(seq, 23), 5);
    const rHip = smoothArray(calculateLandmarkVelocity3D(seq, 24), 5);
    const lAnkle = smoothArray(calculateLandmarkVelocity3D(seq, 27), 5);
    const rAnkle = smoothArray(calculateLandmarkVelocity3D(seq, 28), 5);

    const energy: number[] = new Array(len).fill(0);
    for (let i = 0; i < len; i++) {
        const wrist = Math.max(rW[i] || 0, lW[i] || 0);
        const hip = ((lHip[i] || 0) + (rHip[i] || 0)) / 2;
        const ankle = Math.max(lAnkle[i] || 0, rAnkle[i] || 0);
        const splitStepPenalty = ankle > wrist * 1.2 ? ankle * 0.35 : 0;
        energy[i] = wrist * 0.90 + hip * 0.10 - splitStepPenalty;
    }

    const safeStart = Math.floor(len * 0.08);
    const safeEnd = Math.max(safeStart + 1, Math.floor(len * 0.92));
    let peakIdx = Math.floor(len / 2); let peakVal = -Infinity;
    for (let i = safeStart; i < safeEnd; i++) {
        if (energy[i] > peakVal) { peakVal = energy[i]; peakIdx = i; }
    }

    const p50 = percentile(energy, 50);
    const p85 = percentile(energy, 85);
    const p95 = percentile(energy, 95);
    const hi = Math.max(p50 + (p95 - p50) * 0.25, p85 * 0.35);
    const low = hi * 0.55;
    if (!(hi > 0.0005) || !isFinite(hi)) return seq;

    const isActive = (i: number) => (energy[i] || 0) >= low;
    const gapFrames = Math.max(3, Math.round(fps * 0.70));

    type Segment = { start: number; end: number; containsPeak: boolean; activeCount: number };
    const segments: Segment[] = [];

    let i = 0;
    while (i < len) {
        while (i < len && !isActive(i)) i++;
        if (i >= len) break;
        const segStart = i;
        let lastActive = i; let inactiveRun = 0; let activeCount = 0;
        while (i < len) {
            if (isActive(i)) { lastActive = i; inactiveRun = 0; activeCount++; }
            else { inactiveRun++; if (inactiveRun > gapFrames) break; }
            i++;
        }
        const segEnd = lastActive;
        if (segEnd > segStart) {
            segments.push({ start: segStart, end: segEnd, containsPeak: peakIdx >= segStart && peakIdx <= segEnd, activeCount });
        }
    }

    if (segments.length === 0) return seq;

    const MIN_SPLIT_STEP_GAP_SEC = 0.5;
    let chosen: Segment | undefined;
    if (segments.length >= 2) {
        const firstTs = seq[segments[0].start]?.timestamp ?? 0;
        const lastTs = seq[segments[segments.length - 1].start]?.timestamp ?? 0;
        if (lastTs - firstTs >= MIN_SPLIT_STEP_GAP_SEC) {
            const peakSegs = segments.filter(s => s.containsPeak);
            chosen = peakSegs.length > 0 ? peakSegs[peakSegs.length - 1] : segments[segments.length - 1];
        }
    }
    if (!chosen) chosen = segments.find(s => s.containsPeak);
    if (!chosen) chosen = segments.slice().sort((a, b) => (b.activeCount - a.activeCount) || ((b.end - b.start) - (a.end - a.start)))[0];

    // Asymmetric padding: the unit-turn (body-coil) phase precedes the active
    // energy peak but is low-energy, so it needs more pre-buffer than post-buffer.
    const prePad = Math.max(3, Math.round(fps * 0.45));
    const postPad = Math.max(2, Math.round(fps * 0.25));
    let start = Math.max(0, chosen.start - prePad);
    let end = Math.min(len - 1, chosen.end + postPad);
    const minFrames = Math.max(12, Math.round(fps * 0.7));
    if ((end - start + 1) < minFrames) {
        const widen = Math.round(fps * 0.8);
        start = Math.max(0, Math.min(start, peakIdx - widen));
        end = Math.min(len - 1, Math.max(end, peakIdx + Math.round(fps * 0.4)));
    }
    if ((end - start + 1) < 10) return seq;
    return seq.slice(start, end + 1);
}

// ─── Handedness Detection ─────────────────────────────────────────────────────

/** Returns true when the right wrist moves more on average (right-handed player). */
export function detectDominantArmIsRight(sequence: PoseResult[]): boolean {
    const seq = trimStaticFrames(sequence);
    if (seq.length < 3) return true;

    let rightEnergy = 0; let leftEnergy = 0;
    for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1]; const cur = seq[i];
        const dt = Math.max(0.001, cur.timestamp - prev.timestamp);
        const prevLm = prev.landmarks; const curLm = cur.landmarks;
        if (!prevLm || !curLm) continue;
        const prevR = prevLm[16]; const curR = curLm[16];
        const prevL = prevLm[15]; const curL = curLm[15];
        if (prevR && curR) rightEnergy += Math.hypot(curR.x - prevR.x, curR.y - prevR.y) / dt;
        if (prevL && curL) leftEnergy += Math.hypot(curL.x - prevL.x, curL.y - prevL.y) / dt;
    }
    if (rightEnergy < 1e-6 && leftEnergy < 1e-6) return true;
    return rightEnergy >= leftEnergy;
}

// ─── Kinematic Feature Extraction ────────────────────────────────────────────

/**
 * Computes rotation-invariant kinematic features from a pose sequence.
 * Used by DTW-based phase transfer and subtle movement analysis.
 */
export function extractKinematicFeatures(
    sequence: PoseResult[],
    isRightHanded: boolean
): { elbowAngle: number[]; trunkAngle: number[]; armAngularVelocity: number[] } {
    const len = sequence.length;
    const shoulderIdx = isRightHanded ? 12 : 11;
    const elbowIdx = isRightHanded ? 14 : 13;
    const wristIdx = isRightHanded ? 16 : 15;

    const elbowAngle: number[] = [];
    const trunkAngle: number[] = [];

    // Pre-pass: determine if meaningful Z depth is present (MediaPipe 3D) or 2D-only (YOLO).
    // YOLO sets worldLandmarks = landmarks so Z ≈ 0; MediaPipe worldLandmarks carry real depth.
    let hasDepthKF = false;
    for (const f of sequence) {
        const wl = f.worldLandmarks;
        if (wl && (Math.abs((wl[11] as any)?.z ?? 0) > 0.02 || Math.abs((wl[12] as any)?.z ?? 0) > 0.02)) {
            hasDepthKF = true; break;
        }
    }
    // For 2D-only pose: compute max shoulder width across the clip as the normalisation anchor.
    // When the player fully faces the camera the shoulders appear widest (≈ 0° rotation).
    let maxShoulderWidthKF = 0;
    if (!hasDepthKF) {
        for (const f of sequence) {
            const lm = f.landmarks;
            if (lm?.[11] && lm?.[12]) {
                const sw = Math.abs(lm[12].x - lm[11].x);
                if (sw > maxShoulderWidthKF) maxShoulderWidthKF = sw;
            }
        }
    }

    for (let i = 0; i < len; i++) {
        const lm = sequence[i].landmarks;
        const lSh = lm?.[11]; const rSh = lm?.[12];
        const lHip = lm?.[23]; const rHip = lm?.[24];
        const shoulder = lm?.[shoulderIdx];
        const elbow = lm?.[elbowIdx];
        const wrist = lm?.[wristIdx];

        if (shoulder && elbow && wrist) {
            const v1x = shoulder.x - elbow.x; const v1y = shoulder.y - elbow.y;
            const v2x = wrist.x - elbow.x; const v2y = wrist.y - elbow.y;
            const dot = v1x * v2x + v1y * v2y;
            const m1 = Math.hypot(v1x, v1y); const m2 = Math.hypot(v2x, v2y);
            if (m1 > 1e-6 && m2 > 1e-6) {
                elbowAngle.push(Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * (180 / Math.PI));
            } else { elbowAngle.push(elbowAngle[i - 1] ?? 90); }
        } else { elbowAngle.push(elbowAngle[i - 1] ?? 90); }

        if (lSh && rSh && lHip && rHip) {
            if (hasDepthKF) {
                // 3D path: shoulder-hip separation angle in the XZ plane.
                // Uses worldLandmarks when available so Z carries true depth.
                const wl = sequence[i].worldLandmarks || sequence[i].landmarks;
                const lShW = wl?.[11]; const rShW = wl?.[12];
                const lHipW = wl?.[23]; const rHipW = wl?.[24];
                if (lShW && rShW && lHipW && rHipW) {
                    const sx = rShW.x - lShW.x; const sz = ((rShW as any).z ?? 0) - ((lShW as any).z ?? 0);
                    const hx = rHipW.x - lHipW.x; const hz = ((rHipW as any).z ?? 0) - ((lHipW as any).z ?? 0);
                    const dot = sx * hx + sz * hz;
                    const ms = Math.sqrt(sx * sx + sz * sz);
                    const mh = Math.sqrt(hx * hx + hz * hz);
                    if (ms > 1e-6 && mh > 1e-6) {
                        trunkAngle.push(Math.acos(Math.max(-1, Math.min(1, dot / (ms * mh)))) * (180 / Math.PI));
                    } else { trunkAngle.push(trunkAngle[i - 1] ?? 0); }
                } else { trunkAngle.push(trunkAngle[i - 1] ?? 0); }
            } else {
                // 2D-only path (YOLO): shoulder foreshortening as rotation proxy.
                // Shoulder width decreases as the player rotates away from the camera.
                // Maps [maxWidth → 0] to [0° → 90°].
                const sw = Math.abs(lSh.x - rSh.x);
                const deg = maxShoulderWidthKF > 0.01
                    ? Math.max(0, Math.min(90, (1 - sw / maxShoulderWidthKF) * 90))
                    : 0;
                trunkAngle.push(deg);
            }
        } else { trunkAngle.push(trunkAngle[i - 1] ?? 0); }
    }

    const armAngularVelocity: number[] = [0];
    for (let i = 1; i < len; i++) {
        const dt = Math.max(0.001, sequence[i].timestamp - sequence[i - 1].timestamp);
        armAngularVelocity.push(Math.abs(elbowAngle[i] - elbowAngle[i - 1]) / dt);
    }

    return {
        elbowAngle: smoothArray(elbowAngle, 5),
        trunkAngle: smoothArray(trunkAngle, 5),
        armAngularVelocity: smoothArray(armAngularVelocity, 5),
    };
}
