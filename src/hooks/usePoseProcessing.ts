import { useState, useEffect, useRef } from 'react';
import { MotionAnalysisService } from '../services/MotionAnalysisRouter';
import type { PoseResult } from '../services/MotionAnalysisRouter';

export interface PoseProcessingState {
    refPoseFrames: PoseResult[] | null;
    userPoseFrames: PoseResult[] | null;
    isProcessingPose: boolean;
    poseProgress: number; // 0–100
}

/**
 * Runs YOLO pose detection on both videos independently.
 *
 * - Reference video: processed first. Non-blob URLs are persisted to localStorage
 *   by TennisAnalysisCore, so subsequent loads are instant.
 * - User video: processed after ref initialisation. isProcessingPose reflects
 *   only the user-video processing (the expensive part each session).
 * - Both results are exposed as soon as they're ready — ref won't block user.
 */
export function usePoseProcessing(
    refVideoUrl: string | null,
    userVideoUrl: string | null,
): PoseProcessingState {
    const [refPoseFrames, setRefPoseFrames] = useState<PoseResult[] | null>(null);
    const [userPoseFrames, setUserPoseFrames] = useState<PoseResult[] | null>(null);
    const [isProcessingPose, setIsProcessingPose] = useState(false);
    const [poseProgress, setPoseProgress] = useState(0);
    const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const lastRefUrl = useRef<string | null>(null);
    const lastUserUrl = useRef<string | null>(null);
    const refAbortRef = useRef(false);
    const userAbortRef = useRef(false);

    // ── Process reference video (cached after first run) ──────────────────────
    useEffect(() => {
        if (!refVideoUrl) { setRefPoseFrames(null); lastRefUrl.current = null; return; }
        if (refVideoUrl === lastRefUrl.current) return; // already loaded

        lastRefUrl.current = refVideoUrl;
        setRefPoseFrames(null);
        refAbortRef.current = false;

        (async () => {
            try {
                await MotionAnalysisService.initialize();
                const frames = await MotionAnalysisService.analyzeVideo(refVideoUrl);
                if (!refAbortRef.current) setRefPoseFrames(frames);
            } catch {
                if (!refAbortRef.current) setRefPoseFrames([]);
            }
        })();

        return () => { refAbortRef.current = true; };
    }, [refVideoUrl]);

    // ── Process user video (runs every new upload) ────────────────────────────
    useEffect(() => {
        if (!userVideoUrl) { setUserPoseFrames(null); lastUserUrl.current = null; return; }
        if (userVideoUrl === lastUserUrl.current) return; // same blob, skip

        lastUserUrl.current = userVideoUrl;
        setUserPoseFrames(null);
        setIsProcessingPose(true);
        setPoseProgress(0);
        userAbortRef.current = false;

        // Animate progress to ~90% while processing, jump to 100 when done
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = setInterval(() => {
            setPoseProgress(prev => {
                if (prev >= 90) return prev;
                return prev + (90 - prev) * 0.08;
            });
        }, 250);

        (async () => {
            try {
                await MotionAnalysisService.initialize();
                const frames = await MotionAnalysisService.analyzeVideo(userVideoUrl);
                if (!userAbortRef.current) setUserPoseFrames(frames);
            } catch (err) {
                console.error('[usePoseProcessing] User pose detection failed', err);
                if (!userAbortRef.current) setUserPoseFrames([]);
            } finally {
                if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
                if (!userAbortRef.current) { setPoseProgress(100); setIsProcessingPose(false); }
            }
        })();

        return () => {
            userAbortRef.current = true;
            if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
        };
    }, [userVideoUrl]);

    return { refPoseFrames, userPoseFrames, isProcessingPose, poseProgress };
}

