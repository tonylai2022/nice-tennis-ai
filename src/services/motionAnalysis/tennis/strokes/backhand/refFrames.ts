import type { PoseResult } from '../../../BaseMotionAnalysis';

export const BH_PHASE_TS_KEYS: Record<string, string> = {
    'Unit Turn': 'unitTurn',
    'Racket Drop': 'racketDrop',
    'Contact Point': 'contact',
    'Follow Through': 'followThrough',
};

export type BackhandRefPhases = {
    unitTurnIdx: number;
    racketDropIdx: number;
    contactIdx: number;
    followThroughIdx: number;
    detectedIsRightHanded: boolean;
};

export function buildRefFrameHelpers(
    activeRefSequence: PoseResult[],
    phaseTimestamps: Record<string, number> | undefined,
    refPhases: BackhandRefPhases | null,
) {
    const getRefFrame = (phaseName: string): PoseResult | null => {
        const tsKey = BH_PHASE_TS_KEYS[phaseName] ?? null;
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
        if (!refPhases) return null;
        switch (phaseName) {
            case 'Unit Turn': return activeRefSequence[refPhases.unitTurnIdx];
            case 'Racket Drop': return activeRefSequence[refPhases.racketDropIdx];
            case 'Contact Point': return activeRefSequence[refPhases.contactIdx];
            case 'Follow Through': return activeRefSequence[refPhases.followThroughIdx];
            default: return null;
        }
    };

    const getRefTimestamp = (phaseName: string, frame: PoseResult | null): number | undefined => {
        const tsKey = BH_PHASE_TS_KEYS[phaseName] ?? null;
        if (tsKey && phaseTimestamps?.[tsKey] != null) return phaseTimestamps[tsKey];
        return frame?.timestamp;
    };

    return { getRefFrame, getRefTimestamp };
}
