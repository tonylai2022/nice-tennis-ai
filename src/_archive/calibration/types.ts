/**
 * calibration/types.ts
 * All shared types and phase definitions for the calibration system.
 * SRP: Pure data — no logic, no I/O.
 */

// Phase definitions for each stroke type
export const PHASE_DEFINITIONS = {
    // Tennis strokes
    forehand: ['unit_turn', 'racket_drop', 'contact', 'follow_through'] as const,
    backhand: ['unit_turn', 'racket_drop', 'contact', 'follow_through'] as const,
    serve: ['preparation', 'ball_toss', 'loading', 'contact', 'finish'] as const,
    volley: ['preparation', 'contact', 'follow_through'] as const,
    forehand_volley: ['preparation', 'contact', 'follow_through'] as const,
    backhand_volley: ['preparation', 'contact', 'follow_through'] as const,
    overhead: ['preparation', 'contact', 'follow_through'] as const,

    // Tennis specialty shots
    drop: ['setup', 'contact', 'follow_through'] as const,
    lob: ['setup', 'loading', 'contact', 'follow_through'] as const,
};

export type StrokeType = keyof typeof PHASE_DEFINITIONS;
export type ForehandPhase = typeof PHASE_DEFINITIONS.forehand[number];
export type BackhandPhase = typeof PHASE_DEFINITIONS.backhand[number];
export type ServePhase = typeof PHASE_DEFINITIONS.serve[number];
export type VolleyPhase = typeof PHASE_DEFINITIONS.volley[number];
export type OverheadPhase = typeof PHASE_DEFINITIONS.overhead[number];
export type DropPhase = typeof PHASE_DEFINITIONS.drop[number];
export type LobPhase = typeof PHASE_DEFINITIONS.lob[number];
export type PhaseType =
    | ForehandPhase
    | BackhandPhase
    | ServePhase
    | VolleyPhase
    | OverheadPhase
    | DropPhase
    | LobPhase;

/** Feature vector extracted from a pose for classification */
export interface PoseFeatures {
    rightElbowAngle: number;
    leftElbowAngle: number;
    rightShoulderAngle: number;
    leftShoulderAngle: number;
    rightWristRelX: number;
    rightWristRelY: number;
    rightWristRelZ: number;
    leftWristRelX: number;
    leftWristRelY: number;
    leftWristRelZ: number;
    trunkRotation: number;
    rightKneeAngle: number;
    leftKneeAngle: number;
    bodyLeanX: number;
    bodyLeanZ: number;
    rightWristVelocity: number;
    leftWristVelocity: number;
}

/** A single calibrated example */
export interface CalibrationExample {
    id: string;
    strokeType: StrokeType;
    phase: PhaseType;
    features: PoseFeatures;
    timestamp: number;
    videoName: string;
    createdAt: number;
    landmarks?: any[];
    worldLandmarks?: any[];
    frameImage?: string;
    isUserVideo?: boolean;
    videoId?: string;
    frameIndex?: number;
}

/** Persisted collection of all calibration data */
export interface CalibrationData {
    version: number;
    examples: CalibrationExample[];
    lastUpdated: number;
}

/** Cross-device sync bundle (calibration + profiles + per-profile data) */
export interface CalibrationSyncBundle {
    version: number;
    exportedAt: number;
    calibration: CalibrationData;
    profiles: CalibrationProfile[];
    activeProfileName: string | null;
    profileData: Record<string, CalibrationData>;
}

/** Profile for saving/loading calibration sets */
export interface CalibrationProfile {
    id: string;
    name: string;
    description?: string;
    strokeType: StrokeType;
    exampleCount: number;
    createdAt: number;
    updatedAt: number;
}
