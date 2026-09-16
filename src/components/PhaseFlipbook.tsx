import React, { useState, useEffect } from 'react';
import { MotionAnalysisService } from '../services/MotionAnalysisRouter';

export const phaseFlipbookCache = new Map<string, (string | null)[]>();
export let flipbookCaptureQueue: Promise<void> = Promise.resolve();

export function getPhaseOffsetsSeconds(phase: string): number[] {
    const p = (phase || '').toLowerCase();
    if (p.includes('contact')) return [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];
    if (p.includes('unit')) return [-0.50, -0.40, -0.30, -0.20, -0.10, -0.05, 0];
    if (p.includes('drop')) return [-0.35, -0.25, -0.18, -0.12, -0.08, -0.04, 0];
    if (p.includes('follow')) return [0, 0.10, 0.20, 0.30, 0.40, 0.50];
    return [-0.30, -0.20, -0.10, 0, 0.10, 0.20, 0.30];
}

export function PhaseFlipbook({
    phase,
    videoUrl,
    centerTimestamp,
    minTimestamp,
    maxTimestamp,
    landmarks,
    visualCue,
    tint,
    initialStill,
    enabled,
}: {
    phase: string;
    videoUrl: string | null;
    centerTimestamp: number | undefined;
    minTimestamp?: number;
    maxTimestamp?: number;
    landmarks?: any[];
    visualCue?: any;
    tint: 'rose' | 'emerald';
    initialStill?: string;
    enabled: boolean;
}) {
    const [frames, setFrames] = useState<(string | null)[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [playing, setPlaying] = useState(true);
    const [idx, setIdx] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        if (!videoUrl) return;

        let validCenterTimestamp = centerTimestamp;
        if (centerTimestamp === undefined || !isFinite(centerTimestamp) || centerTimestamp < 0) {
            console.warn(`[PhaseFlipbook] Invalid centerTimestamp (${centerTimestamp}), using fallback for phase: ${phase}`);

            const fallbackTimestamps: Record<string, number> = {
                'contact': 1.2,
                'unit': 0.8,
                'drop': 1.0,
                'follow': 1.4,
            };

            const phaseKey = Object.keys(fallbackTimestamps).find(key =>
                phase.toLowerCase().includes(key)
            );

            validCenterTimestamp = phaseKey ? fallbackTimestamps[phaseKey] : 1.0;
            console.warn(`[PhaseFlipbook] Using fallback timestamp: ${validCenterTimestamp}s for phase: ${phase}`);
        }

        const centerTs: number = validCenterTimestamp ?? 1.0;
        let cancelled = false;

        const load = async () => {
            const offsets = getPhaseOffsetsSeconds(phase);
            const hardMin = (minTimestamp !== undefined && isFinite(minTimestamp)) ? Math.max(0, minTimestamp) : 0;
            const hardMax = (maxTimestamp !== undefined && isFinite(maxTimestamp)) ? maxTimestamp : Infinity;

            const minOffset = Math.min(...offsets);
            const maxOffset = Math.max(...offsets);
            const rawStart = centerTs + minOffset;
            const rawEnd = centerTs + maxOffset;

            let segStart = Math.max(hardMin, rawStart);
            let segEnd = Math.min(hardMax, rawEnd);

            if (!isFinite(segStart)) segStart = 0;
            if (!isFinite(segEnd)) segEnd = segStart;
            if (segEnd - segStart < 0.03) {
                const pad = 0.03;
                segStart = Math.max(hardMin, Math.min(centerTs, segStart));
                segEnd = Math.min(hardMax, Math.max(centerTs, segEnd));
                segStart = Math.max(hardMin, centerTs - pad);
                segEnd = Math.min(hardMax, centerTs + pad);
                if (segEnd - segStart < 0.01) {
                    segStart = Math.max(hardMin, centerTs);
                    segEnd = Math.min(hardMax, centerTs);
                }
            }

            const denom = (maxOffset - minOffset) || 1;
            const times = offsets.map((o) => {
                const p = (o - minOffset) / denom;
                const t = segStart + p * (segEnd - segStart);
                return Math.max(0, t);
            });

            const key = `${videoUrl}|${times.map((t) => t.toFixed(3)).join(',')}`;
            const cached = phaseFlipbookCache.get(key);
            if (cached) {
                if (!cancelled) setFrames(cached);
                return;
            }

            setLoading(true);
            try {
                let captured: (string | null)[] = [];
                await (flipbookCaptureQueue = flipbookCaptureQueue
                    .then(async () => {
                        const result = await MotionAnalysisService.captureRawFramesAtTimes(videoUrl, times);
                        captured = Object.values(result);
                    })
                    .catch(async (error) => {
                        console.error(`[PhaseFlipbook] Frame capture failed for ${phase}:`, error);
                        try {
                            const result = await MotionAnalysisService.captureRawFramesAtTimes(videoUrl, times);
                            captured = Object.values(result);
                        } catch (retryError) {
                            console.error(`[PhaseFlipbook] Retry failed for ${phase}:`, retryError);
                            const centerResult = await MotionAnalysisService.captureRawFramesAtTimes(videoUrl, [centerTs]);
                            captured = Object.values(centerResult);
                        }
                    }));

                const validFrames = captured.filter(frame => frame !== null && frame !== undefined);
                if (validFrames.length === 0) {
                    console.warn(`[PhaseFlipbook] No valid frames captured for ${phase}, using fallback`);
                    const fallbackFrames = initialStill ? [initialStill] : [];
                    phaseFlipbookCache.set(key, fallbackFrames);
                    if (!cancelled) setFrames(fallbackFrames);
                } else {
                    phaseFlipbookCache.set(key, validFrames);
                    if (!cancelled) setFrames(validFrames);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [enabled, videoUrl, centerTimestamp, minTimestamp, maxTimestamp, phase]);

    useEffect(() => {
        if (!enabled) return;
        if (!playing) return;
        if (!frames || frames.length < 2) return;

        const ms = phase.toLowerCase().includes('contact') ? 220 : 200;
        const id = window.setInterval(() => {
            setIdx((prev) => (prev + 1) % frames.length);
        }, ms);
        return () => window.clearInterval(id);
    }, [enabled, playing, frames, phase]);

    let src: string | null = null;
    if (enabled) {
        if (frames && frames.length > 0 && frames[idx]) {
            src = frames[idx];
        } else if (frames && frames.length > 0) {
            const availableFrame = frames.find(frame => frame !== null && frame !== undefined);
            if (availableFrame) src = availableFrame;
        } else if (initialStill) {
            src = initialStill;
        }
    } else if (initialStill) {
        src = initialStill;
    }

    return (
        <div className={`relative overflow-hidden rounded-lg border ${tint === 'rose' ? 'border-rose-900/50 shadow-rose-900/20' : 'border-emerald-900/50 shadow-emerald-900/20'} shadow-sm`}>
            {src ? (
                <img src={src} alt="phase" className="w-full h-auto object-cover" />
            ) : (
                <div className="aspect-video bg-black flex items-center justify-center text-slate-600 text-xs">
                    {loading ? 'Loading frames...' : enabled ? `No frames for ${phase}` : 'No Image'}
                </div>
            )}

            {enabled && (
                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                    <div className="px-2 py-1 rounded bg-black/60 text-[10px] text-white border border-slate-700">
                        {loading ? 'Loading…' : frames && frames.length > 1 ? `${frames.length} frames` : frames?.length === 1 ? '1 frame (limited)' : 'No frames'}
                    </div>
                    <button
                        className="px-2 py-1 rounded bg-black/60 text-[10px] text-white border border-slate-700 hover:bg-black/70"
                        onClick={() => setPlaying((p) => !p)}
                        type="button"
                    >
                        {playing ? 'Pause' : 'Play'}
                    </button>
                </div>
            )}
        </div>
    );
}
