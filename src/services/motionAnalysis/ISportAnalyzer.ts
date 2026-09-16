/**
 * ISportAnalyzer — contract implemented by the tennis analysis service.
 *
 * TennisMotionAnalysisService is all-static, so this type describes the static
 * class shape rather than instance methods.
 */

import type { PoseResult, AlignmentIssue } from './BaseMotionAnalysis';

export type ISportAnalyzer = {
    /** Initialise pose detection models — must be called before analyzeVideo */
    initialize(): Promise<void>;

    /** Reset internal state and optional caches between analysis runs */
    reset(options?: { clearMemoryCache?: boolean; clearPersistentCache?: boolean }): Promise<void>;

    /**
     * Extract a sequence of pose frames from a video URL.
     * @param sparseTimestamps Optional subset of timestamps to analyse (speeds up calibration)
     */
    analyzeVideo(videoUrl: string, sparseTimestamps?: number[] | null): Promise<PoseResult[]>;

    /** Side-by-side comparison of reference and user pose sequences */
    comparePerformances(refPoses: PoseResult[], userPoses: PoseResult[]): any;

    /**
     * Detect serve-specific alignment issues.
    * The router wraps this in async for a stable call-site contract.
     */
    detectServeIssues(userPoses: PoseResult[], refPoses?: PoseResult[]): AlignmentIssue[] | Promise<AlignmentIssue[]>;

    /** Compute subtle (micro-movement) metrics for overlay comparison */
    computeSubtleMovement(
        refPoses: PoseResult[],
        userPoses: PoseResult[],
        strokeType: any
    ): any;

    /**
     * Capture raw JPEG frames from the video at the given timestamps.
    * Returns captured frame data in the analyzer's established shape.
     */
    captureRawFramesAtTimes(videoUrl: string, timestamps: number[]): Promise<any>;
};
