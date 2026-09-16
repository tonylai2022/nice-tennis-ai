import type { PoseResult } from '../../../BaseMotionAnalysis';
import { calculateAngle } from '../../poseUtils';

export function detectBackhandPhases(sequence: PoseResult[]): {
    unitTurnIdx: number;
    racketDropIdx: number;
    contactIdx: number;
    followThroughIdx: number;
    detectedIsRightHanded: boolean;
} {
    const len = sequence.length;
    const activeSequence = sequence;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

    const medianFinite = (arr: number[]) => {
        const xs = arr.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
        if (xs.length === 0) return NaN;
        const mid = Math.floor(xs.length / 2);
        return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
    };

    // Ball track quality assessment
    const ballTrackQuality = (() => {
        try {
            const obs: { x: number; y: number; radius?: number; conf: number }[] = [];
            for (let i = 0; i < len; i++) {
                const f: any = activeSequence[i] as any;
                const b = f?.ball as { x: number; y: number; confidence: number; radius?: number } | undefined;
                if (b && b.confidence >= 0.20 && Number.isFinite(b.x) && Number.isFinite(b.y)) {
                    obs.push({ x: b.x, y: b.y, radius: b.radius, conf: b.confidence });
                }
            }

            if (obs.length === 0) return { ok: false, reason: 'no_observations' };
            const frac = obs.length / len;
            if (frac < 0.12) return { ok: false, reason: 'too_few' };

            const xs = obs.map(o => o.x);
            const ys = obs.map(o => o.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const span = Math.max(maxX - minX, maxY - minY);

            const speeds: number[] = [];
            for (let i = 1; i < obs.length; i++) {
                const dx = obs[i].x - obs[i - 1].x;
                const dy = obs[i].y - obs[i - 1].y;
                speeds.push(Math.hypot(dx, dy));
            }
            const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
            const medSpeed = medianFinite(speeds);

            if (frac >= 0.9 && span < 0.06 && (!Number.isFinite(medSpeed) || medSpeed < 0.06) && maxSpeed < 0.12) {
                return { ok: false, reason: 'stuck' };
            }
            if (frac >= 0.85 && !(span > 0.12 && maxSpeed > 0.20)) {
                return { ok: false, reason: 'too_dense_suspect' };
            }

            const rads = obs.map(o => o.radius).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
            const medRad = medianFinite(rads);
            if (Number.isFinite(medRad) && medRad > 0.12) {
                return { ok: false, reason: 'too_big' };
            }

            return { ok: true, reason: 'ok' };
        } catch {
            return { ok: false, reason: 'error' };
        }
    })();

    const ballInversionAt = (i: number): { score: number; used: boolean } => {
        if (!ballTrackQuality.ok) return { score: 0, used: false };
        const bAt = (idx: number) => {
            const f: any = activeSequence[idx] as any;
            const b = f?.ball as { x: number; y: number; confidence: number } | undefined;
            if (!b || !(b.confidence > 0.12) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
            return b;
        };
        const vel = (i0: number, i1: number) => {
            if (i0 < 0 || i1 < 0 || i0 >= len || i1 >= len) return null;
            const b0 = bAt(i0);
            const b1 = bAt(i1);
            if (!b0 || !b1) return null;
            const t0 = activeSequence[i0]?.timestamp ?? 0;
            const t1 = activeSequence[i1]?.timestamp ?? 0;
            const dt = Math.max(1e-3, t1 - t0);
            const vx = (b1.x - b0.x) / dt;
            const vy = (b1.y - b0.y) / dt;
            const s = Math.hypot(vx, vy);
            return { vx, vy, s };
        };
        const vIn = vel(i - 2, i);
        const vOut = vel(i, i + 2);
        if (!vIn || !vOut) return { score: 0, used: false };
        const minSpeed = 0.12;
        if (!(vIn.s > minSpeed && vOut.s > minSpeed)) return { score: 0, used: true };
        const dot = vIn.vx * vOut.vx + vIn.vy * vOut.vy;
        const denom = Math.max(1e-9, vIn.s * vOut.s);
        const cos = Math.max(-1, Math.min(1, dot / denom));
        const inv = clamp01((-cos - 0.2) / 0.8);
        return { score: inv, used: true };
    };

    // For backhand, primary hitting arm is LEFT for right-handed players (two-handed backhand)
    const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hand: [16, 18, 20, 22] as const };
    const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hand: [15, 17, 19, 21] as const };

    const contactScoreForSide = (side: typeof RIGHT | typeof LEFT, minIndex = 5, maxIndex = len - 5) => {
        const ext: number[] = new Array(len).fill(NaN);
        const vel: number[] = new Array(len).fill(0);
        const fwd: number[] = new Array(len).fill(NaN);
        let maxExt = 0;
        let maxVel = 0;
        let maxFwd = 0;
        let peakVelIdx = Math.floor(len * 0.5);

        for (let i = 2; i < len - 2; i++) {
            const lm = activeSequence[i].landmarks;
            if (!lm || !lm[side.wrist] || !lm[side.shoulder] || !lm[side.elbow]) continue;
            const shoulderToWrist = Math.hypot(lm[side.wrist].x - lm[side.shoulder].x, lm[side.wrist].y - lm[side.shoulder].y);
            const elbowAngle = calculateAngle(lm[side.shoulder], lm[side.elbow], lm[side.wrist]);
            const e = shoulderToWrist + (elbowAngle / 180) * 0.35;
            ext[i] = e;
            maxExt = Math.max(maxExt, e);

            const p0 = activeSequence[i - 1]?.landmarks?.[side.wrist];
            const p1 = activeSequence[i]?.landmarks?.[side.wrist];
            const dt = Math.max(1e-3, (activeSequence[i].timestamp ?? 0) - (activeSequence[i - 1].timestamp ?? 0));
            if (p0 && p1 && isFinite(p0.x) && isFinite(p0.y) && isFinite(p1.x) && isFinite(p1.y)) {
                const dist = Math.hypot((p1.x - p0.x), (p1.y - p0.y));
                const v = dist / dt;
                vel[i] = v;
                if (v > maxVel) { maxVel = v; peakVelIdx = i; }
            }

            const shoulderMidX = ((lm[11]?.x ?? 0.5) + (lm[12]?.x ?? 0.5)) * 0.5;
            const wx = lm[side.wrist].x;
            if (Number.isFinite(shoulderMidX) && Number.isFinite(wx)) {
                // For backhand, forward is opposite direction
                const forward = side === LEFT ? (wx - shoulderMidX) : (shoulderMidX - wx);
                fwd[i] = forward;
                maxFwd = Math.max(maxFwd, forward);
            }
        }

        const ballRacketProx = (i: number): { prox: number; used: boolean } => {
            if (!ballTrackQuality.ok) return { prox: 0, used: false };
            const frame: any = activeSequence[i] as any;
            const ball = frame?.ball as { x: number; y: number; confidence: number; radius?: number } | undefined;
            if (!ball || !(ball.confidence > 0.12) || !activeSequence[i]?.landmarks?.length) return { prox: 0, used: false };
            const lm = activeSequence[i].landmarks;
            const wrist = lm?.[side.wrist];
            const elbow = lm?.[side.elbow];
            if (!wrist || !elbow) return { prox: 0, used: false };
            const racket = frame?.racket as { x0: number; y0: number; x1: number; y1: number; confidence: number } | undefined;
            const ax = racket && racket.confidence > 0.25 ? racket.x0 : (wrist.x ?? 0);
            const ay = racket && racket.confidence > 0.25 ? racket.y0 : (wrist.y ?? 0);
            const bx = racket && racket.confidence > 0.25 ? racket.x1 : ((wrist.x ?? 0) + ((wrist.x ?? 0) - (elbow.x ?? 0)) * 1.35);
            const by = racket && racket.confidence > 0.25 ? racket.y1 : ((wrist.y ?? 0) + ((wrist.y ?? 0) - (elbow.y ?? 0)) * 1.35);
            const px = ball.x;
            const py = ball.y;
            const abx = bx - ax;
            const aby = by - ay;
            const apx = px - ax;
            const apy = py - ay;
            const ab2 = abx * abx + aby * aby;
            const t = ab2 > 1e-6 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
            const cx = ax + abx * t;
            const cy = ay + aby * t;
            const dist = Math.hypot(px - cx, py - cy);
            const tol = 0.055 + (typeof ball.radius === 'number' ? Math.max(0, Math.min(0.045, ball.radius * 0.7)) : 0);
            const prox = clamp01(1 - dist / tol);
            const trust = (racket && racket.confidence > 0.25) ? clamp01(racket.confidence) : 0;
            const usedProx = prox * clamp01(ball.confidence) * (0.70 + 0.30 * trust);
            return { prox: usedProx, used: true };
        };

        const accel: number[] = new Array(len).fill(0);
        for (let i = 2; i < len - 2; i++) {
            if (isFinite(vel[i - 1]) && isFinite(vel[i]) && isFinite(vel[i + 1])) {
                const a = (vel[i + 1] - vel[i - 1]) / 2;
                accel[i] = a;
            }
        }

        let bestIdx = Math.floor(len * 0.5);
        let bestScore = -Infinity;
        const start = Math.max(5, minIndex);
        const end = Math.min(len - 5, maxIndex);

        for (let i = start; i < end; i++) {
            if (!isFinite(ext[i])) continue;
            const extN = maxExt > 1e-6 ? clamp01((ext[i] || 0) / maxExt) : 0;
            const velN = maxVel > 1e-6 ? clamp01((vel[i] || 0) / maxVel) : 0;
            const fwdN = maxFwd > 1e-6 ? clamp01((fwd[i] || 0) / maxFwd) : 0;
            const { prox, used } = ballRacketProx(i);
            const inv = ballInversionAt(i);
            const invBonus = inv.used ? (inv.score * (used ? 0.55 : 0.35)) : 0;

            let decelBonus = 0;
            if (i >= 2 && i < len - 2 && maxVel > 1e-6) {
                const isPeakVel = vel[i] >= vel[i - 1] && vel[i] >= vel[i - 2] && vel[i] >= vel[i + 1] && vel[i] > maxVel * 0.75;
                const isDecel = accel[i] < -0.001 || (vel[i + 1] < vel[i] && vel[i + 2] < vel[i + 1]);
                if (isPeakVel && isDecel) decelBonus = 0.25;
            }

            const peakWindow = Math.max(4, Math.floor((end - start) * 0.15));
            const peakDist = Math.abs(i - peakVelIdx);
            const peakPref = clamp01(1 - peakDist / peakWindow);
            const peakBonus = used ? (0.10 * peakPref) : (0.22 * peakPref);
            const score = used
                ? (1.20 * prox + 0.45 * velN + 0.20 * extN + 0.15 * fwdN + decelBonus + invBonus + peakBonus)
                : (0.65 * velN + 0.30 * extN + 0.25 * fwdN + decelBonus * 0.6 + invBonus * 0.7 + peakBonus);

            if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
        return { idx: bestIdx, score: bestScore };
    };

    // For backhand: left arm dominant for right-handed player
    const rightContact = contactScoreForSide(RIGHT);
    const leftContact = contactScoreForSide(LEFT);
    const detectedIsRightHanded = leftContact.score >= rightContact.score;
    const hitting = detectedIsRightHanded ? LEFT : RIGHT;
    const hitWristIdx = hitting.wrist;
    const hitElbowIdx = hitting.elbow;

    console.log(`[Backhand CV] Ball tracking: ${ballTrackQuality.ok ? 'OK' : 'FAILED - ' + ballTrackQuality.reason}`);
    console.log(`[Backhand CV] Contact scores - Left: ${leftContact.score.toFixed(3)} @ frame ${leftContact.idx}, Right: ${rightContact.score.toFixed(3)} @ frame ${rightContact.idx}`);
    console.log(`[Backhand CV] Detected as ${detectedIsRightHanded ? 'RIGHT' : 'LEFT'}-handed, using ${detectedIsRightHanded ? 'LEFT' : 'RIGHT'} arm (wrist=${hitWristIdx})`);

    let contactIdx = detectedIsRightHanded ? leftContact.idx : rightContact.idx;
    console.log(`[Backhand CV] Initial contact frame: ${contactIdx}`);

    // Refine contact to exact ball-racket moment using hitting arm
    if (ballTrackQuality.ok) {
        const refinementWindow = Math.max(3, Math.floor(len * 0.05));
        const refineStart = Math.max(0, contactIdx - refinementWindow);
        const refineEnd = Math.min(len - 1, contactIdx + Math.floor(refinementWindow * 0.3));
        let bestProximity = -Infinity;
        let refinedContactIdx = contactIdx;

        for (let i = refineStart; i < refineEnd; i++) {
            const frame: any = activeSequence[i] as any;
            const ball = frame?.ball as { x: number; y: number; confidence: number } | undefined;
            if (!ball || ball.confidence < 0.15) continue;

            const racket = frame?.racket as { x0: number; y0: number; x1: number; y1: number; confidence: number } | undefined;
            const lm = activeSequence[i]?.landmarks;

            let ax: number, ay: number, bx: number, by: number;

            if (racket && racket.confidence > 0.20) {
                ax = racket.x0; ay = racket.y0; bx = racket.x1; by = racket.y1;
            } else if (lm && lm[hitWristIdx] && lm[hitElbowIdx]) {
                const wrist = lm[hitWristIdx];
                const elbow = lm[hitElbowIdx];
                ax = wrist.x; ay = wrist.y;
                bx = wrist.x + (wrist.x - elbow.x) * 1.35;
                by = wrist.y + (wrist.y - elbow.y) * 1.35;
            } else {
                continue;
            }

            const px = ball.x, py = ball.y;
            const abx = bx - ax, aby = by - ay;
            const apx = px - ax, apy = py - ay;
            const ab2 = abx * abx + aby * aby;
            const t = ab2 > 1e-6 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
            const cx = ax + abx * t, cy = ay + aby * t;
            const dist = Math.hypot(px - cx, py - cy);
            const proximity = 1 / (dist + 0.001);

            if (proximity > bestProximity) { bestProximity = proximity; refinedContactIdx = i; }
        }

        if (Math.abs(refinedContactIdx - contactIdx) <= refinementWindow) {
            if (refinedContactIdx !== contactIdx) {
                console.log(`[Backhand CV] Refined contact: ${contactIdx} -> ${refinedContactIdx}`);
            }
            contactIdx = refinedContactIdx;
        } else {
            console.log(`[Backhand CV] Refinement rejected: ${refinedContactIdx} too far from ${contactIdx}`);
        }
    } else {
        console.log(`[Backhand CV] Skipping refinement - ball tracking not available`);
    }

    // Step 2: Unit Turn
    let unitTurnIdx = -1;
    let maxCoilScore = -Infinity;
    const turnSearchStart = 1;
    const turnSearchEnd = Math.max(turnSearchStart + 2, contactIdx - 3);

    if (turnSearchStart < turnSearchEnd) {
        const wristSpeed: number[] = new Array(len).fill(0);
        let maxWristSpeed = 0;
        for (let i = 1; i < len; i++) {
            const p0 = activeSequence[i - 1]?.landmarks?.[hitWristIdx];
            const p1 = activeSequence[i]?.landmarks?.[hitWristIdx];
            const dt = Math.max(1e-3, (activeSequence[i].timestamp ?? 0) - (activeSequence[i - 1].timestamp ?? 0));
            if (!p0 || !p1 || !isFinite(p0.x) || !isFinite(p0.y) || !isFinite(p1.x) || !isFinite(p1.y)) continue;
            const v = Math.hypot(p1.x - p0.x, p1.y - p0.y) / dt;
            wristSpeed[i] = v;
            maxWristSpeed = Math.max(maxWristSpeed, v);
        }

        for (let i = turnSearchStart; i < turnSearchEnd; i++) {
            const lm = activeSequence[i].landmarks;
            if (!lm || !lm[11] || !lm[12] || !lm[23] || !lm[24]) continue;
            const shoulderAngle = Math.atan2(lm[12].y - lm[11].y, lm[12].x - lm[11].x);
            const hipAngle = Math.atan2(lm[24].y - lm[23].y, lm[24].x - lm[23].x);
            const coilAmount = Math.abs(shoulderAngle - hipAngle);
            const shoulderWidth = Math.abs(lm[12].x - lm[11].x);
            const hipWidth = Math.abs(lm[24].x - lm[23].x);
            const foreshortening = hipWidth - shoulderWidth;
            const speedN = maxWristSpeed > 1e-6 ? clamp01((wristSpeed[i] || 0) / maxWristSpeed) : 0;
            const speedGate = 1 - clamp01((speedN - 0.35) / 0.45);
            const latePenalty = clamp01((i - (contactIdx - 10)) / 10) * 0.55;
            const score = (coilAmount + foreshortening * 2) * (0.55 + 0.45 * speedGate) - latePenalty;
            if (score > maxCoilScore) { maxCoilScore = score; unitTurnIdx = i; }
        }
    }

    if (unitTurnIdx === -1 || unitTurnIdx >= contactIdx) {
        unitTurnIdx = Math.max(1, Math.floor(contactIdx * 0.25));
    }
    if (unitTurnIdx >= contactIdx) {
        unitTurnIdx = Math.max(0, contactIdx - 10);
    }

    // Step 3: Racket Drop
    const getRacketTipY = (i: number): number => {
        const frame: any = activeSequence[i] as any;
        const r = frame?.racket as { x0: number; y0: number; x1: number; y1: number; confidence: number } | undefined;
        if (r && r.confidence >= 0.25 && Number.isFinite(r.y1)) return r.y1;
        const lm = activeSequence[i]?.landmarks;
        const elbow = lm?.[hitElbowIdx];
        const wrist = lm?.[hitWristIdx];
        if (!elbow || !wrist) return NaN;
        if (![elbow.x, elbow.y, wrist.x, wrist.y].every(Number.isFinite)) return NaN;
        return wrist.y + (wrist.y - elbow.y) * 1.35;
    };

    let racketDropIdx = unitTurnIdx + 2;
    let lowestRacketY = -Infinity;
    const dropSearchStart = Math.max(1, unitTurnIdx);
    const dropSearchEnd = contactIdx;

    for (let i = dropSearchStart; i < dropSearchEnd; i++) {
        const racketY = getRacketTipY(i);
        if (!Number.isFinite(racketY)) continue;
        if (racketY > lowestRacketY) { lowestRacketY = racketY; racketDropIdx = i; }
    }

    if (!Number.isFinite(lowestRacketY)) {
        racketDropIdx = Math.max(unitTurnIdx + 2, Math.floor((unitTurnIdx + contactIdx) / 2));
    }
    if (racketDropIdx >= contactIdx) racketDropIdx = Math.max(unitTurnIdx + 2, contactIdx - 5);

    // Step 4: Follow Through
    let followThroughIdx = Math.min(len - 1, contactIdx + 2);
    const followSearchStart = Math.min(len - 2, contactIdx + 1);
    const followSearchEnd = Math.min(len - 1, contactIdx + Math.floor(len * 0.15));

    for (let i = followSearchStart; i < followSearchEnd; i++) {
        const lm = activeSequence[i].landmarks;
        const prevLm = activeSequence[i - 1]?.landmarks;
        if (!lm || !prevLm || !lm[hitWristIdx] || !prevLm[hitWristIdx]) continue;

        const wristDy = lm[hitWristIdx].y - prevLm[hitWristIdx].y;
        const wristDx = detectedIsRightHanded
            ? (prevLm[hitWristIdx].x - lm[hitWristIdx].x)  // Left arm: moving right
            : (lm[hitWristIdx].x - prevLm[hitWristIdx].x); // Right arm: moving left

        if (wristDy < -0.008 || wristDx > 0.008) { followThroughIdx = i; break; }
    }

    // Final validation
    if (unitTurnIdx >= racketDropIdx) unitTurnIdx = Math.max(0, racketDropIdx - 2);
    if (racketDropIdx >= contactIdx) racketDropIdx = Math.max(unitTurnIdx + 1, contactIdx - 5);
    if (followThroughIdx <= contactIdx) followThroughIdx = Math.min(len - 1, contactIdx + 5);

    console.log(`[Backhand CV] Phases: UT=${unitTurnIdx} RD=${racketDropIdx} CT=${contactIdx} FT=${followThroughIdx} RightHanded=${detectedIsRightHanded}`);

    return { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx, detectedIsRightHanded };
}
