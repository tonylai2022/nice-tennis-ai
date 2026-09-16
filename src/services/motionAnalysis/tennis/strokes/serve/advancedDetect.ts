import type { PoseResult } from '../../../BaseMotionAnalysis';
import { CalibrationService } from '../../../../CalibrationService';
import {
    smoothArray, calculateLandmarkVelocity3D, calculateAcceleration,
    calculateAngle3D, calculateKneeBend, calculateArmExtension, calculateTrunkRotation,
    detectByVelocity, detectByPosition, ensembleVote,
} from '../../poseUtils';

export function findServePhases(sequence: PoseResult[], isReferenceVideo: boolean = false, videoUrl?: string) {
    const len = sequence.length;
    if (len < 10) {
        return {
            indices: { prepIdx: 0, tossPeakIdx: Math.floor(len * 0.25), loadingIdx: Math.floor(len * 0.4), contactIdx: Math.floor(len * 0.7), finishIdx: len - 1 },
            frames: {
                prep: sequence[0],
                tossPeak: sequence[Math.floor(len * 0.25)],
                loading: sequence[Math.floor(len * 0.4)],
                contact: sequence[Math.floor(len * 0.7)],
                finish: sequence[len - 1],
            },
        };
    }

    const clamp = (idx: number, min: number, max: number) => Math.max(min, Math.min(max, idx));

    // kNN path disabled (if (false))
    if (false) {
        console.log('=== SERVE REF VIDEO - USING CALIBRATED MODEL (RELIABLE) ===');
        const calibratedPhases = CalibrationService.findPhasesWithCalibration('serve', sequence);
        if (calibratedPhases) {
            const phaseMap: Record<string, number> = {};
            for (const p of calibratedPhases) { phaseMap[p.phase] = p.frameIndex; }
            const prepIdx = clamp(phaseMap['preparation'] || 0, 0, len - 1);
            const tossPeakIdx = clamp(phaseMap['ball_toss'] || Math.floor(len * 0.25), 0, len - 1);
            const loadingIdx = clamp(phaseMap['loading'] || Math.floor(len * 0.4), 0, len - 1);
            const contactIdx = clamp(phaseMap['contact'] || Math.floor(len * 0.7), 0, len - 1);
            const finishIdx = clamp(phaseMap['finish'] || len - 1, 0, len - 1);
            return {
                indices: { prepIdx, tossPeakIdx, loadingIdx, contactIdx, finishIdx },
                frames: {
                    prep: sequence[prepIdx], tossPeak: sequence[tossPeakIdx],
                    loading: sequence[loadingIdx], contact: sequence[contactIdx], finish: sequence[finishIdx],
                },
            };
        }
    }

    const rightWristVel = smoothArray(calculateLandmarkVelocity3D(sequence, 16), 5);
    const leftWristVel = smoothArray(calculateLandmarkVelocity3D(sequence, 15), 5);
    const rightWristAccel = smoothArray(calculateAcceleration(rightWristVel, sequence), 3);
    const kneeBend = smoothArray(calculateKneeBend(sequence, true), 3);
    const armExtension = smoothArray(calculateArmExtension(sequence, true), 3);

    const normalize = (arr: number[]) => {
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const range = max - min || 1;
        return arr.map(v => (v - min) / range);
    };

    const normRightVel = normalize(rightWristVel);
    const normLeftVel = normalize(leftWristVel);
    const normKnee = normalize(kneeBend);
    const normExtension = normalize(armExtension);

    console.log(isReferenceVideo ? '=== SERVE REF VIDEO - KINETIC FALLBACK ===' : '=== SERVE USER VIDEO - KINETIC DETECTION ===');

    // =====================================================================
    // GLOBAL PHASE OPTIMIZATION
    // =====================================================================
    if (true) {
        const t0 = sequence[0].timestamp;
        const t1 = sequence[len - 1].timestamp;
        const durationSec = Math.max(0.001, t1 - t0);

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
                if (picked.every(p => Math.abs(p.t - c.t) >= minTimeGapSec)) picked.push(c);
            }
            return picked;
        };

        const gapPenalty = (actual: number, ideal: number, tol: number, weight: number) => {
            const d = Math.max(0, Math.abs(actual - ideal) - tol);
            return d * weight;
        };

        const leftWristHeightRaw: number[] = [];
        const leftArmExtRaw: number[] = [];
        const rightWristHeightRaw: number[] = [];
        const wristBelowHipRaw: number[] = [];

        for (let i = 0; i < len; i++) {
            const lm = sequence[i].landmarks;
            const wl = sequence[i].worldLandmarks || lm;

            if (lm?.[15]) {
                const vis = (lm[15].visibility ?? 1);
                leftWristHeightRaw.push(vis > 0.4 ? (1 - lm[15].y) : 0);
            } else {
                leftWristHeightRaw.push(0);
            }

            if (wl?.[11] && wl?.[13] && wl?.[15]) {
                leftArmExtRaw.push(calculateAngle3D(wl[11], wl[13], wl[15]));
            } else {
                leftArmExtRaw.push(0);
            }

            if (lm?.[16]) {
                rightWristHeightRaw.push(1 - lm[16].y);
            } else {
                rightWristHeightRaw.push(0);
            }

            if (lm?.[16] && lm?.[24]) {
                wristBelowHipRaw.push(lm[16].y - lm[24].y);
            } else {
                wristBelowHipRaw.push(0);
            }
        }

        const normLeftWristHeight = normalize01(leftWristHeightRaw);
        const normLeftArmExt = normalize01(leftArmExtRaw);
        const normRightWristHeight = normalize01(rightWristHeightRaw);
        const normWristBelowHip = normalize01(wristBelowHipRaw);

        const prepScore: number[] = new Array(len).fill(0);
        const tossScore: number[] = new Array(len).fill(0);
        const loadingScore: number[] = new Array(len).fill(0);
        const contactScore: number[] = new Array(len).fill(0);
        const finishScore: number[] = new Array(len).fill(0);

        for (let i = 0; i < len; i++) {
            const progress = (sequence[i].timestamp - t0) / durationSec;
            const accelSign = (i > 0 && i < len - 1 && rightWristAccel[i - 1] > 0 && rightWristAccel[i + 1] < 0) ? 1 : 0;

            prepScore[i] =
                (1 - normRightVel[i]) * 0.45 +
                (1 - normLeftVel[i]) * 0.35 +
                (1 - progress) * 0.20;

            tossScore[i] =
                normLeftWristHeight[i] * 0.65 +
                normLeftArmExt[i] * 0.35;

            loadingScore[i] =
                (1 - normKnee[i]) * 0.55 +
                (1 - normRightVel[i]) * 0.25 +
                (1 - normExtension[i]) * 0.20;

            contactScore[i] =
                normRightVel[i] * 0.55 +
                normExtension[i] * 0.25 +
                normRightWristHeight[i] * 0.15 +
                accelSign * 0.05;

            finishScore[i] =
                normWristBelowHip[i] * 0.50 +
                (1 - normRightVel[i]) * 0.30 +
                progress * 0.20;
        }

        const contactWinStart = t0 + durationSec * 0.35;
        const contactWinEnd = t0 + durationSec * 0.95;
        const topKContact = scoreToTopK(contactScore, contactWinStart, contactWinEnd, 10, 0.08);

        let best:
            | {
                prepIdx: number;
                tossPeakIdx: number;
                loadingIdx: number;
                contactIdx: number;
                finishIdx: number;
                score: number;
            }
            | null = null;

        for (const ct of topKContact) {
            const ctT = ct.t;

            const topKLoad = scoreToTopK(loadingScore, ctT - 1.2, ctT - 0.12, 10, 0.07);
            if (topKLoad.length === 0) continue;

            const topKFinish = scoreToTopK(finishScore, ctT + 0.10, ctT + 2.5, 10, 0.10);
            if (topKFinish.length === 0) continue;

            for (const ld of topKLoad) {
                const ldT = ld.t;
                if (ldT >= ctT) continue;

                const topKToss = scoreToTopK(tossScore, ldT - 2.0, ldT - 0.10, 10, 0.08);
                if (topKToss.length === 0) continue;

                for (const ts of topKToss) {
                    const tsT = ts.t;
                    if (tsT >= ldT) continue;

                    const topKPrep = scoreToTopK(prepScore, tsT - 2.0, tsT - 0.10, 8, 0.10);
                    if (topKPrep.length === 0) continue;

                    for (const pr of topKPrep) {
                        const prT = pr.t;
                        if (prT >= tsT) continue;

                        for (const fn of topKFinish) {
                            const fnT = fn.t;
                            if (fnT <= ctT) continue;

                            const gapTossToLoad = ldT - tsT;
                            const gapLoadToContact = ctT - ldT;
                            const gapContactToFinish = fnT - ctT;
                            const gapPrepToToss = tsT - prT;

                            const penalty =
                                gapPenalty(gapPrepToToss, 0.70, 0.60, 0.20) +
                                gapPenalty(gapTossToLoad, 0.70, 0.60, 0.25) +
                                gapPenalty(gapLoadToContact, 0.30, 0.25, 0.40) +
                                gapPenalty(gapContactToFinish, 0.80, 0.80, 0.20);

                            const combined =
                                pr.score * 0.80 +
                                ts.score * 1.10 +
                                ld.score * 1.10 +
                                ct.score * 1.25 +
                                fn.score * 0.85 -
                                penalty;

                            if (!best || combined > best.score) {
                                best = {
                                    prepIdx: pr.idx, tossPeakIdx: ts.idx, loadingIdx: ld.idx,
                                    contactIdx: ct.idx, finishIdx: fn.idx, score: combined,
                                };
                            }
                        }
                    }
                }
            }
        }

        if (best) {
            console.log(
                `Serve OPT: PREP=${best.prepIdx} | TOSS=${best.tossPeakIdx} | LOAD=${best.loadingIdx} | CT=${best.contactIdx} | FIN=${best.finishIdx}`,
            );
            return {
                indices: {
                    prepIdx: clamp(best.prepIdx, 0, len - 1),
                    tossPeakIdx: clamp(best.tossPeakIdx, 0, len - 1),
                    loadingIdx: clamp(best.loadingIdx, 0, len - 1),
                    contactIdx: clamp(best.contactIdx, 0, len - 1),
                    finishIdx: clamp(best.finishIdx, 0, len - 1),
                },
                frames: {
                    prep: sequence[clamp(best.prepIdx, 0, len - 1)],
                    tossPeak: sequence[clamp(best.tossPeakIdx, 0, len - 1)],
                    loading: sequence[clamp(best.loadingIdx, 0, len - 1)],
                    contact: sequence[clamp(best.contactIdx, 0, len - 1)],
                    finish: sequence[clamp(best.finishIdx, 0, len - 1)],
                },
            };
        }

        console.warn('Serve OPT: no feasible candidate sequence found; falling back to anchor-based detection');
    }

    // =====================================================================
    // ANCHOR-BASED FALLBACK
    // =====================================================================
    let globalPeakVel = -1;
    let anchorIdx = Math.floor(len / 2);
    const safeStart = Math.floor(len * 0.1);
    const safeEnd = Math.floor(len * 0.9);
    for (let i = safeStart; i < safeEnd; i++) {
        if (rightWristVel[i] > globalPeakVel) { globalPeakVel = rightWristVel[i]; anchorIdx = i; }
    }
    console.log(`  Anchor (Peak Velocity): Frame ${anchorIdx} (${sequence[anchorIdx].timestamp.toFixed(2)}s)`);

    const contactStart = clamp(anchorIdx - 10, 0, len - 1);
    const contactEnd = clamp(anchorIdx + 5, 0, len - 1);

    const ctVel = detectByVelocity(rightWristVel, rightWristAccel, contactStart, contactEnd, 'accel_sign_change');
    const ctHeight = detectByPosition(sequence, contactStart, contactEnd, 'highest_wrist');
    const ctExt = detectByPosition(sequence, contactStart, contactEnd, 'max_arm_extension');

    const contactIdx = ensembleVote([
        { ...ctVel, method: 'vel' },
        { ...ctHeight, method: 'height' },
        { ...ctExt, method: 'ext' },
    ]);
    console.log(`  => Final CONTACT: ${contactIdx}`);

    const avgDt = (sequence[len - 1].timestamp - sequence[0].timestamp) / len;
    const frames1Sec = Math.floor(1.0 / avgDt) || 30;

    const loadEnd = Math.max(0, contactIdx - 5);
    const loadStart = Math.max(0, contactIdx - frames1Sec);

    const ldVel = detectByVelocity(rightWristVel, rightWristAccel, loadStart, loadEnd, 'minimum');
    const ldKnee = detectByPosition(sequence, loadStart, loadEnd, 'deepest_knee_bend');
    let ldPosIdx = Math.floor((loadStart + loadEnd) / 2);
    let bestLdScore = -Infinity;
    for (let i = loadStart; i < loadEnd; i++) {
        const score = (1 - normKnee[i]) * 2.0 + (1 - normRightVel[i]) * 1.5;
        if (score > bestLdScore) { bestLdScore = score; ldPosIdx = i; }
    }

    const loadingIdx = ensembleVote([
        { ...ldVel, method: 'vel_min' },
        { ...ldKnee, method: 'knee_bend' },
        { idx: ldPosIdx, confidence: 0.6, method: 'bio_score' },
    ]);
    console.log(`  => Final LOADING: ${loadingIdx}`);

    const tossEnd = Math.max(0, loadingIdx - 5);
    const tossStart = Math.max(0, loadingIdx - Math.floor(frames1Sec * 1.5));

    let tossHIdx = tossStart;
    let maxH = -Infinity;
    for (let i = tossStart; i < tossEnd; i++) {
        const y = sequence[i].landmarks[15].y;
        if (sequence[i].landmarks[15].visibility > 0.5 && (1 - y) > maxH) {
            maxH = 1 - y;
            tossHIdx = i;
        }
    }
    const tossPeakIdx = tossHIdx;
    console.log(`  => Final TOSS: ${tossPeakIdx}`);

    const prepIdx = Math.max(0, tossPeakIdx - frames1Sec);
    console.log(`  => Final PREP: ${prepIdx}`);

    const finishStart = Math.min(len - 1, contactIdx + 10);
    const finishEnd = len - 1;
    let finishIdx = finishEnd;
    for (let i = finishStart; i < finishEnd; i++) {
        const wristY = sequence[i].landmarks[16].y;
        const hipY = sequence[i].landmarks[24].y;
        if (wristY > hipY && normRightVel[i] < 0.2) { finishIdx = i; break; }
    }
    console.log(`  => Final FINISH: ${finishIdx}`);

    console.log(`Serve KINETIC: Prep=${prepIdx}, Toss=${tossPeakIdx}, Load=${loadingIdx}, Contact=${contactIdx}, Finish=${finishIdx}`);

    return {
        indices: { prepIdx, tossPeakIdx, loadingIdx, contactIdx, finishIdx },
        frames: {
            prep: sequence[clamp(prepIdx, 0, len - 1)],
            tossPeak: sequence[clamp(tossPeakIdx, 0, len - 1)],
            loading: sequence[clamp(loadingIdx, 0, len - 1)],
            contact: sequence[clamp(contactIdx, 0, len - 1)],
            finish: sequence[clamp(finishIdx, 0, len - 1)],
        },
    };
}
