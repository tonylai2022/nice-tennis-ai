import type { TrimRange } from '../types/app';

export function clampTrimRange(range: TrimRange): TrimRange {
    const minGap = 0.02;
    const start = Math.max(0, Math.min(1, range.start));
    const end = Math.max(0, Math.min(1, range.end));
    if (end - start < minGap) {
        if (start + minGap <= 1) return { start, end: start + minGap };
        return { start: Math.max(0, end - minGap), end };
    }
    return { start, end };
}

export function formatSec(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
}
