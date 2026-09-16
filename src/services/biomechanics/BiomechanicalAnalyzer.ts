/**
 * BiomechanicalAnalyzer
 *
 * Top-level coordinator for the biomechanical analysis pipeline:
 *   1. Detect handedness from pose frame data
 *   2. Compute sport-specific joint-angle metrics
 *   3. Analyse force-sequence (kinetic chain) timing
 *   4. Tag movement defects
 *   5. Classify injury risks
 *   6. Bundle everything into BiomechanicalAnalysisResult
 */

import type { PoseResult } from '../motionAnalysis/BaseMotionAnalysis';
import type { BiomechanicalAnalysisResult } from './types';
import {
    calcTennisServeMetrics,
    calcTennisGroundstrokeMetrics,
    calcForceSequence,
} from './BiomechanicalCalculator';
import { tagDefects } from './MovementDefectTagger';
import { classifyInjuryRisks } from './InjuryRiskEngine';

// ── Helpers ────────────────────────────────────────────────────────────────────

function containsAny(s: string, ...keys: string[]): boolean {
    return keys.some(k => s.includes(k));
}

/**
 * Heuristic: the hitting arm has higher peak wrist speed.
 * Compares right wrist (idx 16) vs left wrist (idx 15) peak velocity.
 * Falls back to right-handed if data is insufficient.
 */
function detectHandedness(frames: PoseResult[]): boolean {
    if (!frames.length) return true;
    const peakSpeed = (idx: number): number => {
        let max = 0;
        for (let i = 1; i < frames.length; i++) {
            const a = frames[i - 1].landmarks?.[idx];
            const b = frames[i].landmarks?.[idx];
            if (!a || !b) continue;
            const dt = Math.max(0.001, (frames[i].timestamp - frames[i - 1].timestamp) / 1000);
            const spd = Math.hypot(b.x - a.x, b.y - a.y) / dt;
            if (spd > max) max = spd;
        }
        return max;
    };
    return peakSpeed(16) >= peakSpeed(15); // right wrist faster → right-handed
}

/** Map a SkillType string to the simplified category used by the defect tagger */
function skillCategory(
    skillType: string,
): 'serve' | 'forehand' | 'backhand' | 'other' {
    const s = skillType.toLowerCase();
    if (containsAny(s, 'serve')) return 'serve';
    if (containsAny(s, 'backhand')) return 'backhand';
    if (containsAny(s, 'forehand', 'dink', 'drive', 'drop', 'lob', 'volley', 'smash', 'overhead'))
        return 'forehand';
    return 'other';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Run the full biomechanical analysis pipeline on user pose frames.
 *
 * @param frames           User's pose frames (MediaPipe output)
 * @param sport            Tennis sport identifier
 * @param skillType        E.g. 'serve', 'forehand', or 'backhand'
 * @param isRightOverride  Optional handedness override (auto-detected if omitted)
 */
export function analyzeBiomechanics(
    frames: PoseResult[],
    sport: 'tennis',
    skillType: string,
    isRightOverride?: boolean,
): BiomechanicalAnalysisResult {
    if (!frames.length) return makeEmpty(sport, skillType);

    const isRightHanded = isRightOverride ?? detectHandedness(frames);
    const cat = skillCategory(skillType);

    // ── 1. Joint-angle metrics ──────────────────────────────────────────────────
    let jointAngles;
    if (cat === 'serve') {
        jointAngles = calcTennisServeMetrics(frames, isRightHanded);
    } else {
        jointAngles = calcTennisGroundstrokeMetrics(frames, isRightHanded, cat === 'backhand');
    }

    // ── 2. Force sequence ───────────────────────────────────────────────────────
    const forceSequence = calcForceSequence(frames, isRightHanded);

    // ── 3. Defect tags ──────────────────────────────────────────────────────────
    const defectTags = tagDefects(jointAngles, forceSequence, sport, cat);

    // ── 4. Injury risks ─────────────────────────────────────────────────────────
    const injuryRisks = classifyInjuryRisks(defectTags);

    // ── 5. Overall score ────────────────────────────────────────────────────────
    const avgAngle = jointAngles.length
        ? jointAngles.reduce((s, m) => s + m.score, 0) / jointAngles.length
        : 70;
    const biomechanicalScore = Math.round(avgAngle * 0.6 + forceSequence.chainScore * 0.4);

    // ── 6. Summary strings ──────────────────────────────────────────────────────
    const highRiskCount = injuryRisks.filter(r => r.riskLevel === 'high').length;
    const mediumRiskCount = injuryRisks.filter(r => r.riskLevel === 'medium').length;

    let summaryZh: string;
    let summary: string;
    if (highRiskCount > 0) {
        const topInjury = injuryRisks.find(r => r.riskLevel === 'high')!;
        summaryZh = `检测到 ${highRiskCount} 项高风险动作缺陷，建议立即矫正 ${topInjury.bodyPartZh} 姿势，降低${topInjury.nameZh}风险。`;
        summary = `${highRiskCount} high-risk movement defect${highRiskCount > 1 ? 's' : ''} detected. Correct your ${topInjury.bodyPart} mechanics immediately to reduce ${topInjury.name} risk.`;
    } else if (mediumRiskCount > 0) {
        summaryZh = `检测到 ${mediumRiskCount} 项中风险动作问题，长期重复可能引发${injuryRisks[0].nameZh}，建议加强防护意识。`;
        summary = `${mediumRiskCount} medium-risk movement issue${mediumRiskCount > 1 ? 's' : ''} detected. Repeated patterns may lead to ${injuryRisks[0].name}; improve your injury prevention habits.`;
    } else if (defectTags.length > 0) {
        summaryZh = `动作整体规范，存在 ${defectTags.length} 项技术细节待改善，当前伤病风险较低。`;
        summary = `Overall technique is solid with ${defectTags.length} technical detail${defectTags.length > 1 ? 's' : ''} to refine; current injury risk is low.`;
    } else {
        summaryZh = '动作生物力学评估良好，发力链路顺畅，未检测到明显伤病风险。';
        summary = 'Biomechanical assessment is excellent — clean kinetic chain, no significant injury risk detected.';
    }

    return {
        sport, skillType, isRightHanded,
        jointAngles, forceSequence,
        defectTags, injuryRisks,
        biomechanicalScore, summary, summaryZh,
        highRiskCount, mediumRiskCount,
    };
}

function makeEmpty(
    sport: 'tennis',
    skillType: string,
): BiomechanicalAnalysisResult {
    return {
        sport, skillType, isRightHanded: true,
        jointAngles: [],
        forceSequence: {
            sequenceCorrect: true,
            trunkToArmLagMs: 0,
            pushoffToTrunkLagMs: 0,
            problems: [],
            chainScore: 70,
            description: 'Insufficient pose data — kinetic chain analysis skipped',
            descriptionZh: '姿态数据不足，发力时序分析已跳过',
            tip: 'Upload a longer video for accurate biomechanical analysis',
            tipZh: '请上传更长的视频以获得精准的生物力学分析',
        },
        defectTags: [],
        injuryRisks: [],
        biomechanicalScore: 0,
        summary: 'Insufficient pose data — unable to generate biomechanical analysis',
        summaryZh: '姿态数据不足，无法生成生物力学分析',
        highRiskCount: 0,
        mediumRiskCount: 0,
    };
}
