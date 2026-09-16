import type { PoseResult } from '../../../BaseMotionAnalysis';
import { CalibrationService } from '../../../../CalibrationService';
import {
    smoothArray, calculateLandmarkVelocity3D, calculateAcceleration,
    calculateTrunkRotation, calculateArmExtension, calculateKneeBend,
    calculateWristForwardPosition,
    detectByVelocity, detectByPosition, ensembleVote,
} from '../../poseUtils';
import { REFERENCE_PHASES, shouldUseHardcodedReferencePhases } from '../../phaseConfig';

export function findBackhandPhases(sequence: PoseResult[], isReferenceVideo: boolean = false, videoUrl?: string) {
    const len = sequence.length;
    if (len < 10) {
        return {
            indices: { unitTurnIdx: 0, racketDropIdx: Math.floor(len * 0.3), contactIdx: Math.floor(len * 0.6), followThroughIdx: len - 1 },
            frames: {
                unitTurn: sequence[0],
                racketDrop: sequence[Math.floor(len * 0.3)],
                contact: sequence[Math.floor(len * 0.6)],
                followThrough: sequence[len - 1],
            },
        };
    }

    const clamp = (idx: number, min: number, max: number) => Math.max(min, Math.min(max, idx));

    const durationSec = Math.max(0.001, sequence[len - 1].timestamp - sequence[0].timestamp);
    const fpsApprox = (len - 1) / durationSec;
    const frames100ms = Math.max(1, Math.round(fpsApprox * 0.1));
    const frames200ms = Math.max(1, Math.round(fpsApprox * 0.2));
    const frames500ms = Math.max(1, Math.round(fpsApprox * 0.5));
    const frames800ms = Math.max(1, Math.round(fpsApprox * 0.8));
    const frames1Sec = Math.max(3, Math.round(fpsApprox * 1.0));

    // =====================================================================
    // 0. CHECK FOR HARDCODED REFERENCE CALIBRATION
    // =====================================================================
    const urlToCheck = videoUrl || (videoUrl ?? '');
    if (isReferenceVideo && shouldUseHardcodedReferencePhases()) {
        for (const [key, phases] of Object.entries(REFERENCE_PHASES)) {
            if (urlToCheck.includes(key) && phases.contact > 0) {
                console.log(`=== USING HARDCODED CALIBRATION FOR ${key.toUpperCase()} (BACKHAND) ===`);
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
                        unitTurn: sequence[clamp(unitTurnIdx, 0, len - 1)],
                        racketDrop: sequence[clamp(racketDropIdx, 0, len - 1)],
                        contact: sequence[clamp(contactIdx, 0, len - 1)],
                        followThrough: sequence[clamp(followThroughIdx, 0, len - 1)],
                    },
                };
            }
        }
    }

    // =====================================================================
    // kNN CALIBRATION
    // =====================================================================
    if (CalibrationService.hasEnoughExamples('backhand')) {
        console.log('=== BACKHAND - USING CALIBRATED kNN MODEL ===');
        const calibratedPhases = CalibrationService.findPhasesWithCalibration('backhand', sequence);
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
                    followThrough: sequence[followThroughIdx],
                },
            };
        }
    }

    // =====================================================================
    // BIOMECHANICAL SIGNALS
    // =====================================================================
    const wristVelocity = smoothArray(calculateLandmarkVelocity3D(sequence, 16), 5);
    const wristAccel = smoothArray(calculateAcceleration(wristVelocity, sequence), 3);
    const trunkRotation = smoothArray(calculateTrunkRotation(sequence), 5);
    const armExtension = smoothArray(calculateArmExtension(sequence, true), 3);
    const kneeBend = smoothArray(calculateKneeBend(sequence, true), 3);
    const wristForward = smoothArray(calculateWristForwardPosition(sequence, true), 3);

    const normalize = (arr: number[]) => {
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const range = max - min || 1;
        return arr.map(v => (v - min) / range);
    };

    const normVelocity = normalize(wristVelocity);
    const normTrunk = normalize(trunkRotation);
    const normExtension = normalize(armExtension);
    const normKnee = normalize(kneeBend);
    const normForward = normalize(wristForward);

    console.log(isReferenceVideo ? '=== BACKHAND REF VIDEO - KINETIC FALLBACK ===' : '=== BACKHAND USER VIDEO - KINETIC DETECTION ===');

    // =====================================================================
    // GLOBAL PHASE OPTIMIZATION
    // =====================================================================
    if (true) {
        const t0 = sequence[0].timestamp;
        const t1 = sequence[len - 1].timestamp;
        const durationSec = Math.max(0.001, t1 - t0);

        const clamp = (idx: number, min: number, max: number) => Math.max(min, Math.min(max, idx));

        const normalize01 = (arr: number[]) => {
            const min = Math.min(...arr);
            const max = Math.max(...arr);
            const range = max - min || 1;
            return arr.map(v => (v - min) / range);
        };

        const scoreToTopK = (
            scores: number[],
            startT: number,
            endT: number,
            k: number,
            minTimeGapSec: number,
        ): { idx: number; score: number; t: number }[] => {
            const start = Math.min(startT, endT);
            const end = Math.max(startT, endT);
            const candidates: { idx: number; score: number; t: number }[] = [];

            for (let i = 0; i < len; i++) {
                const t = sequence[i].timestamp;
                if (t < start || t > end) continue;
                const s = scores[i] ?? 0;
                if (!isFinite(s)) continue;
                candidates.push({ idx: i, score: s, t });
            }

            candidates.sort((a, b) => b.score - a.score);
            const picked: { idx: number; score: number; t: number }[] = [];
            for (const c of candidates) {
                if (picked.length >= k) break;
                if (picked.every(p => Math.abs(p.t - c.t) >= minTimeGapSec)) {
                    picked.push(c);
                }
            }
            return picked;
        };

        const wristBelowElbowRaw: number[] = [];
        const wristCrossRightRaw: number[] = [];
        const wristHeightRelRaw: number[] = [];
        const contactZoneRaw: number[] = [];
        for (let i = 0; i < len; i++) {
            const wl = sequence[i].worldLandmarks || sequence[i].landmarks;
            const lm = sequence[i].landmarks;

            const wbe = wl?.[16] && wl?.[14] ? (wl[16].y - wl[14].y) : 0;
            wristBelowElbowRaw.push(wbe);

            const cross = wl?.[16] && wl?.[12] ? (wl[16].x - wl[12].x) : 0;
            wristCrossRightRaw.push(cross);

            const heightRel = lm?.[16] && lm?.[12] ? (lm[12].y - lm[16].y) : 0;
            wristHeightRelRaw.push(heightRel);

            if (lm?.[16] && lm?.[12] && lm?.[24]) {
                const wy = lm[16].y;
                const sy = lm[12].y;
                const hy = lm[24].y;
                const inZone = (wy > sy - 0.12 && wy < hy + 0.20) ? 1 : 0;
                contactZoneRaw.push(inZone);
            } else {
                contactZoneRaw.push(0);
            }
        }

        const normWristBelowElbow = normalize01(wristBelowElbowRaw);
        const normCrossRight = normalize01(wristCrossRightRaw);
        const normHeightRel = normalize01(wristHeightRelRaw);

        const contactScore: number[] = new Array(len).fill(0);
        const dropScore: number[] = new Array(len).fill(0);
        const unitTurnScore: number[] = new Array(len).fill(0);
        const followScore: number[] = new Array(len).fill(0);

        for (let i = 0; i < len; i++) {
            const accelSign = (i > 0 && i < len - 1 && wristAccel[i - 1] > 0 && wristAccel[i + 1] < 0) ? 1 : 0;

            contactScore[i] =
                normVelocity[i] * 0.40 +
                normForward[i] * 0.20 +
                normExtension[i] * 0.18 +
                accelSign * 0.18 +
                contactZoneRaw[i] * 0.04;

            dropScore[i] =
                normWristBelowElbow[i] * 0.42 +
                (1 - normVelocity[i]) * 0.22 +
                (1 - normKnee[i]) * 0.18 +
                (1 - normExtension[i]) * 0.18;

            unitTurnScore[i] =
                normTrunk[i] * 0.45 +
                (1 - normForward[i]) * 0.35 +
                (1 - normVelocity[i]) * 0.20;

            followScore[i] =
                normCrossRight[i] * 0.45 +
                normHeightRel[i] * 0.25 +
                (1 - normVelocity[i]) * 0.20 +
                normExtension[i] * 0.10;
        }

        const contactWinStart = t0 + durationSec * 0.25;
        const contactWinEnd = t0 + durationSec * 0.88;
        const topKContact = scoreToTopK(contactScore, contactWinStart, contactWinEnd, 10, 0.08);

        let best:
            | {
                unitTurnIdx: number;
                racketDropIdx: number;
                contactIdx: number;
                followThroughIdx: number;
                score: number;
            }
            | null = null;

        const gapPenalty = (actual: number, ideal: number, tol: number, weight: number) => {
            const d = Math.max(0, Math.abs(actual - ideal) - tol);
            return d * weight;
        };

        for (const ct of topKContact) {
            const ctT = ct.t;
            const dropStartT = ctT - 1.4;
            const dropEndT = ctT - 0.12;
            const topKDrop = scoreToTopK(dropScore, dropStartT, dropEndT, 10, 0.06);
            if (topKDrop.length === 0) continue;

            const followStartT = ctT + 0.12;
            const followEndT = ctT + 2.0;
            const topKFollow = scoreToTopK(followScore, followStartT, followEndT, 10, 0.06);
            if (topKFollow.length === 0) continue;

            for (const rd of topKDrop) {
                const rdT = rd.t;
                if (rdT >= ctT) continue;

                const utStartT = rdT - 2.2;
                const utEndT = rdT - 0.12;
                const topKUnit = scoreToTopK(unitTurnScore, utStartT, utEndT, 10, 0.06);
                if (topKUnit.length === 0) continue;

                for (const ut of topKUnit) {
                    const utT = ut.t;
                    if (utT >= rdT) continue;

                    for (const ft of topKFollow) {
                        const ftT = ft.t;
                        if (ftT <= ctT) continue;

                        const gapRD = ctT - rdT;
                        const gapUT = rdT - utT;
                        const gapFT = ftT - ctT;

                        const penalty =
                            gapPenalty(gapRD, 0.60, 0.25, 0.35) +
                            gapPenalty(gapUT, 0.60, 0.35, 0.20) +
                            gapPenalty(gapFT, 0.55, 0.35, 0.20);

                        const combined =
                            ut.score * 1.00 +
                            rd.score * 1.05 +
                            ct.score * 1.20 +
                            ft.score * 0.95 -
                            penalty;

                        if (!best || combined > best.score) {
                            best = {
                                unitTurnIdx: ut.idx,
                                racketDropIdx: rd.idx,
                                contactIdx: ct.idx,
                                followThroughIdx: ft.idx,
                                score: combined,
                            };
                        }
                    }
                }
            }
        }

        if (best) {
            console.log(
                `Backhand OPT: UT=${best.unitTurnIdx} (t=${sequence[best.unitTurnIdx].timestamp.toFixed(2)}s) | ` +
                `RD=${best.racketDropIdx} (t=${sequence[best.racketDropIdx].timestamp.toFixed(2)}s) | ` +
                `CT=${best.contactIdx} (t=${sequence[best.contactIdx].timestamp.toFixed(2)}s) | ` +
                `FT=${best.followThroughIdx} (t=${sequence[best.followThroughIdx].timestamp.toFixed(2)}s)`,
            );
            return {
                indices: {
                    unitTurnIdx: clamp(best.unitTurnIdx, 0, len - 1),
                    racketDropIdx: clamp(best.racketDropIdx, 0, len - 1),
                    contactIdx: clamp(best.contactIdx, 0, len - 1),
                    followThroughIdx: clamp(best.followThroughIdx, 0, len - 1),
                },
                frames: {
                    unitTurn: sequence[clamp(best.unitTurnIdx, 0, len - 1)],
                    racketDrop: sequence[clamp(best.racketDropIdx, 0, len - 1)],
                    contact: sequence[clamp(best.contactIdx, 0, len - 1)],
                    followThrough: sequence[clamp(best.followThroughIdx, 0, len - 1)],
                },
            };
        }

        console.warn('Backhand OPT: no feasible candidate sequence found; falling back to anchor-based detection');
    }

    // =====================================================================
    // ANCHOR-BASED KINETIC DETECTION (fallback)
    // =====================================================================

    // 1. ANCHOR: CONTACT POINT
    let globalPeakVel = -1;
    let anchorIdx = Math.floor(len / 2);
    const safeStart = Math.floor(len * 0.1);
    const safeEnd = Math.floor(len * 0.9);
    for (let i = safeStart; i < safeEnd; i++) {
        if (wristVelocity[i] > globalPeakVel) {
            globalPeakVel = wristVelocity[i];
            anchorIdx = i;
        }
    }
    console.log(`  Anchor (Peak Velocity): Frame ${anchorIdx}`);

    const clampStart = (idx: number) => Math.max(0, Math.min(len - 1, idx));
    const clampEnd = (idx: number) => Math.max(1, Math.min(len, idx));
    const makeRange = (startIdx: number, endExclusiveIdx: number) => {
        const start = clampStart(startIdx);
        let end = clampEnd(endExclusiveIdx);
        if (end <= start + 1) end = clampEnd(start + 2);
        return { start, end };
    };

    const { start: contactStart, end: contactEnd } = makeRange(
        anchorIdx - frames500ms,
        anchorIdx + frames200ms + 1,
    );

    const ctVel = detectByVelocity(wristVelocity, wristAccel, contactStart, contactEnd, 'accel_sign_change');
    const ctExt = detectByPosition(sequence, contactStart, contactEnd, 'max_arm_extension');

    let ctBioIdx = anchorIdx;
    let bestCtScore = -Infinity;
    for (let i = contactStart; i < contactEnd; i++) {
        const lm = sequence[i].landmarks;
        if (!lm) continue;

        const wristY = lm[16].y;
        const shoulderY = lm[12].y;
        const hipY = lm[24].y;

        let positionScore = 0;
        if (wristY > shoulderY - 0.1 && wristY < hipY + 0.2) {
            positionScore = 1.0;
        }

        const score = normVelocity[i] * 3.0 + normExtension[i] * 2.5 + normForward[i] * 3.0 + positionScore * 2.5;
        if (score > bestCtScore) { bestCtScore = score; ctBioIdx = i; }
    }

    const contactIdx = ensembleVote([
        { ...ctVel, method: 'vel' },
        { ...ctExt, method: 'ext' },
        { idx: ctBioIdx, confidence: 0.7, method: 'hybrid' },
    ]);
    console.log(`  => Final CONTACT: ${contactIdx}`);

    // 2. RACKET DROP
    const { start: dropStart, end: dropEnd } = makeRange(
        contactIdx - frames800ms,
        (contactIdx - frames100ms) + 1,
    );
    console.log(`  Searching DROP in [${dropStart}, ${dropEnd - 1}]`);

    const rdVel = detectByVelocity(wristVelocity, wristAccel, dropStart, dropEnd, 'minimum');

    let rdWristBelowElbowIdx = Math.floor((dropStart + dropEnd) / 2);
    let maxWristBelowElbow = -Infinity;
    for (let i = dropStart; i < dropEnd; i++) {
        const wl = sequence[i].worldLandmarks || sequence[i].landmarks;
        if (wl[16] && wl[14]) {
            const wristBelowElbow = wl[16].y - wl[14].y;
            const score = wristBelowElbow * 2.0 + (1 - normVelocity[i]) * 1.5 + (1 - normKnee[i]) * 1.0;
            if (score > maxWristBelowElbow) {
                maxWristBelowElbow = score;
                rdWristBelowElbowIdx = i;
            }
        }
    }

    const racketDropIdx = ensembleVote([
        { ...rdVel, method: 'vel_min' },
        { idx: rdWristBelowElbowIdx, confidence: 0.85, method: 'wrist_below_elbow' },
    ]);
    console.log(`  => Final DROP: ${racketDropIdx}`);

    // 3. UNIT TURN
    const { start: utStart, end: utEnd } = makeRange(
        racketDropIdx - frames1Sec,
        (racketDropIdx - frames100ms) + 1,
    );
    console.log(`  Searching UNIT TURN in [${utStart}, ${utEnd - 1}]`);

    const utRot = detectByPosition(sequence, utStart, utEnd, 'max_shoulder_rotation');
    const utVel = detectByVelocity(wristVelocity, wristAccel, utStart, utEnd, 'minimum');

    let utBioIdx = Math.floor((utStart + utEnd) / 2);
    let bestUtScore = -Infinity;
    for (let i = utStart; i < utEnd; i++) {
        const backScore = 1 - normForward[i];
        const rotScore = normTrunk[i];
        const score = backScore * 2.5 + rotScore * 2.0;
        if (score > bestUtScore) { bestUtScore = score; utBioIdx = i; }
    }

    const unitTurnIdx = ensembleVote([
        { ...utRot, method: 'rotation' },
        { ...utVel, method: 'vel_min' },
        { idx: utBioIdx, confidence: 0.8, method: 'backward_wrist' },
    ]);
    console.log(`  => Final UNIT TURN: ${unitTurnIdx}`);

    // 4. FOLLOW THROUGH
    const { start: ftStart, end: ftEnd } = makeRange(
        contactIdx + frames200ms,
        contactIdx + frames1Sec + 1,
    );
    console.log(`  Searching FOLLOW THROUGH in [${ftStart}, ${ftEnd - 1}]`);

    const ftPos = detectByPosition(sequence, ftStart, ftEnd, 'wrist_crossed_right');
    const ftVel = detectByVelocity(wristVelocity, wristAccel, ftStart, ftEnd, 'minimum');

    const followThroughIdx = ensembleVote([
        { ...ftPos, method: 'crossed' },
        { ...ftVel, method: 'vel_min' },
    ]);
    console.log(`  => Final FOLLOW THROUGH: ${followThroughIdx}`);

    console.log(`Backhand KINETIC: UnitTurn=${unitTurnIdx}, Drop=${racketDropIdx}, Contact=${contactIdx}, Follow=${followThroughIdx}`);

    return {
        indices: { unitTurnIdx, racketDropIdx, contactIdx, followThroughIdx },
        frames: {
            unitTurn: sequence[clamp(unitTurnIdx, 0, len - 1)],
            racketDrop: sequence[clamp(racketDropIdx, 0, len - 1)],
            contact: sequence[clamp(contactIdx, 0, len - 1)],
            followThrough: sequence[clamp(followThroughIdx, 0, len - 1)],
        },
    };
}
