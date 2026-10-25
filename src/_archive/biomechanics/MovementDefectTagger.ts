/**
 * MovementDefectTagger
 *
 * Maps computed JointAngleMetric values + ForceSequenceResult to
 * standardised DefectTag labels. Pure function – no side effects.
 *
 * Thresholds are tuned to flag deviations that are clinically meaningful
 * (i.e. outside the normal range defined in BiomechanicalCalculator),
 * rather than firing on every minor deviation.
 */

import type { JointAngleMetric, DefectTag, ForceSequenceResult } from './types';

// Helper: find a metric by id
const g = (metrics: JointAngleMetric[], id: string) => metrics.find(m => m.id === id);

/**
 * Returns an array of unique DefectTags based on the joint-angle data
 * and force-sequence results for the given tennis skill.
 */
export function tagDefects(
    metrics: JointAngleMetric[],
    forceSeq: ForceSequenceResult,
    sport: 'tennis',
    skillCategory: 'serve' | 'forehand' | 'backhand' | 'other',
): DefectTag[] {
    const tags = new Set<DefectTag>();

    // ── Tennis Serve ─────────────────────────────────────────────────────────────
    if (skillCategory === 'serve') {
        const elbow = g(metrics, 'serve_elbow_angle');
        const swing = g(metrics, 'serve_swing_plane');
        const hip = g(metrics, 'hip_shoulder_diff');
        const cog = g(metrics, 'serve_cog_shift');

        if (elbow && elbow.value > 112) tags.add('SERVE_ELBOW_HIGH');
        if (hip && hip.value < 18) tags.add('INSUFFICIENT_ROTATION');
        if (hip && hip.value < 25) tags.add('POOR_HIP_ROTATION');
        if (swing && swing.value > 32) tags.add('KINETIC_CHAIN_BREAK');
        if (cog && cog.value > 22) tags.add('DELAYED_WEIGHT_TRANSFER');
    }

    // ── Tennis Groundstroke ───────────────────────────────────────────────────────
    if (skillCategory === 'forehand' || skillCategory === 'backhand') {
        const elbow = g(metrics, 'groundstroke_elbow');
        const hip = g(metrics, 'hip_shoulder_diff');
        const knee = g(metrics, 'groundstroke_knee_bend');

        if (elbow) {
            if (elbow.value > 165) tags.add('LOCKED_ELBOW');
            if (skillCategory === 'backhand' && elbow.value > 172) tags.add('RIGID_WRIST_BACKHAND');
        }
        if (hip && hip.value < 22) tags.add('INSUFFICIENT_ROTATION');
        if (hip && hip.value < 28) tags.add('POOR_HIP_ROTATION');
        if (knee && knee.value > 155) tags.add('HIGH_COG');
        if (knee && knee.value > 150) tags.add('INSUFFICIENT_KNEE_BEND');
    }

    // ── Force Sequence ────────────────────────────────────────────────────────────
    if (forceSeq.problems.includes('ARM_LEADS_TRUNK')) tags.add('ARM_COMPENSATION');
    if (forceSeq.problems.includes('TRUNK_LEADS_PUSHOFF')) tags.add('DELAYED_WEIGHT_TRANSFER');
    if (forceSeq.problems.includes('LATE_ARM')) tags.add('KINETIC_CHAIN_BREAK');

    return Array.from(tags);
}

// ── Display label map ─────────────────────────────────────────────────────────

export const DEFECT_LABELS: Record<DefectTag, {
    label: string;
    bodyPart: string;
    desc: string;
    labelZh: string;
    bodyPartZh: string;
    descZh: string;
}> = {
    EXCESSIVE_BACKSWING: {
        label: 'Excessive backswing', bodyPart: 'Shoulder / back',
        desc: 'Backswing amplitude exceeds normal range, making recovery harder and increasing shoulder/lumbar load',
        labelZh: '引拍过大',
        bodyPartZh: '肩部/背部',
        descZh: '引拍幅度超出正常范围，加大了回位难度并增加腰肩负荷',
    },
    LOCKED_ELBOW: {
        label: 'Locked elbow', bodyPart: 'Elbow / forearm',
        desc: 'Elbow nearly fully extended at contact, channeling impact stress directly to the lateral epicondyle',
        labelZh: '肘关节锁死',
        bodyPartZh: '肘部/前臂',
        descZh: '接触时肘关节几乎完全伸直，将冲击应力直接传导至肱骨外上髁',
    },
    HIGH_COG: {
        label: 'High center of gravity', bodyPart: 'Knee / lower limb',
        desc: 'Insufficient knee flexion raises the center of mass, reducing lateral-movement speed and increasing knee shear stress',
        labelZh: '重心偏高',
        bodyPartZh: '膝关节/下肢',
        descZh: '屈膝角度不足导致重心过高，降低侧向移动速度并增加膝部剪切应力',
    },
    WRIST_INSTABILITY: {
        label: 'Wrist instability', bodyPart: 'Wrist joint',
        desc: 'Unstable wrist angle in the contact zone scatters ball direction and elevates tenosynovitis risk',
        labelZh: '手腕晃动',
        bodyPartZh: '腕关节',
        descZh: '接触区手腕角度不稳定，造成击球方向离散并加剧腱鞘炎风险',
    },
    ARM_COMPENSATION: {
        label: 'Arm compensation', bodyPart: 'Shoulder / elbow',
        desc: 'Arm rotates before the torso, bypassing the kinetic chain and overloading the shoulder and elbow',
        labelZh: '上肢代偿发力',
        bodyPartZh: '肩部/肘部',
        descZh: '手臂先于躯干旋转发力，绕过了核心动力链，增加肩肘局部负荷',
    },
    DELAYED_WEIGHT_TRANSFER: {
        label: 'Delayed weight transfer', bodyPart: 'Hip / lower limb',
        desc: 'Weight transfer lags noticeably after push-off, breaking the kinetic chain and reducing power',
        labelZh: '重心滞后',
        bodyPartZh: '髋部/下肢',
        descZh: '蹬地后重心转移明显滞后，动力链出现断节，降低发力效率',
    },
    KINETIC_CHAIN_BREAK: {
        label: 'Kinetic chain break', bodyPart: 'Full body',
        desc: 'The push-off → rotation → swing sequence shows a clear timing mismatch, causing energy loss',
        labelZh: '发力脱节',
        bodyPartZh: '全身动力链',
        descZh: '蹬地→转体→挥拍的发力时序出现明显错位，导致能量损耗',
    },
    INSUFFICIENT_ROTATION: {
        label: 'Insufficient rotation', bodyPart: 'Torso / hip',
        desc: 'Hip-shoulder separation is too small, reducing core contribution and forcing the arm to compensate',
        labelZh: '转体不足',
        bodyPartZh: '躯干/髋部',
        descZh: '髋肩旋转幅度不够，减少了核心参与度并增加手臂单独发力比例',
    },
    SERVE_ELBOW_HIGH: {
        label: 'High elbow serve', bodyPart: 'Shoulder joint',
        desc: 'Elbow angle at trophy position is too large; the rotator cuff bears extra shear load in extreme external rotation',
        labelZh: '高肘发球',
        bodyPartZh: '肩关节',
        descZh: '举拍位肘关节角度过大，肩袖在极度外旋位承受额外剪切负荷',
    },
    RIGID_WRIST_BACKHAND: {
        label: 'Rigid wrist (backhand)', bodyPart: 'Wrist / forearm',
        desc: 'Excessive wrist fixation on backhand contact causes repetitive eccentric traction on the forearm extensors',
        labelZh: '反手手腕僵硬',
        bodyPartZh: '腕关节/前臂',
        descZh: '反手接触时手腕固定度过高，前臂伸肌腱长期承受冲击性牵拉',
    },
    INSUFFICIENT_KNEE_BEND: {
        label: 'Insufficient knee bend', bodyPart: 'Knee joint',
        desc: 'Limited knee flexion prevents adequate elastic energy storage and reduces hitting stability',
        labelZh: '屈膝不足',
        bodyPartZh: '膝关节',
        descZh: '屈膝幅度不足以充分蓄积下肢弹性能，同时降低了击球重心稳定性',
    },
    EXCESSIVE_LATERAL_TILT: {
        label: 'Excessive lateral tilt', bodyPart: 'Lower back / hip',
        desc: 'Excessive body lean on wide shots increases lumbar rotation stress and disrupts recovery balance',
        labelZh: '过度侧倾',
        bodyPartZh: '腰背/髋部',
        descZh: '跨步击球时身体过度侧倾，加大腰椎旋转压力并影响回位平衡',
    },
    POOR_HIP_ROTATION: {
        label: 'Poor hip rotation', bodyPart: 'Hip / core',
        desc: 'Reduced hip rotation angle limits core power output, forcing the arm to compensate',
        labelZh: '髋部转动不足',
        bodyPartZh: '髋关节/核心',
        descZh: '髋部旋转角度偏小，核心能量输出受限，手臂被迫额外补偿发力',
    },
};
