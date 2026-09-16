/**
 * Tennis Motion Analysis - Shared Types
 *
 * All exported interfaces used across tennis stroke analysis modules.
 * Import from here to keep stroke files clean of type definitions.
 */

import type { StrokeType } from '../../CalibrationService';

export type { StrokeType };

/** Result of a single frame overlay comparison - metrics that AI can explain */
export interface FrameComparisonResult {
    frameIndex: number;
    userTimestamp: number;
    refTimestamp: number;

    // Per-joint differences (normalized 0-1 scale)
    jointDifferences: {
        jointName: string;
        jointIndex: number;
        difference: number;        // 0 = identical, 1 = very different
        userPosition: { x: number; y: number; z: number };
        refPosition: { x: number; y: number; z: number };
        description: string;       // "Elbow is 15cm lower than reference"
    }[];

    // Overall frame similarity (0-1, higher = more similar)
    overallSimilarity: number;

    // Frame images for visual comparison
    userFrameImage?: string;
    refFrameImage?: string;
}

/** Overlay comparison result with AI-ready metrics */
export interface OverlayComparisonResult {
    alignedFrames: FrameComparisonResult[];
    topIssues: {
        jointName: string;
        avgDifference: number;
        worstFrame: number;
        description: string;
    }[];
    differenceTimeline: { timestamp: number; similarity: number }[];
    aiPrompt: string;
}

export interface SubtleMovementMetrics {
    strokeType: StrokeType;
    userHittingArm: 'left' | 'right';
    refHittingArm: 'left' | 'right';
    warnings?: string[];

    // Coil/Separation proxy (shoulder line vs hip line angle)
    coilPeakDeg: number;
    coilPeakTimeSec: number;
    refCoilPeakDeg: number;
    refCoilPeakTimeSec: number;

    // Uncoil speed proxy (d(coil)/dt)
    uncoilSpeedPeakDegPerSec: number;
    uncoilSpeedPeakTimeSec: number;
    refUncoilSpeedPeakDegPerSec: number;
    refUncoilSpeedPeakTimeSec: number;

    // Arm whip proxy (elbow angular velocity)
    armWhipPeakDegPerSec: number;
    armWhipPeakTimeSec: number;
    refArmWhipPeakDegPerSec: number;
    refArmWhipPeakTimeSec: number;

    // Timing (contact proxy = max arm speed)
    trunkToArmLagSec: number;
    refTrunkToArmLagSec: number;

    // Optional proxies
    kneeMinAngleUserDeg?: number;
    kneeMinAngleRefDeg?: number;
    headSwayStdUser?: number;
    headSwayStdRef?: number;
    elbowAngleStdUserDeg?: number;
    elbowAngleStdRefDeg?: number;
}

export interface SubtleMovementSeries {
    // Normalized 0..1 x-axis, aligned length.
    x: number[];
    contactIndex: number;

    trunkAngleUser: number[];
    trunkAngleRef: number[];
    trunkVelUser: number[];
    trunkVelRef: number[];
    elbowAngleUser: number[];
    elbowAngleRef: number[];
    armVelUser: number[];
    armVelRef: number[];
}

export interface SubtleMovementResult {
    metrics?: SubtleMovementMetrics;
    series?: SubtleMovementSeries;
    summary: string;
}

export type HandednessPreference = 'auto' | 'left' | 'right';
