/**
 * calibration/classifier.ts
 * k-NN classifier for pose phase prediction.
 * SRP: No storage, no phase sequencing — only feature distance & voting.
 */

import { PoseResult } from '../MotionAnalysisRouter';
import { CalibrationExample, PhaseType, PoseFeatures, StrokeType } from './types';
import { extractFeatures } from './featureExtractor';

// Feature weights for distance calculation.
// ARM ANGLES are primary; wrist Y (vertical) is camera-invariant and
// discriminates Unit Turn vs Racket Drop even in pure 2D.
export const featureWeights: Record<keyof PoseFeatures, number> = {
    rightElbowAngle: 3.0,
    leftElbowAngle: 2.0,
    rightShoulderAngle: 3.0,
    leftShoulderAngle: 2.0,
    rightWristRelX: 0.0,   // camera-dependent
    rightWristRelY: 1.0,   // camera-invariant vertical
    rightWristRelZ: 0.0,   // YOLO z unreliable
    leftWristRelX: 0.0,
    leftWristRelY: 0.6,
    leftWristRelZ: 0.0,
    trunkRotation: 0.5,    // 2D collapses from front/back cameras
    rightKneeAngle: 0.0,
    leftKneeAngle: 0.0,
    bodyLeanX: 0.0,
    bodyLeanZ: 0.0,
    rightWristVelocity: 0.5,
    leftWristVelocity: 0.3,
};

const ANGLE_NORM = 180;
const POS_NORM = 1.0;
const VEL_NORM = 0.5;

function getNorm(key: keyof PoseFeatures): number {
    if (key.includes('Angle') || key === 'trunkRotation') return ANGLE_NORM;
    if (key.includes('Velocity')) return VEL_NORM;
    return POS_NORM;
}

/** Weighted Euclidean distance between two feature vectors */
export function featureDistance(a: PoseFeatures, b: PoseFeatures): number {
    let sumSq = 0;
    for (const key of Object.keys(a) as (keyof PoseFeatures)[]) {
        const norm = getNorm(key);
        const weight = featureWeights[key] || 1;
        const diff = ((a[key] || 0) - (b[key] || 0)) / norm;
        sumSq += weight * diff * diff;
    }
    return Math.sqrt(sumSq);
}

/**
 * Classify a pose using k-NN on calibrated examples.
 * Takes examples directly (no storage dependency).
 */
export function classifyPose(
    examples: CalibrationExample[],
    pose: PoseResult,
    prevPose?: PoseResult,
    k = 3
): { phase: PhaseType; confidence: number; distances: { phase: PhaseType; distance: number }[] } | null {
    if (examples.length < k) return null;

    const queryFeatures = extractFeatures(pose, prevPose);
    const distances = examples.map(ex => ({
        phase: ex.phase,
        distance: featureDistance(queryFeatures, ex.features),
    }));
    distances.sort((a, b) => a.distance - b.distance);

    const kNearest = distances.slice(0, k);
    const votes: Record<string, number> = {};
    for (const neighbor of kNearest) {
        const weight = 1 / (neighbor.distance + 0.001);
        votes[neighbor.phase] = (votes[neighbor.phase] || 0) + weight;
    }

    let bestPhase = kNearest[0].phase;
    let bestVotes = 0;
    let totalVotes = 0;
    for (const [phase, voteCount] of Object.entries(votes)) {
        totalVotes += voteCount;
        if (voteCount > bestVotes) {
            bestVotes = voteCount;
            bestPhase = phase as PhaseType;
        }
    }

    return {
        phase: bestPhase,
        confidence: totalVotes > 0 ? bestVotes / totalVotes : 0,
        distances: kNearest,
    };
}

/**
 * Minimum feature distance from a pose to any example of a target phase.
 * Takes examples directly (no storage dependency).
 */
export function distanceToPhase(
    examples: CalibrationExample[],
    pose: PoseResult,
    targetPhase: PhaseType,
    prevPose?: PoseResult
): number {
    const phaseExamples = examples.filter(e => e.phase === targetPhase);
    if (phaseExamples.length === 0) return Infinity;

    const queryFeatures = extractFeatures(pose, prevPose);
    if (queryFeatures.rightElbowAngle === 0 && queryFeatures.leftElbowAngle === 0) return Infinity;

    let minDist = Infinity;
    for (const ex of phaseExamples) {
        const d = featureDistance(queryFeatures, ex.features);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/**
 * Diagnostics: check if reference examples per phase are distinct enough.
 * Returns reliable=true only if no two phases have near-identical feature vectors.
 */
export function getReferenceCalibrationDiagnostics(
    phaseReps: CalibrationExample[]
): {
    reliable: boolean;
    minPhaseDistance: number;
    duplicatePairs: Array<{ a: PhaseType; b: PhaseType; distance: number }>;
} {
    const DUPLICATE_EPS = 0.01;
    let minPhaseDistance = Infinity;
    const duplicatePairs: Array<{ a: PhaseType; b: PhaseType; distance: number }> = [];

    for (let i = 0; i < phaseReps.length; i++) {
        for (let j = i + 1; j < phaseReps.length; j++) {
            const d = featureDistance(phaseReps[i].features, phaseReps[j].features);
            minPhaseDistance = Math.min(minPhaseDistance, d);
            if (d <= DUPLICATE_EPS) {
                duplicatePairs.push({ a: phaseReps[i].phase, b: phaseReps[j].phase, distance: d });
            }
        }
    }

    return {
        reliable: duplicatePairs.length === 0,
        minPhaseDistance: Number.isFinite(minPhaseDistance) ? minPhaseDistance : 0,
        duplicatePairs,
    };
}
