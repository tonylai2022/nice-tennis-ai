/**
 * Tennis DTW (Dynamic Time Warping) Utilities
 *
 * Implements DTW-based sequence alignment for comparing user and reference tennis strokes.
 * All functions are pure (no class state). Import from poseUtils for shared helpers.
 */

import type { PoseResult, AlignmentIssue } from '../BaseMotionAnalysis';
import {
    trimStaticFrames,
    resampleSequence,
    findClosestFrame,
    calculateFrameSimilarity,
} from './poseUtils';

export type { PoseResult, AlignmentIssue };

// ─── DTW Index Mapping ────────────────────────────────────────────────────────

/**
 * Standard DTW path between two pose sequences.
 * Returns array of [idx_in_seq1, idx_in_seq2] pairs (Sakoe-Chiba band constrained).
 */
export function getDTWMapping(seq1: PoseResult[], seq2: PoseResult[]): [number, number][] {
    const n = seq1.length;
    const m = seq2.length;
    const dtw = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    dtw[0][0] = 0;

    const cost = (i: number, j: number) => 100 - calculateFrameSimilarity(seq1[i], seq2[j]);

    for (let i = 1; i <= n; i++) {
        const i_start = Math.max(1, i - 50);
        const i_end = Math.min(m, i + 50);
        for (let j = i_start; j <= i_end; j++) {
            dtw[i][j] = cost(i - 1, j - 1) + Math.min(
                dtw[i - 1][j],
                dtw[i][j - 1],
                dtw[i - 1][j - 1]
            );
        }
    }

    let i = n; let j = m;
    const path: [number, number][] = [];
    while (i > 0 && j > 0) {
        path.push([i - 1, j - 1]);
        const min = Math.min(dtw[i - 1][j - 1], dtw[i - 1][j], dtw[i][j - 1]);
        if (min === dtw[i - 1][j - 1]) { i--; j--; }
        else if (min === dtw[i - 1][j]) { i--; }
        else { j--; }
    }
    return path.reverse();
}

// ─── Full DTW Alignment ───────────────────────────────────────────────────────

/**
 * DTW alignment returning paired sequences (same length, aligned).
 * Uses a Sakoe-Chiba band to prevent runaway alignment.
 */
export function performDTW(
    seq1: PoseResult[],
    seq2: PoseResult[]
): { alignedRef: PoseResult[]; alignedUser: PoseResult[] } {
    const n = seq1.length;
    const m = seq2.length;
    const dtw = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    dtw[0][0] = 0;

    const cost = (i: number, j: number) => 100 - calculateFrameSimilarity(seq1[i], seq2[j]);
    const BAND = Math.max(15, Math.ceil(Math.max(n, m) * 0.25));

    for (let i = 1; i <= n; i++) {
        const jStart = Math.max(1, i - BAND);
        const jEnd = Math.min(m, i + BAND);
        for (let j = jStart; j <= jEnd; j++) {
            dtw[i][j] = cost(i - 1, j - 1) + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
        }
    }

    let i = n; let j = m;
    const alignedRef: PoseResult[] = [];
    const alignedUser: PoseResult[] = [];

    while (i > 0 || j > 0) {
        alignedRef.unshift(seq1[Math.max(i - 1, 0)]);
        alignedUser.unshift(seq2[Math.max(j - 1, 0)]);
        if (i > 0 && j > 0) {
            const min = Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
            if (min === dtw[i - 1][j]) { i--; }
            else if (min === dtw[i][j - 1]) { j--; }
            else { i--; j--; }
        } else if (i > 0) { i--; }
        else { j--; }
    }

    return { alignedRef, alignedUser };
}

// ─── Time Mapping ─────────────────────────────────────────────────────────────

/**
 * Returns a function that maps a user-video timestamp to the corresponding
 * reference-video timestamp via DTW alignment.
 * Returns null if the sequences are too short for reliable alignment.
 */
export function buildUserToRefTimeMapper(
    userSequence: PoseResult[],
    refSequence: PoseResult[]
): ((t: number) => number | null) | null {
    try {
        const u = trimStaticFrames(userSequence);
        const r = trimStaticFrames(refSequence);
        if (u.length < 8 || r.length < 8) return null;

        const targetLen = 80;
        const uRes = resampleSequence(u, targetLen);
        const rRes = resampleSequence(r, targetLen);

        const { alignedRef, alignedUser } = performDTW(rRes, uRes);
        if (alignedRef.length < 10 || alignedUser.length < 10) return null;

        const userT: number[] = alignedUser.map(f => f.timestamp);
        const refT: number[] = alignedRef.map(f => f.timestamp);

        return (t: number) => {
            if (!Number.isFinite(t)) return null;
            let bestI = 0;
            let bestD = Math.abs((userT[0] ?? 0) - t);
            for (let i = 1; i < userT.length; i++) {
                const d = Math.abs((userT[i] ?? 0) - t);
                if (d < bestD) { bestD = d; bestI = i; }
            }
            const mapped = refT[bestI];
            return Number.isFinite(mapped) ? mapped : null;
        };
    } catch {
        return null;
    }
}

// ─── Issue Alignment ──────────────────────────────────────────────────────────

/**
 * Enriches each `AlignmentIssue` with a `refAlignedTimestamp` computed by
 * DTW-mapping the user issue timestamp into reference video time.
 *
 * Does NOT overwrite `refTimestamp` — that field must remain deterministic
 * for the same PRO video and must not depend on who the user is.
 */
export function applyDtwRefAlignmentToIssues(
    issues: AlignmentIssue[],
    userSequence: PoseResult[],
    refSequence: PoseResult[]
): void {
    if (!issues.length) return;
    const mapper = buildUserToRefTimeMapper(userSequence, refSequence);
    if (!mapper) return;

    for (const issue of issues) {
        const mapped = mapper(issue.timestamp);
        if (mapped == null) continue;
        issue.refAlignedTimestamp = mapped;
        const refFrame = findClosestFrame(refSequence, mapped);
        if (refFrame?.landmarks) {
            issue.refAlignedLandmarks = refFrame.landmarks;
            issue.refAlignedWorldLandmarks = refFrame.worldLandmarks;
        }
    }
}
