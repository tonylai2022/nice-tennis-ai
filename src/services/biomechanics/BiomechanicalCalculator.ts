/**
 * BiomechanicalCalculator
 *
 * Pure functions that compute sport-specific joint-angle metrics and
 * kinetic-chain (force-sequence) data from raw MediaPipe pose frames.
 *
 * Each measurement compares the user's value against an evidence-based
 * clinical normal range and returns a structured JointAngleMetric.
 *
 * No reference video required – everything is compared to absolute standards.
 */

import type { PoseResult } from '../motionAnalysis/BaseMotionAnalysis';
import type { JointAngleMetric, ForceSequenceResult, ForceSequenceProblem } from './types';

// ── MediaPipe landmark indices ─────────────────────────────────────────────────
const LM = {
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_ELBOW: 13, R_ELBOW: 14,
    L_WRIST: 15, R_WRIST: 16,
    L_PINKY: 17, R_PINKY: 18,
    L_INDEX: 19, R_INDEX: 20,
    L_HIP: 23, R_HIP: 24,
    L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28,
} as const;

type Pt = { x: number; y: number; visibility?: number };

// ── Low-level helpers ──────────────────────────────────────────────────────────

function getLm(frame: PoseResult | null, idx: number, minVis = 0.2): Pt | null {
    if (!frame) return null;
    const lm = frame.landmarks?.[idx] as (Pt & { visibility?: number }) | undefined;
    if (!lm) return null;
    if (lm.visibility !== undefined && lm.visibility < minVis) return null;
    return lm;
}

/** 2-D joint angle (degrees) at vertex B: vectors BA and BC */
function angle2D(a: Pt, b: Pt, c: Pt): number {
    const ax = a.x - b.x, ay = a.y - b.y;
    const cx = c.x - b.x, cy = c.y - b.y;
    const dot = ax * cx + ay * cy;
    const mag = Math.hypot(ax, ay) * Math.hypot(cx, cy);
    if (mag < 1e-9) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

/** Frame at normalised position 0..1 along the sequence */
function atNorm(frames: PoseResult[], t: number): PoseResult | null {
    if (!frames.length) return null;
    return frames[Math.min(frames.length - 1, Math.round(t * (frames.length - 1)))];
}

/**
 * Average a scalar metric over a sliding window centred at normalised t.
 * windowFraction is the fraction of the total sequence to include on each side.
 */
function avgWindow(
    frames: PoseResult[],
    t: number,
    windowFraction: number,
    fn: (f: PoseResult) => number | null,
): number | null {
    if (!frames.length) return null;
    const half = Math.max(1, Math.floor(windowFraction * frames.length * 0.5));
    const center = Math.round(t * (frames.length - 1));
    const lo = Math.max(0, center - half);
    const hi = Math.min(frames.length - 1, center + half);
    const vals: number[] = [];
    for (let i = lo; i <= hi; i++) {
        const v = fn(frames[i]);
        if (v !== null && isFinite(v)) vals.push(v);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Quality score 0–100: how close value is to [lo, hi], losing all points at ±tolerance outside */
function rangeScore(value: number, lo: number, hi: number, tolerance: number): number {
    if (value >= lo && value <= hi) return 100;
    const dist = value < lo ? lo - value : value - hi;
    return Math.max(0, Math.round(100 * (1 - dist / tolerance)));
}

/** Build a complete JointAngleMetric from raw measurement */
function buildMetric(
    id: string,
    name: string,
    nameZh: string,
    rawValue: number,
    unit: string,
    normalMin: number,
    normalMax: number,
    optimalValue: number,
    phase: string,
    phaseZh: string,
    clinicalNote: string,
    clinicalNoteZh: string,
    tolerance: number,
): JointAngleMetric {
    const value = Math.round(rawValue * 10) / 10;
    let deviationDirection: 'too_high' | 'too_low' | 'normal';
    let deviation: number;
    if (value < normalMin) {
        deviationDirection = 'too_low';
        deviation = normalMin - value;
    } else if (value > normalMax) {
        deviationDirection = 'too_high';
        deviation = value - normalMax;
    } else {
        deviationDirection = 'normal';
        deviation = 0;
    }
    return {
        id, name, nameZh, value, unit,
        normalMin, normalMax, optimalValue,
        phase, phaseZh,
        deviationDirection,
        deviation: Math.round(deviation * 10) / 10,
        score: rangeScore(value, normalMin, normalMax, tolerance),
        clinicalNote, clinicalNoteZh,
    };
}

// ── Tennis Serve ───────────────────────────────────────────────────────────────

/** Shoulder–Elbow–Wrist angle at trophy position (~38–42% of motion) */
function serveElbowAngle(frames: PoseResult[], isRight: boolean): JointAngleMetric | null {
    const S = isRight ? LM.R_SHOULDER : LM.L_SHOULDER;
    const E = isRight ? LM.R_ELBOW : LM.L_ELBOW;
    const W = isRight ? LM.R_WRIST : LM.L_WRIST;
    const v = avgWindow(frames, 0.39, 0.08, (f) => {
        const s = getLm(f, S), e = getLm(f, E), w = getLm(f, W);
        return s && e && w ? angle2D(s, e, w) : null;
    });
    if (v === null) return null;
    return buildMetric(
        'serve_elbow_angle',
        'Serve Shoulder–Elbow Angle (Trophy)',
        '发球肩肘夹角（举拍位）',
        v, '°',
        75, 110, 92,
        'Trophy Position', '举拍位',
        'Optimal bend (75–110°) reduces rotator-cuff stress during internal rotation',
        '举拍位肘关节75–110°可有效降低内旋阶段的肩袖压力',
        18,
    );
}

/** Forearm angle from vertical at contact – proxy for swing-plane tilt */
function serveSwingPlaneTilt(frames: PoseResult[], isRight: boolean): JointAngleMetric | null {
    const E = isRight ? LM.R_ELBOW : LM.L_ELBOW;
    const W = isRight ? LM.R_WRIST : LM.L_WRIST;
    const v = avgWindow(frames, 0.63, 0.08, (f) => {
        const e = getLm(f, E), w = getLm(f, W);
        if (!e || !w) return null;
        const dx = Math.abs(w.x - e.x);
        const dy = Math.abs(e.y - w.y);
        return (Math.atan2(dx, dy) * 180) / Math.PI;
    });
    if (v === null) return null;
    return buildMetric(
        'serve_swing_plane',
        'Swing Plane Tilt (Contact)',
        '挥拍平面倾角（接触区）',
        v, '°',
        0, 30, 15,
        'Contact Zone', '接触区',
        'Near-vertical plane (0–30°) maximises racket-head speed toward the target',
        '趋近垂直的挥拍平面可最大化球拍向目标方向的加速度',
        15,
    );
}

/** Hip-line vs shoulder-line angle difference at contact – X-factor */
function hipShoulderDiff(frames: PoseResult[], tNorm: number): JointAngleMetric | null {
    const v = avgWindow(frames, tNorm, 0.10, (f) => {
        const ls = getLm(f, LM.L_SHOULDER), rs = getLm(f, LM.R_SHOULDER);
        const lh = getLm(f, LM.L_HIP), rh = getLm(f, LM.R_HIP);
        if (!ls || !rs || !lh || !rh) return null;
        const sA = Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180 / Math.PI;
        const hA = Math.atan2(rh.y - lh.y, rh.x - lh.x) * 180 / Math.PI;
        return Math.abs(sA - hA);
    });
    if (v === null) return null;
    return buildMetric(
        'hip_shoulder_diff',
        'Hip–Shoulder Rotation Gap',
        '髋肩旋转差值',
        v, '°',
        20, 50, 35,
        'Contact Zone', '接触区',
        'X-factor (20–50°) drives kinetic-chain power transfer',
        '髋肩分离角度（20–50°）是动力链能量传递的核心指标',
        15,
    );
}

/** Lateral CoG shift between preparation and contact */
function serveCogShift(frames: PoseResult[]): JointAngleMetric | null {
    const hipMidX = (f: PoseResult): number | null => {
        const lh = getLm(f, LM.L_HIP), rh = getLm(f, LM.R_HIP);
        return lh && rh ? (lh.x + rh.x) / 2 : null;
    };
    const shoulderWidth = (f: PoseResult): number | null => {
        const ls = getLm(f, LM.L_SHOULDER), rs = getLm(f, LM.R_SHOULDER);
        return ls && rs ? Math.abs(rs.x - ls.x) : null;
    };
    const fPrep = atNorm(frames, 0.20);
    const fCont = atNorm(frames, 0.63);
    if (!fPrep || !fCont) return null;
    const mx0 = hipMidX(fPrep), mx1 = hipMidX(fCont);
    const sw = shoulderWidth(fPrep);
    if (mx0 === null || mx1 === null || !sw || sw < 0.01) return null;
    const shiftPct = (Math.abs(mx1 - mx0) / sw) * 100;
    return buildMetric(
        'serve_cog_shift',
        'CoG Lateral Shift (Prep → Contact)',
        '下肢重心偏移幅度',
        shiftPct, '%',
        0, 20, 8,
        'Prep → Contact', '引拍至接触区',
        'Excessive lateral shift (>20% shoulder width) reduces serve consistency',
        '重心横向偏移超过肩宽20%会明显降低发球稳定性',
        12,
    );
}

// ── Tennis Groundstroke ────────────────────────────────────────────────────────

/** Hitting-arm elbow angle at contact */
function groundstrokeElbow(
    frames: PoseResult[],
    isRight: boolean,
    isBackhand: boolean,
): JointAngleMetric | null {
    const S = isRight ? LM.R_SHOULDER : LM.L_SHOULDER;
    const E = isRight ? LM.R_ELBOW : LM.L_ELBOW;
    const W = isRight ? LM.R_WRIST : LM.L_WRIST;
    const v = avgWindow(frames, 0.60, 0.10, (f) => {
        const s = getLm(f, S), e = getLm(f, E), w = getLm(f, W);
        return s && e && w ? angle2D(s, e, w) : null;
    });
    if (v === null) return null;
    const [nMin, nMax, opt] = isBackhand ? [145, 178, 162] : [125, 158, 140];
    return buildMetric(
        'groundstroke_elbow',
        `${isBackhand ? 'Backhand' : 'Forehand'} Elbow Angle (Contact)`,
        `${isBackhand ? '反手' : '正手'}肘关节接触角`,
        v, '°',
        nMin, nMax, opt,
        'Contact', '接触点',
        isBackhand
            ? 'Over-extended elbow (>178°) concentrates stress on the lateral epicondyle'
            : 'Optimal bend (125–158°) absorbs impact and improves shot control',
        isBackhand
            ? '反手肘关节过度伸展会将应力集中于肱骨外上髁，网球肘高危因素'
            : '肘关节适度弯曲（125–158°）可吸收冲击力，提升控球稳定性',
        18,
    );
}

/** Minimum knee bend angle during the loading phase */
function kneeBend(
    frames: PoseResult[],
    startT: number,
    endT: number,
    normalMin: number,
    normalMax: number,
    id: string,
    label: string,
    labelZh: string,
    noteZh: string,
): JointAngleMetric | null {
    const pairs = [
        [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
        [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
    ] as const;
    const lo = Math.floor(startT * (frames.length - 1));
    const hi = Math.ceil(endT * (frames.length - 1));
    let minAngle: number | null = null;
    for (let i = lo; i <= hi; i++) {
        for (const [h, k, a] of pairs) {
            const H = getLm(frames[i], h), K = getLm(frames[i], k), A = getLm(frames[i], a);
            if (!H || !K || !A) continue;
            const ang = angle2D(H, K, A);
            if (minAngle === null || ang < minAngle) minAngle = ang;
        }
    }
    if (minAngle === null) return null;
    const opt = (normalMin + normalMax) / 2;
    return buildMetric(
        id, label, labelZh,
        minAngle, '°',
        normalMin, normalMax, opt,
        'Loading Phase', '蓄力阶段',
        `Knee bend ${normalMin}–${normalMax}° lowers CoG and loads leg drive`,
        noteZh,
        15,
    );
}

// ── Force-Sequence (Kinetic Chain) ────────────────────────────────────────────

export function calcForceSequence(frames: PoseResult[], isRight: boolean): ForceSequenceResult {
    const empty = (msg: string): ForceSequenceResult => ({
        sequenceCorrect: true, trunkToArmLagMs: 80, pushoffToTrunkLagMs: 60,
        problems: [], chainScore: 70,
        description: 'Insufficient frames — kinetic chain analysis skipped',
        descriptionZh: msg,
        tip: 'Upload a longer video for accurate kinetic chain analysis',
        tipZh: '提供更长的视频可获得精准的发力时序分析',
    });
    if (frames.length < 12) return empty('帧数不足，发力时序分析已跳过');

    const W = isRight ? LM.R_WRIST : LM.L_WRIST;
    const HK = isRight
        ? [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE] as const
        : [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE] as const;

    const trunkVel: number[] = [];
    const wristVel: number[] = [];
    const kneeVel: number[] = [];

    for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1], cur = frames[i];
        const dt = Math.max(0.001, (cur.timestamp - prev.timestamp) / 1000);

        // Trunk angular velocity (X-factor change rate)
        const lsP = getLm(prev, LM.L_SHOULDER), rsP = getLm(prev, LM.R_SHOULDER);
        const lhP = getLm(prev, LM.L_HIP), rhP = getLm(prev, LM.R_HIP);
        const lsC = getLm(cur, LM.L_SHOULDER), rsC = getLm(cur, LM.R_SHOULDER);
        const lhC = getLm(cur, LM.L_HIP), rhC = getLm(cur, LM.R_HIP);
        if (lsP && rsP && lhP && rhP && lsC && rsC && lhC && rhC) {
            const sepP = Math.abs(
                Math.atan2(rsP.y - lsP.y, rsP.x - lsP.x) -
                Math.atan2(rhP.y - lhP.y, rhP.x - lhP.x),
            ) * 180 / Math.PI;
            const sepC = Math.abs(
                Math.atan2(rsC.y - lsC.y, rsC.x - lsC.x) -
                Math.atan2(rhC.y - lhC.y, rhC.x - lhC.x),
            ) * 180 / Math.PI;
            trunkVel.push(Math.abs(sepC - sepP) / dt);
        } else {
            trunkVel.push(0);
        }

        // Wrist linear velocity
        const wP = getLm(prev, W), wC = getLm(cur, W);
        wristVel.push(wP && wC ? Math.hypot(wC.x - wP.x, wC.y - wP.y) / dt : 0);

        // Knee flexion velocity (|Δangle / dt|)
        const HP = getLm(prev, HK[0]), KP = getLm(prev, HK[1]), AP = getLm(prev, HK[2]);
        const HC = getLm(cur, HK[0]), KC = getLm(cur, HK[1]), AC = getLm(cur, HK[2]);
        kneeVel.push(
            HP && KP && AP && HC && KC && AC
                ? Math.abs(angle2D(HP, KP, AP) - angle2D(HC, KC, AC)) / dt
                : 0,
        );
    }

    // Peak indices in the action window (25–80%)
    const lo = Math.floor(0.25 * trunkVel.length);
    const hi = Math.ceil(0.80 * trunkVel.length);
    const peakIdx = (arr: number[]) => {
        let maxV = -Infinity, idx = lo;
        for (let i = lo; i <= Math.min(hi, arr.length - 1); i++) {
            if (arr[i] > maxV) { maxV = arr[i]; idx = i; }
        }
        return idx;
    };
    const iT = peakIdx(trunkVel);
    const iW = peakIdx(wristVel);
    const iK = peakIdx(kneeVel);

    const ts = (i: number) => frames[Math.min(i, frames.length - 1)].timestamp;
    const trunkMs = ts(iT), wristMs = ts(iW), kneeMs = ts(iK);

    const trunkToArmLag = wristMs - trunkMs;  // positive → trunk first (good)
    const pushoffToTrunk = trunkMs - kneeMs;  // positive → knee first  (good)

    const problems: ForceSequenceProblem[] = [];
    if (trunkToArmLag < -50) problems.push('ARM_LEADS_TRUNK');
    if (trunkToArmLag > 450) problems.push('LATE_ARM');
    if (pushoffToTrunk < -50) problems.push('TRUNK_LEADS_PUSHOFF');
    if (Math.max(...kneeVel.slice(lo, hi + 1)) < 4) problems.push('INSUFFICIENT_PUSHOFF');

    let chainScore = 90;
    if (problems.includes('ARM_LEADS_TRUNK')) chainScore -= 30;
    if (problems.includes('TRUNK_LEADS_PUSHOFF')) chainScore -= 20;
    if (problems.includes('LATE_ARM')) chainScore -= 15;
    if (problems.includes('INSUFFICIENT_PUSHOFF')) chainScore -= 15;
    chainScore = Math.max(0, chainScore);

    const problemDescMap: Record<ForceSequenceProblem, string> = {
        ARM_LEADS_TRUNK: '手臂抢先于躯干发力（上肢代偿）',
        TRUNK_LEADS_PUSHOFF: '转体未等蹬地完成',
        LATE_ARM: '手臂跟进明显滞后',
        INSUFFICIENT_PUSHOFF: '蹬地发力不明显',
    };
    const tipMap: Record<ForceSequenceProblem, string> = {
        ARM_LEADS_TRUNK: '专注"先转髋再挥拍"的肌肉记忆，避免手臂提前单独发力',
        TRUNK_LEADS_PUSHOFF: '击球前先深蹲蓄力，感受脚跟蹬地再带动身体旋转',
        LATE_ARM: '身体旋转到位后立即加速挥臂，不要迟疑或停顿',
        INSUFFICIENT_PUSHOFF: '增加屈膝深度，击球时用脚跟蹬地将能量由下往上传递',
    };
    const problemDescMapEn: Record<ForceSequenceProblem, string> = {
        ARM_LEADS_TRUNK: 'arm compensates before trunk rotation',
        TRUNK_LEADS_PUSHOFF: 'trunk rotates before push-off is complete',
        LATE_ARM: 'arm follow-through is significantly delayed',
        INSUFFICIENT_PUSHOFF: 'push-off force is insufficient',
    };
    const tipMapEn: Record<ForceSequenceProblem, string> = {
        ARM_LEADS_TRUNK: 'Focus on "rotate hips before swinging" to avoid the arm leading prematurely',
        TRUNK_LEADS_PUSHOFF: 'Load your legs first — feel the heel drive before rotating your torso',
        LATE_ARM: 'Once your body has rotated, accelerate the arm immediately without hesitation',
        INSUFFICIENT_PUSHOFF: 'Increase knee bend depth and drive through the heel to transfer energy upward',
    };

    const descriptionZh = problems.length === 0
        ? '发力时序正确：蹬地 → 转体 → 挥拍，动力链衔接流畅'
        : `发力时序问题：${problems.map(p => problemDescMap[p]).join('；')}`;
    const tipZh = problems.length > 0 ? tipMap[problems[0]] : '保持当前节奏，强化蹬地转体的协调性';
    const description = problems.length === 0
        ? 'Kinetic chain correct: push-off → rotation → swing, seamless energy transfer'
        : `Kinetic chain issues: ${problems.map(p => problemDescMapEn[p]).join('; ')}`;
    const tip = problems.length > 0 ? tipMapEn[problems[0]] : 'Maintain current rhythm; reinforce push-off and rotation coordination';

    return {
        sequenceCorrect: problems.length === 0,
        trunkToArmLagMs: Math.round(trunkToArmLag),
        pushoffToTrunkLagMs: Math.round(pushoffToTrunk),
        problems, chainScore, description, descriptionZh, tip, tipZh,
    };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function calcTennisServeMetrics(
    frames: PoseResult[],
    isRight: boolean,
): JointAngleMetric[] {
    return [
        serveElbowAngle(frames, isRight),
        serveSwingPlaneTilt(frames, isRight),
        hipShoulderDiff(frames, 0.55),
        serveCogShift(frames),
    ].filter((m): m is JointAngleMetric => m !== null);
}

export function calcTennisGroundstrokeMetrics(
    frames: PoseResult[],
    isRight: boolean,
    isBackhand: boolean,
): JointAngleMetric[] {
    return [
        groundstrokeElbow(frames, isRight, isBackhand),
        hipShoulderDiff(frames, 0.55),
        kneeBend(
            frames, 0.25, 0.65, 115, 148,
            'groundstroke_knee_bend',
            'Knee Bend Depth',
            '屈膝蹲伏角度',
            '充分屈膝（115–148°）降低重心，提升横向移动能力与下肢蓄力',
        ),
    ].filter((m): m is JointAngleMetric => m !== null);
}

