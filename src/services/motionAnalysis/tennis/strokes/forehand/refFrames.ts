import type { PoseResult } from '../../../BaseMotionAnalysis';

export const FH_PHASE_TS_KEYS: Record<string, string> = {
    'Unit Turn': 'unitTurn',
    'Racket Drop': 'racketDrop',
    'Contact Point': 'contact',
    'Follow Through': 'followThrough',
};

export type RefPhases = {
    frames: {
        unitTurn: PoseResult;
        racketDrop: PoseResult;
        contact: PoseResult;
        followThrough: PoseResult;
    };
};

/**
 * Returns getRefFrame and getRefTimestamp helpers bound to the given sequences and timestamps.
 * getRefFrame: looks up the reference frame for a phase by name.
 * getRefTimestamp: returns the admin-calibrated timestamp for a phase, falling back to frame.timestamp.
 */
export function buildRefFrameHelpers(
    activeRefSequence: PoseResult[],
    phaseTimestamps: Record<string, number> | undefined,
    refPhases: RefPhases | null
) {
    const getRefFrame = (phaseName: string): PoseResult | null => {
        // 1. Try admin-set timestamp lookup first
        const tsKey = FH_PHASE_TS_KEYS[phaseName] ?? null;
        if (tsKey && phaseTimestamps?.[tsKey] != null && activeRefSequence.length > 0) {
            const ts = phaseTimestamps[tsKey];
            let best = activeRefSequence[0];
            let bestDiff = Math.abs(best.timestamp - ts);
            for (const frame of activeRefSequence) {
                const diff = Math.abs(frame.timestamp - ts);
                if (diff < bestDiff) { bestDiff = diff; best = frame; }
            }
            if (bestDiff < 0.5) return best;
        }

        // 2. Fallback to kinematic auto-detection
        if (!refPhases) return null;
        switch (phaseName) {
            case 'Unit Turn': return refPhases.frames.unitTurn;
            case 'Racket Drop': return refPhases.frames.racketDrop;
            case 'Contact Point': return refPhases.frames.contact;
            case 'Follow Through': return refPhases.frames.followThrough;
            default: return null;
        }
    };

    /** Returns the exact admin-calibrated timestamp when available; falls back to the
     *  analysed frame's own timestamp so seek-based capture lands on the right frame. */
    const getRefTimestamp = (phaseName: string, frame: PoseResult | null): number | undefined => {
        const tsKey = FH_PHASE_TS_KEYS[phaseName] ?? null;
        if (tsKey && phaseTimestamps?.[tsKey] != null) return phaseTimestamps[tsKey];
        return frame?.timestamp;
    };

    return { getRefFrame, getRefTimestamp };
}
