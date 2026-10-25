import type { PoseResult, AlignmentIssue } from '../BaseMotionAnalysis';
import type { StrokeType, PhaseType } from '../../CalibrationService';
import { CalibrationService } from '../../CalibrationService';
import { findClosestFrameWithData } from './poseUtils';
import { seekToTime } from './videoCapture';

function isMobileUA(): boolean {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
}

export function drawAnnotation(
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    cue: any,
    width: number,
    height: number
): void {
    const target = landmarks?.[cue?.targetIndex];
    if (!target) return;
    ctx.strokeStyle = cue.color || 'red';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(target.x * width, target.y * height, 40, 0, 2 * Math.PI);
    ctx.stroke();
}

export async function annotateFrameImage(
    frameDataUrl: string,
    landmarks: any[] | undefined,
    visualCue: any | undefined
): Promise<string | null> {
    if (!landmarks || !visualCue) return frameDataUrl;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(frameDataUrl); return; }
                ctx.drawImage(img, 0, 0);
                drawAnnotation(ctx, landmarks, visualCue, img.width, img.height);
                resolve(canvas.toDataURL('image/jpeg', 0.75));
            } catch (e) {
                console.warn('Frame annotation failed:', e);
                resolve(frameDataUrl);
            }
        };
        img.onerror = () => resolve(frameDataUrl);
        img.src = frameDataUrl;
    });
}

async function captureFrameAtTime(
    videoUrl: string,
    timestamp: number,
    issue: AlignmentIssue,
    isRefVideo: boolean
): Promise<string | null> {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    if (!videoUrl.startsWith('blob:')) video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:fixed;opacity:0;pointer-events:none;z-index:-9999';
    document.body.appendChild(video);
    video.src = videoUrl;

    const cleanup = () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (video.parentNode) video.parentNode.removeChild(video);
    };

    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Metadata timeout')), 5000);
            video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
            video.onerror = () => { clearTimeout(timeout); reject(new Error('Video load error')); };
        });

        if (video.readyState < 3) {
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => { console.warn('Buffering timeout, proceeding...'); resolve(); }, 5000);
                video.oncanplay = () => { clearTimeout(timeout); resolve(); };
                video.load();
            });
        }

        const seekTime = Math.max(0, Math.min(timestamp, Math.max(0, video.duration - 0.05)));
        console.log(`Seeking to ${seekTime.toFixed(3)}s for phase: ${issue.phase}`);
        video.currentTime = seekTime;

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Seek timeout')), 3000);
            video.onseeked = () => { clearTimeout(timeout); resolve(); };
        });

        await new Promise(resolve => setTimeout(resolve, 150));

        if (video.videoWidth === 0 || video.videoHeight === 0) { cleanup(); return null; }

        const canvas = document.createElement('canvas');
        const MAX_DIM = 1280;
        let width = video.videoWidth, height = video.videoHeight;
        if (width > MAX_DIM || height > MAX_DIM) {
            const ratio = width / height;
            if (width > height) { width = MAX_DIM; height = Math.round(MAX_DIM / ratio); }
            else { height = MAX_DIM; width = Math.round(MAX_DIM * ratio); }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); return null; }
        ctx.drawImage(video, 0, 0, width, height);

        // Annotation circles removed — clean frames only

        const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
        console.log(`Captured frame at ${video.currentTime.toFixed(3)}s for phase: ${issue.phase} (${width}x${height})`);
        cleanup();
        return dataUrl;
    } catch (err) {
        console.error(`Failed to capture frame at ${timestamp}s:`, err);
        cleanup();
        return null;
    }
}

export async function captureRawFrameAtTime(videoUrl: string, timestamp: number): Promise<string | null> {
    const dummy = { phase: 'raw', issue: '', timestamp, landmarks: [], visualCue: undefined } as unknown as AlignmentIssue;
    return captureFrameAtTime(videoUrl, timestamp, dummy, false);
}

export async function captureRawFramesAtTimes(videoUrl: string, timestamps: number[]): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const t of timestamps) {
        results.push(await captureRawFrameAtTime(videoUrl, isFinite(t) ? Math.max(0, t) : 0));
    }
    return results;
}

export async function captureAnnotatedFrameAtTime(
    videoUrl: string, timestamp: number, landmarks: any[] | undefined, visualCue: any | undefined
): Promise<string | null> {
    const raw = await captureRawFrameAtTime(videoUrl, timestamp);
    if (!raw) return null;
    return annotateFrameImage(raw, landmarks, visualCue);
}

export async function captureAnnotatedFramesAtTimes(
    videoUrl: string, timestamps: number[], landmarks: any[] | undefined, visualCue: any | undefined
): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const t of timestamps) {
        results.push(await captureAnnotatedFrameAtTime(videoUrl, isFinite(t) ? Math.max(0, t) : 0, landmarks, visualCue));
    }
    return results;
}

export async function generateErrorImages(
    videoUrl: string,
    issues: AlignmentIssue[],
    isRefVideo = false,
    poseSequence?: PoseResult[],
    strokeType?: StrokeType
): Promise<AlignmentIssue[]> {
    if (issues.length === 0) return issues;

    const updatedIssues = [...issues];
    const isMobile = isMobileUA();
    const preferExactRefFrames = isRefVideo && !isMobile;
    const preferExactUserFrames = !isRefVideo && !isMobile;

    const isKeyPhaseName = (phaseName: string) =>
        ['Unit Turn', 'Racket Drop', 'Contact Point', 'Follow Through', 'Preparation', 'Ball Toss', 'Trophy Position', 'Loading', 'Finish'].includes(phaseName);

    // Always use live seek-based capture for reference video frames.
    // CalibrationService is consulted for landmarks (biomechanical comparison) and
    // admin-set timestamps, but stored frameImages are never used directly because
    // they may be stale (saved during a different video session).
    const forceLiveRefFrames = false;

    const forceExactFrames = (() => {
        try { return new URLSearchParams(window.location.search).get('exactFrames') === '1'; } catch { return false; }
    })();

    // Reference video: pull admin-calibrated landmarks + timestamps, then always seek for a fresh image.
    if (isRefVideo) {
        // Load admin-saved phase timestamps from localStorage (saved by VideoPhaseCalibrator → ReferenceVideoService).
        // These take highest priority — they're the exact frames the admin marked.
        const savedPhaseTimestamps: Record<string, number> = (() => {
            try {
                const all = JSON.parse(localStorage.getItem('motiontutor_phase_timestamps_v1') ?? '{}') as Record<string, Record<string, number>>;
                return all[videoUrl] ?? {};
            } catch { return {}; }
        })();

        // Map from display phase name → VideoPhaseCalibrator key (matches PHASE_FIELDS in AdminVideoUpload)
        const phaseNameToTsKey: Record<string, string> = {
            'Unit Turn': 'unitTurn',
            'Racket Drop': 'racketDrop',
            'Contact Point': 'contact',
            'Follow Through': 'followThrough',
            'Preparation': 'prep',
            'Ball Toss': 'tossPeak',
            'Trophy Position': 'loading',
            'Finish': 'finish',
        };

        const canUseReferenceCalibration = (st: StrokeType | undefined) =>
            !!st && !!CalibrationService.getCalibratedFrame(st, 'unit_turn')?.landmarks;

        for (let i = 0; i < updatedIssues.length; i++) {
            const issue = updatedIssues[i];

            const phaseName = issue.phase;

            // 1. Apply admin-saved timestamp (VideoPhaseCalibrator) — highest priority
            const tsKey = phaseNameToTsKey[phaseName];
            if (tsKey && savedPhaseTimestamps[tsKey] != null && isFinite(savedPhaseTimestamps[tsKey])) {
                updatedIssues[i].refTimestamp = savedPhaseTimestamps[tsKey];
            }

            let internalPhase: PhaseType | null = null;
            if (phaseName === 'Unit Turn') internalPhase = 'unit_turn';
            if (phaseName === 'Racket Drop') internalPhase = 'racket_drop';
            if (phaseName === 'Contact Point') internalPhase = 'contact';
            if (phaseName === 'Follow Through') internalPhase = 'follow_through';
            if (phaseName === 'Preparation') internalPhase = 'preparation';
            if (phaseName === 'Ball Toss') internalPhase = 'ball_toss';
            if (phaseName === 'Trophy Position') internalPhase = 'loading';

            if (internalPhase) {
                const effectiveStroke = strokeType || issue.strokeType as StrokeType;
                const calibrated = (effectiveStroke && canUseReferenceCalibration(effectiveStroke))
                    ? CalibrationService.getCalibratedFrame(effectiveStroke, internalPhase)
                    : null;

                if (calibrated) {
                    // Pull landmarks for biomechanical comparison.
                    if (calibrated.landmarks) updatedIssues[i].refLandmarks = calibrated.landmarks;
                    if (calibrated.worldLandmarks) updatedIssues[i].refWorldLandmarks = calibrated.worldLandmarks;

                    // Use CalibrationService timestamp only if no VideoPhaseCalibrator timestamp was set.
                    if (updatedIssues[i].refTimestamp == null &&
                        calibrated.timestamp != null && isFinite(calibrated.timestamp) && calibrated.timestamp >= 0) {
                        updatedIssues[i].refTimestamp = calibrated.timestamp;
                    }
                }
            }

            // Pre-captured frameData from the pose sequence (lower quality but fast fallback)
            const stableRefTs = updatedIssues[i].refTimestamp;
            if (poseSequence && stableRefTs !== undefined) {
                const closestFrame = findClosestFrameWithData(poseSequence, stableRefTs);
                if (closestFrame?.frameData) {
                    const annotated = await annotateFrameImage(closestFrame.frameData, issue.refLandmarks, issue.refVisualCue);
                    updatedIssues[i].refFrameImage = annotated || closestFrame.frameData;
                }
            }
        }

        // Don't return early — always continue to desktop seek for highest-quality frames.
    }

    // User video: try pre-captured frames
    if (!isRefVideo) {
        if (poseSequence && poseSequence.some(f => f.frameData)) {
            for (let i = 0; i < updatedIssues.length; i++) {
                const issue = updatedIssues[i];
                if (updatedIssues[i].frameImage) continue;
                if (issue.timestamp === undefined) continue;
                const closestFrame = findClosestFrameWithData(poseSequence, issue.timestamp);
                if (closestFrame?.frameData) {
                    const annotated = await annotateFrameImage(closestFrame.frameData, issue.landmarks, issue.visualCue);
                    updatedIssues[i].frameImage = annotated || closestFrame.frameData;
                }
            }
            const hasAllUserFrames = updatedIssues.every(issue => issue.frameImage);
            if (hasAllUserFrames && !forceExactFrames && !preferExactUserFrames) return updatedIssues;
        }
        if (isMobile) return updatedIssues;
    }

    // Desktop fallback: seek-based capture
    for (let i = 0; i < updatedIssues.length; i++) {
        const issue = updatedIssues[i];
        const targetTimestamp = isRefVideo ? issue.refTimestamp : issue.timestamp;
        const forceExactForThisIssue = forceExactFrames
            || (preferExactRefFrames && isKeyPhaseName(issue.phase))
            || (preferExactUserFrames && isKeyPhaseName(issue.phase));

        if (!forceExactForThisIssue) {
            if (isRefVideo && updatedIssues[i].refFrameImage) continue;
            if (!isRefVideo && updatedIssues[i].frameImage) continue;
        }

        if (targetTimestamp === undefined || !isFinite(targetTimestamp) || targetTimestamp < 0) continue;

        try {
            const frameDataUrl = await captureFrameAtTime(videoUrl, targetTimestamp, issue, isRefVideo);
            if (frameDataUrl) {
                if (isRefVideo) updatedIssues[i].refFrameImage = frameDataUrl;
                else updatedIssues[i].frameImage = frameDataUrl;
            }
        } catch (err) {
            console.error(`Failed to capture frame for ${issue.phase}:`, err);
        }
    }

    return updatedIssues;
}
