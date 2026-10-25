/**
 * Biomechanics Analysis – Shared Types
 *
 * Covers:
 *  - Joint angle metrics with industry-standard range comparison
 *  - Movement defect tags (auto-labelled from computed metrics)
 *  - Injury risk classification (3-level: low / medium / high)
 *  - Force-sequence (kinetic chain) analysis
 *  - Top-level result bag returned by BiomechanicalAnalyzer
 */

export type RiskLevel = 'low' | 'medium' | 'high';

/** One biomechanical measurement at a specific phase */
export interface JointAngleMetric {
    id: string;
    name: string;
    nameZh: string;
    value: number;           // measured value
    unit: string;            // '°' | '%'
    normalMin: number;       // lower bound of clinically normal range
    normalMax: number;       // upper bound of clinically normal range
    optimalValue: number;    // single ideal target
    phase: string;           // phase where measured (English)
    phaseZh: string;
    deviationDirection: 'too_high' | 'too_low' | 'normal';
    deviation: number;       // absolute distance from nearest range boundary (0 = within range)
    score: number;           // 0–100 quality score
    clinicalNote: string;
    clinicalNoteZh: string;
}

/** Movement defect tags – Chinese labels defined in MovementDefectTagger */
export type DefectTag =
    | 'EXCESSIVE_BACKSWING'      // 引拍过大
    | 'LOCKED_ELBOW'             // 肘关节锁死
    | 'HIGH_COG'                 // 重心偏高
    | 'WRIST_INSTABILITY'        // 手腕晃动
    | 'ARM_COMPENSATION'         // 上肢代偿发力
    | 'DELAYED_WEIGHT_TRANSFER'  // 重心滞后
    | 'KINETIC_CHAIN_BREAK'      // 发力脱节
    | 'INSUFFICIENT_ROTATION'    // 转体不足
    | 'SERVE_ELBOW_HIGH'         // 高肘发球
    | 'RIGID_WRIST_BACKHAND'     // 反手手腕僵硬
    | 'INSUFFICIENT_KNEE_BEND'   // 屈膝不足
    | 'EXCESSIVE_LATERAL_TILT'   // 过度侧倾
    | 'POOR_HIP_ROTATION';       // 髋部转动不足

/** High-frequency sports injuries tracked by the knowledge base */
export type InjuryType =
    | 'TENNIS_ELBOW'             // 网球肘
    | 'ROTATOR_CUFF'             // 肩袖劳损
    | 'MEDIAL_KNEE'              // 膝关节内侧损伤
    | 'LOWER_BACK'               // 腰背拉伤
    | 'WRIST_TENDINITIS'         // 腕关节腱鞘炎
    | 'SHOULDER_IMPINGEMENT';    // 肩峰撞击综合征

/** A specific injury risk identified for the user */
export interface InjuryRisk {
    injuryType: InjuryType;
    name: string;
    nameZh: string;
    riskLevel: RiskLevel;
    bodyPart: string;
    bodyPartZh: string;
    triggerDefects: DefectTag[];
    mechanism: string;
    mechanismZh: string;
    prevention: string[];
    preventionZh: string[];
}

export type ForceSequenceProblem =
    | 'ARM_LEADS_TRUNK'       // 上肢代偿发力（手臂早于躯干）
    | 'TRUNK_LEADS_PUSHOFF'   // 未蹬地直接转体
    | 'LATE_ARM'              // 手臂跟进太慢
    | 'INSUFFICIENT_PUSHOFF'; // 蹬地不明显

/** Result of kinetic-chain timing analysis */
export interface ForceSequenceResult {
    sequenceCorrect: boolean;
    trunkToArmLagMs: number;      // ms; positive = trunk leads arm (correct order)
    pushoffToTrunkLagMs: number;  // ms; positive = knee-push before trunk rotation (correct)
    problems: ForceSequenceProblem[];
    chainScore: number;           // 0–100
    description: string;
    descriptionZh: string;
    tip: string;
    tipZh: string;
}

/** Full output of the biomechanical analysis pipeline */
export interface BiomechanicalAnalysisResult {
    sport: 'tennis';
    skillType: string;
    isRightHanded: boolean;
    jointAngles: JointAngleMetric[];
    forceSequence: ForceSequenceResult;
    defectTags: DefectTag[];
    injuryRisks: InjuryRisk[];
    biomechanicalScore: number;  // 0–100 overall
    summary: string;
    summaryZh: string;
    highRiskCount: number;
    mediumRiskCount: number;
}
