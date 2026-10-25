import type { PoseResult } from '../../../BaseMotionAnalysis';

export const SERVE_PHASE_TS_KEYS: Record<string, string> = {
    'Preparation': 'prep',
    'Ball Toss': 'tossPeak',
    'Trophy Position': 'loading',
    'Contact Point': 'contact',
    'Follow Through': 'finish',
};

export type ServeRefPhases = {
    indices: {
        prepIdx: number;
        tossPeakIdx: number;
        loadingIdx: number;
        contactIdx: number;
        finishIdx: number;
    };
    frames: {
        prep: PoseResult;
        tossPeak: PoseResult;
        loading: PoseResult;
        contact: PoseResult;
        finish: PoseResult;
    };
};

export function buildRefFrameHelpers(
    activeRefSequence: PoseResult[],
    phaseTimestamps: Record<string, number> | undefined,
    refPhases: ServeRefPhases | null,
) {
    const getRefFrame = (phaseName: string): PoseResult | null => {
        const tsKey = SERVE_PHASE_TS_KEYS[phaseName] ?? null;
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
            case 'Preparation': return refPhases.frames.prep;
            case 'Ball Toss': return refPhases.frames.tossPeak;
            case 'Trophy Position': return refPhases.frames.loading;
            case 'Contact Point': return refPhases.frames.contact;
            case 'Follow Through': return refPhases.frames.finish;
            default: return null;
        }
    };

    const getRefTimestamp = (phaseName: string, frame: PoseResult | null): number | undefined => {
        const tsKey = SERVE_PHASE_TS_KEYS[phaseName] ?? null;
        if (tsKey && phaseTimestamps?.[tsKey] != null) return phaseTimestamps[tsKey];
        return frame?.timestamp;
    };

    return { getRefFrame, getRefTimestamp };
}
