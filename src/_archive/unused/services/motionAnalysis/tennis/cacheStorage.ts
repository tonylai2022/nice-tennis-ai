import type { PoseResult } from '../BaseMotionAnalysis';

export function roundTo(v: unknown, decimals: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    const p = Math.pow(10, decimals);
    return Math.round(n * p) / p;
}

export function compactLandmarks(landmarks: any[]): any[] {
    if (!Array.isArray(landmarks)) return [];
    return landmarks.map((lm) => ({
        x: roundTo(lm?.x, 4),
        y: roundTo(lm?.y, 4),
        z: roundTo(lm?.z, 4),
        visibility: roundTo(lm?.visibility, 3),
    }));
}

export function hydrateFromStorage(data: any): PoseResult[] {
    if (!Array.isArray(data)) return [];
    return data.map((r: any) => {
        const landmarks = Array.isArray(r?.landmarks) ? r.landmarks : [];
        const worldLandmarks = Array.isArray(r?.worldLandmarks) && r.worldLandmarks.length
            ? r.worldLandmarks
            : landmarks;
        return {
            landmarks,
            worldLandmarks,
            timestamp: typeof r?.timestamp === 'number' ? r.timestamp : Number(r?.timestamp) || 0,
            ball: r?.ball,
            racket: r?.racket,
        } as PoseResult;
    });
}

export function sanitizeForStorage(results: PoseResult[]): PoseResult[] {
    return results.map((r) => {
        const ball = r.ball
            ? {
                x: roundTo(r.ball.x, 4),
                y: roundTo(r.ball.y, 4),
                confidence: roundTo(r.ball.confidence, 3),
                radius: r.ball.radius !== undefined ? roundTo(r.ball.radius, 4) : undefined,
            }
            : undefined;

        const racket = r.racket
            ? {
                x0: roundTo(r.racket.x0, 4),
                y0: roundTo(r.racket.y0, 4),
                x1: roundTo(r.racket.x1, 4),
                y1: roundTo(r.racket.y1, 4),
                confidence: roundTo(r.racket.confidence, 3),
            }
            : undefined;

        return {
            landmarks: compactLandmarks(r.landmarks),
            timestamp: roundTo(r.timestamp, 4),
            ball,
            racket,
        } as any;
    });
}

export function logBallSummary(results: PoseResult[], label: string): void {
    try {
        const withBall = results.filter((r) => (r as any)?.ball && (r as any).ball.confidence >= 0.2);
        if (withBall.length === 0) {
            console.log(`[Ball] ${label}: no detections (>=0.2 conf) across ${results.length} frames`);
            return;
        }
        const best = withBall.reduce((acc, cur) => {
            const a = (acc as any).ball?.confidence ?? 0;
            const b = (cur as any).ball?.confidence ?? 0;
            return b > a ? cur : acc;
        }, withBall[0]);
        const bestBall = (best as any).ball;
        console.log(
            `[Ball] ${label}: ${withBall.length}/${results.length} frames have ball (>=0.2 conf). ` +
            `Best conf=${Number(bestBall.confidence).toFixed(2)} at t=${Number(best.timestamp).toFixed(2)}s`
        );
    } catch { /* best-effort */ }
}

export function logRacketSummary(results: PoseResult[], label: string): void {
    try {
        const withRacket = results.filter((r) => (r as any)?.racket && (r as any).racket.confidence >= 0.25);
        if (withRacket.length === 0) {
            console.log(`[Racket] ${label}: no detections (>=0.25 conf) across ${results.length} frames`);
            return;
        }
        const best = withRacket.reduce((acc, cur) => {
            const a = (acc as any).racket?.confidence ?? 0;
            const b = (cur as any).racket?.confidence ?? 0;
            return b > a ? cur : acc;
        }, withRacket[0]);
        const bestR = (best as any).racket;
        console.log(
            `[Racket] ${label}: ${withRacket.length}/${results.length} frames have racket (>=0.25 conf). ` +
            `Best conf=${Number(bestR.confidence).toFixed(2)} at t=${Number(best.timestamp).toFixed(2)}s`
        );
    } catch { /* best-effort */ }
}

export function downsampleForStorage(results: PoseResult[], maxFrames: number): PoseResult[] {
    if (results.length <= maxFrames) return results;
    const out: PoseResult[] = [];
    for (let i = 0; i < maxFrames; i++) {
        const idx = Math.round((i * (results.length - 1)) / (maxFrames - 1));
        out.push(results[idx]);
    }
    return out;
}
