import type { PoseResult } from '../../../BaseMotionAnalysis';
import { CalibrationService } from '../../../../CalibrationService';
import {
    smoothArray, calculateLandmarkVelocity3D, calculateAcceleration,
    calculateTrunkRotation, calculateArmExtension, calculateKneeBend,
    calculateWristForwardPosition, extractKinematicFeatures,
} from '../../poseUtils';
import {
    REFERENCE_PHASES, shouldUseHardcodedReferencePhases,
} from '../../phaseConfig';

export function findForehandPhases(sequence: PoseResult[], isReferenceVideo: boolean = false, videoUrl?: string) {
    const len = sequence.length;
    if (len < 10) {
        return {
            indices: { unitTurnIdx: 0, racketDropIdx: Math.floor(len * 0.3), contactIdx: Math.floor(len * 0.6), followThroughIdx: len - 1 },
            frames: {
                unitTurn: sequence[0],
                racketDrop: sequence[Math.floor(len * 0.3)],
                contact: sequence[Math.floor(len * 0.6)],
                followThrough: sequence[len - 1]
            }
        };
    }

    const clampIdx = (idx: number) => Math.max(0, Math.min(len - 1, Math.round(idx)));
    const durationSecGap = Math.max(0.001, sequence[len - 1].timestamp - sequence[0].timestamp);
    const fpsApproxGap = (len - 1) / durationSecGap;
    const minGapFramesSep = Math.max(2, Math.round(fpsApproxGap * 0.12));

    const racketTipYAt = (i: number): number => {
        const f: any = sequence[i] as any;
        const r = f?.racket as { x0: number; y0: number; x1: number; y1: number; confidence: number } | undefined;
        if (r && r.confidence >= 0.25 && Number.isFinite(r.y1)) return r.y1;
        const lm = sequence[i]?.landmarks;
        const elbow = lm?.[14];
        const wrist = lm?.[16];
        if (!elbow || !wrist) return NaN;
        if (![elbow.x, elbow.y, wrist.x, wrist.y].every(Number.isFinite)) return NaN;
        const tipY = wrist.y + (wrist.y - elbow.y) * 1.35;
        return Number.isFinite(tipY) ? tipY : NaN;
    };

    const refineSeparated = (indices: { unitTurnIdx: number; racketDropIdx: number; contactIdx: number; followThroughIdx: number }) => {
        let ut = clampIdx(indices.unitTurnIdx);
        let rd = clampIdx(indices.racketDropIdx);
        let ct = clampIdx(indices.contactIdx);
        let ft = clampIdx(indices.followThroughIdx);

        ut = Math.min(ut, len - 1);
        rd = Math.max(rd, ut + 1);
        ct = Math.max(ct, rd + 1);
        ft = Math.max(ft, ct + 1);
        ft = Math.min(ft, len - 1);

        if (rd - ut < minGapFramesSep) ut = Math.max(0, rd - minGapFramesSep);
        if (ct - rd < minGapFramesSep) rd = Math.max(ut + 1, ct - minGapFramesSep);
        if (ft - ct < minGapFramesSep) ft = Math.min(len - 1, ct + minGapFramesSep);

        // Re-pick Unit Turn: max trunk rotation before RD
        const utEnd = Math.max(0, rd - minGapFramesSep);
        if (utEnd > 1) {
            const trunk = smoothArray(calculateTrunkRotation(sequence), 5);
            let best = ut;
            let bestVal = -Infinity;
            for (let i = 0; i <= utEnd; i++) {
                const v = trunk[i];
                if (!Number.isFinite(v)) continue;
                if (v > bestVal) { bestVal = v; best = i; }
            }
            ut = clampIdx(best);
        }

        // Re-pick Racket Drop: lowest racket head between UT and CT
        const rdStart = Math.min(len - 1, Math.max(ut + minGapFramesSep, 0));
        const rdEnd = Math.max(rdStart, Math.min(len - 1, ct - minGapFramesSep));
        if (rdEnd - rdStart >= 1) {
            let best = rd;
            let bestY = -Infinity;
            let obs = 0;
            for (let i = rdStart; i <= rdEnd; i++) {
                const y = racketTipYAt(i);
                if (!Number.isFinite(y)) continue;
                obs++;
                if (y > bestY) { bestY = y; best = i; }
            }
            if (obs >= 2) rd = clampIdx(best);
        }

        if (rd <= ut) rd = Math.min(len - 2, ut + minGapFramesSep);
        if (ct <= rd) ct = Math.min(len - 1, rd + minGapFramesSep);
        if (ft <= ct) ft = Math.min(len - 1, ct + minGapFramesSep);

        return {
            indices: { unitTurnIdx: ut, racketDropIdx: rd, contactIdx: ct, followThroughIdx: ft },
            frames: {
                unitTurn: sequence[ut],
                racketDrop: sequence[rd],
                contact: sequence[ct],
                followThrough: sequence[ft]
            }
        };
    };

    const clamp = (idx: number, min: number, max: number) => Math.max(min, Math.min(max, idx));

    // =====================================================================
    // 0. CHECK FOR HARDCODED REFERENCE CALIBRATION
    // =====================================================================
    const urlToCheck = videoUrl || '';
    if (isReferenceVideo && shouldUseHardcodedReferencePhases()) {
        for (const [key, phases] of Object.entries(REFERENCE_PHASES)) {
            if (urlToCheck.includes(key) && phases.contact > 0) {
                console.log(`=== USING HARDCODED CALIBRATION FOR ${key.toUpperCase()} ===`);
                const getIdx = (time: number) => {
                    let closestDist = Infinity;
                    let closestIdx = 0;
                    for (let i = 0; i < len; i++) {
                        const diff = Math.abs(sequence[i].timestamp - time);
                        if (diff < closestDist) { closestDist = diff; closestIdx = i; }
                    }
                    return closestIdx;
                };
                const unitTurnIdx = getIdx(phases.unitTurn);
                const racketDropIdx = getIdx(phases.racketDrop);
                const contactIdx = getIdx(phases.contact);
                const followThroughIdx = getIdx(phases.followThrough);
                return {
                    indices: { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx },
                    frames: {
                        unitTurn: sequence[unitTurnIdx],
                        racketDrop: sequence[racketDropIdx],
                        contact: sequence[contactIdx],
                        followThrough: sequence[followThroughIdx]
                    }
                };
            }
        }
    }

    // =====================================================================
    // kNN CALIBRATION PATH
    // =====================================================================
    if (CalibrationService.hasEnoughExamples('forehand')) {
        console.log('=== FOREHAND - USING CALIBRATED kNN MODEL ===');
        const calibratedPhases = CalibrationService.findPhasesWithCalibration('forehand', sequence);
        if (calibratedPhases) {
            const phaseMap: Record<string, number> = {};
            for (const p of calibratedPhases) {
                phaseMap[p.phase] = p.frameIndex;
            }
            const unitTurnIdx = clamp(phaseMap['unit_turn'] || 0, 0, len - 1);
            const racketDropIdx = clamp(phaseMap['racket_drop'] || Math.floor(len * 0.3), 0, len - 1);
            const contactIdx = clamp(phaseMap['contact'] || Math.floor(len * 0.6), 0, len - 1);
            const followThroughIdx = clamp(phaseMap['follow_through'] || len - 1, 0, len - 1);
            return {
                indices: { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx },
                frames: {
                    unitTurn: sequence[unitTurnIdx],
                    racketDrop: sequence[racketDropIdx],
                    contact: sequence[contactIdx],
                    followThrough: sequence[followThroughIdx]
                }
            };
        }
    }

    // =====================================================================
    // ANGULAR KINEMATICS (PROFESSIONAL MOTION ANALYSIS)
    // =====================================================================

    // Biomechanical signals used by the refineSeparated post-processor
    const wristVelocity = smoothArray(calculateLandmarkVelocity3D(sequence, 16), 5);
    smoothArray(calculateAcceleration(wristVelocity, sequence), 3); // computed for side-effects in refineSeparated
    smoothArray(calculateTrunkRotation(sequence), 5);
    smoothArray(calculateArmExtension(sequence, true), 3);
    smoothArray(calculateKneeBend(sequence, true), 3);
    smoothArray(calculateWristForwardPosition(sequence, true), 3);

    console.log(isReferenceVideo ? '=== FOREHAND REF VIDEO - ANGULAR KINEMATICS ===' : '=== FOREHAND USER VIDEO - ANGULAR KINEMATICS ===');

    {
        const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

        const avg = (arr: number[]) => {
            const valid = arr.filter(v => isFinite(v) && v > 0);
            return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
        };
        const rightWristVel = smoothArray(calculateLandmarkVelocity3D(sequence, 16), 5);
        const leftWristVel = smoothArray(calculateLandmarkVelocity3D(sequence, 15), 5);
        const isRightHanded = avg(rightWristVel) >= avg(leftWristVel);

        console.log(`  Detected: ${isRightHanded ? 'Right' : 'Left'}-handed`);

        const features = extractKinematicFeatures(sequence, isRightHanded);

        const safeStart = Math.floor(len * 0.08);
        const safeEnd = Math.max(safeStart + 5, Math.floor(len * 0.92));

        const normalize01 = (arr: number[]) => {
            let min = Infinity;
            let max = -Infinity;
            for (const v of arr) {
                if (!Number.isFinite(v)) continue;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-9) {
                return arr.map(() => 0);
            }
            const range = max - min;
            return arr.map(v => (Number.isFinite(v) ? (v - min) / range : 0));
        };

        // STEP 1: CONTACT = peak velocity + arm extension + racket-ball proximity
        // For rhythm-invariant detection we:
        // (a) Use ball-racket proximity as the primary signal when ball is tracked (> 0.4 prox)
        // (b) Supplement with velocity inversion (ball direction reversal) as a hard anchor
        // (c) For ball-less detection: wrist LINEAR velocity peak instead of angular velocity
        let contactIdx = safeStart;
        let peakAngVel = -Infinity;
        let bestContactScore = -Infinity;
        const contactScoresArr: number[] = new Array(len).fill(0);

        for (let i = safeStart; i < safeEnd; i++) {
            if (features.armAngularVelocity[i] > peakAngVel) {
                peakAngVel = features.armAngularVelocity[i];
            }
        }

        // Wrist linear velocity (more robust for slow/fast swingers than angular velocity)
        const wristIdx = isRightHanded ? 16 : 15;
        const wristLinVel: number[] = new Array(len).fill(0);
        let peakWristLinVel = 0;
        for (let i = 1; i < len; i++) {
            const p0 = sequence[i - 1].landmarks?.[wristIdx];
            const p1 = sequence[i].landmarks?.[wristIdx];
            const rawDt = sequence[i].timestamp - sequence[i - 1].timestamp;
            // Skip non-monotonic or zero-gap frames — don't clamp negative dt to 1e-3
            // because that produces an artificially huge velocity spike
            if (rawDt <= 0) { wristLinVel[i] = wristLinVel[i - 1]; continue; }
            const dt = rawDt;
            if (p0 && p1 && Number.isFinite(p0.x) && Number.isFinite(p1.x)) {
                const v = Math.hypot(p1.x - p0.x, p1.y - p0.y) / dt;
                wristLinVel[i] = v;
                if (v > peakWristLinVel) peakWristLinVel = v;
            }
        }

        // Ball velocity inversion: large direction change = hit
        const ballInversionScore: number[] = new Array(len).fill(0);
        for (let i = 2; i < len - 2; i++) {
            const bAt = (idx: number) => {
                const f: any = sequence[idx];
                const b = f?.ball;
                if (!b || b.confidence < 0.15 || !Number.isFinite(b.x)) return null;
                return b as { x: number; y: number };
            };
            const b0 = bAt(i - 2); const b1 = bAt(i); const b2 = bAt(i + 2);
            if (!b0 || !b1 || !b2) continue;
            const t0 = sequence[i - 2].timestamp; const t1 = sequence[i].timestamp; const t2 = sequence[i + 2].timestamp;
            const dt0 = Math.max(1e-3, t1 - t0); const dt1 = Math.max(1e-3, t2 - t1);
            const vInX = (b1.x - b0.x) / dt0; const vInY = (b1.y - b0.y) / dt0;
            const vOutX = (b2.x - b1.x) / dt1; const vOutY = (b2.y - b1.y) / dt1;
            const sIn = Math.hypot(vInX, vInY); const sOut = Math.hypot(vOutX, vOutY);
            if (sIn < 0.08 || sOut < 0.08) continue;
            const dot = vInX * vOutX + vInY * vOutY;
            const cos = dot / (sIn * sOut);
            ballInversionScore[i] = Math.max(0, (-cos - 0.1) / 0.9);
        }
        const peakInversion = Math.max(...ballInversionScore);

        for (let i = safeStart; i < safeEnd; i++) {
            const angVelScore = peakAngVel > 0 ? features.armAngularVelocity[i] / peakAngVel : 0;
            const linVelScore = peakWristLinVel > 0 ? wristLinVel[i] / peakWristLinVel : 0;
            // Use the stronger of angular/linear velocity signals
            const velScore = Math.max(angVelScore, linVelScore * 0.85);
            const extensionScore = features.elbowAngle[i] / 180;

            let ballProximityScore = 0;
            let hasBallData = false;
            const frame: any = sequence[i];
            const racket = frame?.racket;
            const ball = frame?.ball;
            if (racket && ball && racket.confidence >= 0.25 && ball.confidence >= 0.15) {
                // Use racket segment (x0,y0)-(x1,y1) to find closest point to ball
                const ax = racket.x0, ay = racket.y0, bx = racket.x1, by = racket.y1;
                const px = ball.x, py = ball.y;
                const abx = bx - ax, aby = by - ay;
                const apx = px - ax, apy = py - ay;
                const ab2 = abx * abx + aby * aby;
                const t = ab2 > 1e-6 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
                const cx = ax + abx * t, cy = ay + aby * t;
                const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                ballProximityScore = Math.max(0, 1 - dist / 0.14);
                hasBallData = true;
            }

            const invScore = peakInversion > 0.05 ? ballInversionScore[i] / peakInversion : 0;

            let score: number;
            if (hasBallData && (ballProximityScore > 0.3 || invScore > 0.3)) {
                // Ball is tracked and close to racket: proximity + inversion dominate
                score = ballProximityScore * 0.45 + invScore * 0.25 + velScore * 0.20 + extensionScore * 0.10;
            } else if (hasBallData) {
                // Ball tracked but far: balanced
                score = velScore * 0.45 + ballProximityScore * 0.25 + extensionScore * 0.20 + invScore * 0.10;
            } else {
                // No ball data: anchor to velocity-peak + deceleration onset (contact instant).
                // Plain argmax of velocity picks any fast prep movement; the decel bonus
                // pulls the winner to the frame where the swing peaks then immediately drops.
                const isAtVelPeak = i >= 2 && i < len - 1
                    && wristLinVel[i] >= wristLinVel[i - 1]
                    && wristLinVel[i] >= wristLinVel[i - 2]
                    && wristLinVel[i] > peakWristLinVel * 0.70
                    && wristLinVel[i + 1] < wristLinVel[i];
                const isDecel = i + 2 < len ? wristLinVel[i + 2] < wristLinVel[i + 1] : isAtVelPeak;
                const decelBonus = (isAtVelPeak && isDecel) ? 0.20 : 0;
                score = linVelScore * 0.50 + velScore * 0.20 + extensionScore * 0.15 + decelBonus;
            }

            contactScoresArr[i] = score;
            if (score > bestContactScore) { bestContactScore = score; contactIdx = i; }
        }

        console.log(`  CONTACT (biomechanical): frame ${contactIdx}`);

        // STEP 2: RACKET DROP = lowest racket head position before contact
        const angVel01 = normalize01(features.armAngularVelocity);
        const elbow01 = normalize01(features.elbowAngle);

        let racketDropIdx = safeStart;
        let lowestRacketY = -Infinity;
        const racketDropYArr: number[] = new Array(len).fill(NaN);

        for (let i = safeStart; i < contactIdx; i++) {
            const racketY = racketTipYAt(i);
            if (Number.isFinite(racketY)) racketDropYArr[i] = racketY;
            if (Number.isFinite(racketY) && racketY > lowestRacketY) {
                lowestRacketY = racketY;
                racketDropIdx = i;
            }
        }

        console.log(`  RACKET DROP (Y=${lowestRacketY.toFixed(3)}): frame ${racketDropIdx}`);

        // STEP 3: UNIT TURN = best coil signal before racket drop
        // Uses a combined score of:
        //   - Trunk rotation angle (works well for side-view cameras)
        //   - Shoulder width narrowing / foreshortening (works for frontal/back cameras)
        //   - Low wrist speed gate (unit turn happens when arm is still relatively quiet)
        //
        // Start from frame 0 (not safeStart) so short videos with the unit turn near the
        // beginning of the clip are still detected correctly.
        let unitTurnIdx = 0;
        let maxUnitTurnScore = -Infinity;
        const unitTurnScoresArr: number[] = new Array(len).fill(0);

        // Pre-compute shoulder widths for foreshortening signal
        const shoulderWidths: number[] = new Array(len).fill(NaN);
        let minShoulderWidth = Infinity;
        let maxShoulderWidth = 0;
        for (let i = 0; i < len; i++) {
            const lm = sequence[i].landmarks;
            if (lm?.[11] && lm?.[12] && Number.isFinite(lm[11].x) && Number.isFinite(lm[12].x)) {
                const w = Math.abs(lm[12].x - lm[11].x);
                shoulderWidths[i] = w;
                if (w < minShoulderWidth) minShoulderWidth = w;
                if (w > maxShoulderWidth) maxShoulderWidth = w;
            }
        }
        const shoulderWidthRange = Math.max(1e-6, maxShoulderWidth - minShoulderWidth);

        for (let i = 0; i < racketDropIdx; i++) {
            const trunkScore = features.trunkAngle[i] > 0 ? features.trunkAngle[i] / 90 : 0;
            // Foreshortening: shoulder width NARROWER than average = body turned sideways
            const sw = shoulderWidths[i];
            const foreShortScore = Number.isFinite(sw)
                ? Math.max(0, (maxShoulderWidth - sw) / shoulderWidthRange)
                : 0;
            // Low wrist speed gate: unit turn finishes before arm starts accelerating
            const wristSpeedN = peakWristLinVel > 0 ? wristLinVel[i] / peakWristLinVel : 0;
            const speedGate = Math.max(0, 1 - wristSpeedN * 2);

            // Blend both signals: trunk rotation (XZ plane or foreshortening via poseUtils)
            // and the raw shoulder-width foreshortening computed above as an independent check.
            // Weighted blend beats winner-takes-all (Math.max) when both signals are partial.
            const combined = (trunkScore * 0.65 + foreShortScore * 0.35) * (0.5 + 0.5 * speedGate);
            unitTurnScoresArr[i] = combined;
            if (combined > maxUnitTurnScore) { maxUnitTurnScore = combined; unitTurnIdx = i; }
        }

        // Tiebreaker: when unitTurnIdx is stuck at 0 and the search window has other frames,
        // prefer the LATEST frame whose score is within 90% of the max.  This prevents
        // frame 0 from always winning when trunk-rotation signals are flat over a short
        // window (common in clips where the player is already partially coiled at start).
        if (unitTurnIdx === 0 && racketDropIdx > 2 && maxUnitTurnScore > 0) {
            const threshold = maxUnitTurnScore * 0.90;
            for (let i = racketDropIdx - 1; i >= 1; i--) {
                if (unitTurnScoresArr[i] >= threshold) { unitTurnIdx = i; break; }
            }
        }

        console.log(`  UNIT TURN (score=${maxUnitTurnScore.toFixed(2)}): frame ${unitTurnIdx}`);

        // STEP 4: FOLLOW THROUGH = arm extension + deceleration + wrist crosses body
        // The wrist-crosses-body signal is the most reliable cue for a complete forehand finish:
        //   RH: wrist moves to the LEFT of the shoulder midpoint (wraps around)
        //   LH: wrist moves to the RIGHT
        let followThroughIdx = contactIdx + 1;
        let maxFollowExtension = -Infinity;

        for (let i = contactIdx + 1; i < safeEnd; i++) {
            const extensionScore = features.elbowAngle[i];
            const decelScore = peakAngVel > 0 ? (1.0 - features.armAngularVelocity[i] / peakAngVel) * 50 : 0;

            // Wrist cross-body: positive = wrist has crossed over the opposite shoulder
            const lm = sequence[i].landmarks;
            const wristLm = lm?.[wristIdx];
            const lShLm = lm?.[11];
            const rShLm = lm?.[12];
            const shoulderMidX = (lShLm && rShLm && Number.isFinite(lShLm.x) && Number.isFinite(rShLm.x))
                ? (lShLm.x + rShLm.x) * 0.5 : NaN;
            let crossBodyScore = 0;
            if (wristLm && Number.isFinite(wristLm.x) && Number.isFinite(shoulderMidX)) {
                // crossAmt > 0 when wrist has crossed past the shoulder midpoint
                const crossAmt = isRightHanded ? (shoulderMidX - wristLm.x) : (wristLm.x - shoulderMidX);
                crossBodyScore = Math.max(0, Math.min(30, crossAmt * 200));
            }

            const score = extensionScore + decelScore + crossBodyScore;
            if (score > maxFollowExtension) { maxFollowExtension = score; followThroughIdx = i; }
        }

        console.log(`  FOLLOW THROUGH: frame ${followThroughIdx}`);

        // Enforce strict temporal order
        unitTurnIdx = clamp(unitTurnIdx, safeStart, len - 4);
        racketDropIdx = clamp(racketDropIdx, unitTurnIdx + 1, len - 3);
        contactIdx = clamp(contactIdx, racketDropIdx + 1, len - 2);
        followThroughIdx = clamp(followThroughIdx, contactIdx + 1, len - 1);

        console.log(`  FINAL: UT=${unitTurnIdx} RD=${racketDropIdx} CT=${contactIdx} FT=${followThroughIdx}`);
        // Apply manual phase correction stored by the debug panel (sessionStorage)
        const corrKey = `mt_correction_${len}_${Math.round(durationSecGap * 1000)}`;
        try {
            const stored = sessionStorage.getItem(corrKey);
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<{
                    unitTurnIdx: number; racketDropIdx: number;
                    contactIdx: number; followThroughIdx: number;
                }>;
                if (typeof parsed.unitTurnIdx === 'number') unitTurnIdx = clamp(parsed.unitTurnIdx, 0, len - 1);
                if (typeof parsed.racketDropIdx === 'number') racketDropIdx = clamp(parsed.racketDropIdx, 0, len - 1);
                if (typeof parsed.contactIdx === 'number') contactIdx = clamp(parsed.contactIdx, 0, len - 1);
                if (typeof parsed.followThroughIdx === 'number') followThroughIdx = clamp(parsed.followThroughIdx, 0, len - 1);
                console.log('[MotionAnalysis] Applied manual phase correction:', { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx });
            }
        } catch { /* ignore */ }

        console.log(
            `Forehand ANGULAR KINEMATICS: UT=${unitTurnIdx}(t=${sequence[unitTurnIdx].timestamp.toFixed(2)}s) | ` +
            `RD=${racketDropIdx}(t=${sequence[racketDropIdx].timestamp.toFixed(2)}s) | ` +
            `CT=${contactIdx}(t=${sequence[contactIdx].timestamp.toFixed(2)}s) | ` +
            `FT=${followThroughIdx}(t=${sequence[followThroughIdx].timestamp.toFixed(2)}s)`
        );

        return {
            indices: { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx },
            frames: {
                unitTurn: sequence[unitTurnIdx],
                racketDrop: sequence[racketDropIdx],
                contact: sequence[contactIdx],
                followThrough: sequence[followThroughIdx]
            },
            scoreArrays: {
                contact: contactScoresArr,
                unitTurn: unitTurnScoresArr,
                racketDropY: racketDropYArr,
            },
            correctionKey: corrKey,
        };
    }
}
