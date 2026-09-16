/**
 * Tennis Phase Detection Configuration
 *
 * Static reference data and debug feature flags used by phase detection algorithms.
 * Centralised here so all stroke modules read from a single source of truth.
 */

import type { PhaseType } from '../../CalibrationService';

export type { PhaseType };

// ─── Hardcoded reference phases (disabled by default — enable with ?refHardcoded=1) ──────────
export const REFERENCE_PHASES: Record<string, {
    unitTurn: number;
    racketDrop: number;
    contact: number;
    followThrough: number;
    prep?: number;
    tossPeak?: number;
    loading?: number;
    finish?: number;
}> = {
    // Strings match filenames in mock_videos.json
    'novak-forehand-sideview': { unitTurn: 1.2, racketDrop: 1.8, contact: 2.15, followThrough: 2.8 },
    'novak-backhand-sideview': { unitTurn: 1.1, racketDrop: 1.7, contact: 2.1, followThrough: 2.6 },
    'novak-serve-sideview': { prep: 0.5, tossPeak: 1.5, loading: 1.9, contact: 2.2, finish: 2.9, unitTurn: 0, racketDrop: 0, followThrough: 0 },
};

/**
 * Returns true when ?refHardcoded=1 is set in the URL.
 * Hardcoded reference phases can become stale — keep OFF by default.
 */
export function shouldUseHardcodedReferencePhases(): boolean {
    try {
        return new URLSearchParams(window.location.search).get('refHardcoded') === '1';
    } catch {
        return false;
    }
}

/**
 * Returns true when ?dtw=1 is set.
 * DTW alignment should NOT be the default when reference clips may be slow-motion.
 */
export function shouldUseDtwAlignment(): boolean {
    try {
        return new URLSearchParams(window.location.search).get('dtw') === '1';
    } catch {
        return false;
    }
}

// ─── Joint metadata ────────────────────────────────────────────────────────────

export const JOINT_NAMES: Record<number, string> = {
    0: 'nose', 1: 'left_eye_inner', 2: 'left_eye', 3: 'right_eye_inner',
    4: 'right_eye', 5: 'left_eye_outer', 6: 'right_eye_outer', 7: 'left_ear',
    8: 'right_ear', 9: 'mouth_left', 10: 'mouth_right', 11: 'left_shoulder',
    12: 'right_shoulder', 13: 'left_elbow', 14: 'right_elbow', 15: 'left_wrist',
    16: 'right_wrist', 17: 'left_pinky', 18: 'right_pinky', 19: 'left_index',
    20: 'right_index', 21: 'left_thumb', 22: 'right_thumb', 23: 'left_hip',
    24: 'right_hip', 25: 'left_knee', 26: 'right_knee', 27: 'left_ankle',
    28: 'right_ankle', 29: 'left_heel', 30: 'right_heel', 31: 'left_foot_index',
    32: 'right_foot_index',
};

/** Key joints for tennis overlay comparison */
export const KEY_TENNIS_JOINTS = [
    11, 12, // Shoulders
    13, 14, // Elbows
    15, 16, // Wrists
    23, 24, // Hips
    25, 26, // Knees
    27, 28, // Ankles
] as const;
