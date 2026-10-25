import type { PoseResult, AnalysisOptions } from '../BaseMotionAnalysis';
import { YoloPoseService } from '../../pose/YoloPose';
import { YoloObjectsService, YoloObjectDetections } from '../../pose/YoloObjects';
import { captureFrameThumbnail, waitRafs, seekToTime } from './videoCapture';
import { detectTennisBallFromVideo, detectRacketFromVideo } from './detection';
import { logBallSummary, logRacketSummary } from './cacheStorage';
import { estimateLandmarkMovement, smoothLandmarks } from './poseUtils';

export interface VideoProcessorConfig {
    poseBackend: 'yolo' | 'mediapipe';
    landmarker: any; // PoseLandmarker
    analysisOptions: Required<AnalysisOptions>;
    captureFramesDuringAnalysis: boolean;
    frameCaptureInterval: number;
    isSessionValid: () => boolean;
}

export function runVideoFrameLoop(
    video: HTMLVideoElement,
    videoUrl: string,
    sparseTimestamps: number[] | null,
    config: VideoProcessorConfig,
): Promise<PoseResult[]> {
    return new Promise((resolve, reject) => {
        const results: PoseResult[] = [];
        let finished = false;

        const ua = navigator.userAgent;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
        const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

        const desiredYoloFps = isMobile ? config.analysisOptions.yoloMobileFps : config.analysisOptions.yoloDesktopFps;
        const FPS = config.poseBackend === 'yolo'
            ? clampInt(desiredYoloFps, 2, 30)
            : (isMobile ? 10 : 30);
        const INTERVAL = 1.0 / FPS;

        const cleanup = () => {
            video.pause();
            video.removeAttribute('src');
            video.load();
            if (video.parentNode) document.body.removeChild(video);
        };

        const durationSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        const estimatedFrames = sparseTimestamps?.length
            ? sparseTimestamps.length
            : (durationSeconds !== null
                ? Math.ceil(durationSeconds * FPS)
                : Math.ceil((isMobile ? 8 : 12) * FPS));
        const msPerFrame = isMobile ? 350 : 80;
        const budgetMs = Math.max(30_000, (config.analysisOptions.maxAnalysisSeconds || 120) * 1000);
        let baseTimeout = Math.max(60000, estimatedFrames * msPerFrame + 15000, budgetMs);
        if (!Number.isFinite(baseTimeout) || baseTimeout <= 0) baseTimeout = 60000;
        console.log(`Analysis timeout set to ${(baseTimeout / 1000).toFixed(0)}s for ~${estimatedFrames} frames (${isMobile ? 'mobile' : 'desktop'})`);

        const timeoutId = window.setTimeout(() => {
            if (finished) return;
            finished = true;
            cleanup();
            if (results.length > 10) {
                console.log(`Timeout reached with ${results.length} frames - returning partial results`);
                resolve(results);
            } else {
                reject(new Error(`Analysis timed out after ${(baseTimeout / 1000).toFixed(0)}s`));
            }
        }, baseTimeout);

        const finishResolve = (value: PoseResult[], reason?: string) => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timeoutId);
            cleanup();
            if (reason) console.warn(reason);
            resolve(value);
        };

        const startProcessing = async () => {
            console.log(`[MotionAnalysis] Using pose backend: ${config.poseBackend}`);
            const deviceInfo = {
                platform: navigator.platform,
                isMobile,
                videoResolution: `${video.videoWidth}x${video.videoHeight}`,
                duration: video.duration.toFixed(2),
                targetFPS: FPS,
            };
            console.log(`[Device Fingerprint] ${JSON.stringify(deviceInfo)}`);

            let currentTime = sparseTimestamps && sparseTimestamps.length > 0 ? sparseTimestamps[0] : 0;
            let sparseIndex = 0;
            let frameCount = 0;

            let prevLandmarksForSmoothing: any[] | null = null;
            let lastObjDetections: YoloObjectDetections | null = null;
            let lastObjDetectionsFrame = -1;
            let objectInitTried = false;
            let objectInitFailed = false;

            const getEffectiveDuration = () => {
                if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
                try {
                    if (video.seekable && video.seekable.length > 0) {
                        const end = video.seekable.end(video.seekable.length - 1);
                        if (Number.isFinite(end) && end > 0) return end;
                    }
                } catch { /* ignore */ }
                return null;
            };

            const fallbackDurationSeconds = sparseTimestamps && sparseTimestamps.length > 0
                ? Math.max(0.1, sparseTimestamps[sparseTimestamps.length - 1] + INTERVAL)
                : (isMobile ? 12 : 20);

            const processNextFrame = async () => {
                if (finished) return;
                if (!config.isSessionValid()) {
                    finishResolve(results, `[MotionAnalysis] Analysis cancelled (stale session). Captured ${results.length} frames.`);
                    return;
                }

                const effectiveDuration = getEffectiveDuration();
                const targetDuration = effectiveDuration ?? fallbackDurationSeconds;
                const isComplete = sparseTimestamps ? sparseIndex >= sparseTimestamps.length : currentTime >= targetDuration;

                if (isComplete) {
                    if (finished) return;
                    finished = true;
                    window.clearTimeout(timeoutId);
                    cleanup();
                    console.log(`Analysis complete: ${results.length} frames captured`);
                    logBallSummary(results, `analysis ${videoUrl}`);
                    logRacketSummary(results, `analysis ${videoUrl}`);
                    resolve(results);
                    return;
                }

                try {
                    await seekToTime(video, currentTime, isMobile ? 1200 : 500);
                    if (finished) return;
                    if (isMobile) await waitRafs(2);

                    if (!config.isSessionValid()) {
                        finishResolve(results, `[MotionAnalysis] Analysis cancelled mid-frame.`);
                        return;
                    }
                    if (finished) return;

                    let landmarks: any[] | null = null;
                    let worldLandmarks: any[] | null = null;
                    let avgVisibility = 0;

                    if (config.poseBackend === 'yolo') {
                        const det = await YoloPoseService.detectFromVideo(video);
                        if (det) {
                            landmarks = det.landmarks33;
                            worldLandmarks = det.landmarks33;
                            avgVisibility = det.avgVisibility;

                            if (landmarks && landmarks.length && prevLandmarksForSmoothing) {
                                const movement = estimateLandmarkMovement(prevLandmarksForSmoothing, landmarks);
                                const alpha = movement > 0.06 ? 0.85 : 0.6;
                                landmarks = smoothLandmarks(prevLandmarksForSmoothing, landmarks, alpha);
                                worldLandmarks = landmarks;
                            }
                            if (landmarks && landmarks.length) prevLandmarksForSmoothing = landmarks;
                        }
                    } else {
                        if (!config.landmarker) throw new Error('Landmarker lost');
                        const timestampMs = performance.now();
                        const detection = config.landmarker.detectForVideo(video, timestampMs);
                        if (detection.landmarks?.length) {
                            landmarks = detection.landmarks[0];
                            worldLandmarks = detection.worldLandmarks?.[0] ?? detection.landmarks[0];
                            const visibilitySum = landmarks.reduce((sum: number, lm: any) => sum + (lm.visibility || 1), 0);
                            avgVisibility = visibilitySum / landmarks.length;
                        }
                    }

                    if (landmarks?.length) {
                        const visibilityThreshold = config.poseBackend === 'yolo' ? (isMobile ? 0.25 : 0.5) : 0.5;
                        if (avgVisibility > visibilityThreshold) {
                            let frameData: string | undefined;
                            const captureInterval = isMobile ? 3 : config.frameCaptureInterval;
                            if (config.captureFramesDuringAnalysis && frameCount % captureInterval === 0) {
                                frameData = captureFrameThumbnail(video);
                            }

                            if (config.poseBackend === 'yolo') {
                                const objInterval = 3;
                                const shouldRunObj = frameCount % objInterval === 0 && (lastObjDetectionsFrame < 0 || frameCount - lastObjDetectionsFrame >= objInterval);

                                if (!YoloObjectsService.isReady() && !objectInitTried) {
                                    objectInitTried = true;
                                    try { await YoloObjectsService.initialize(); } catch { objectInitFailed = true; }
                                }

                                if (YoloObjectsService.isReady() && shouldRunObj) {
                                    try {
                                        lastObjDetections = await YoloObjectsService.detectFromVideo(video);
                                        lastObjDetectionsFrame = frameCount;
                                    } catch (e) {
                                        if (!objectInitFailed) { console.warn('[YOLO] Object detection failed.', e); objectInitFailed = true; }
                                    }
                                }
                            }

                            // Decay confidence for stale YOLO detections (object model runs every
                            // objInterval frames; frames in-between reuse the last result).
                            // A 2-frame-old ball position may have moved significantly — reduce its
                            // weight so proximity scoring is not skewed by a ghost detection.
                            const framesStale = (lastObjDetectionsFrame >= 0 && frameCount > lastObjDetectionsFrame)
                                ? (frameCount - lastObjDetectionsFrame) : 0;
                            const staleFactor = framesStale <= 0 ? 1.0 : framesStale === 1 ? 0.75 : 0.50;

                            const modelBall = lastObjDetections?.ball && lastObjDetections.ball.confidence * staleFactor >= 0.22
                                ? { x: lastObjDetections.ball.x, y: lastObjDetections.ball.y, confidence: lastObjDetections.ball.confidence * staleFactor, radius: lastObjDetections.ball.radius }
                                : undefined;
                            const ball = modelBall ?? detectTennisBallFromVideo(video, landmarks);

                            const modelRacket = lastObjDetections?.racket && lastObjDetections.racket.confidence * staleFactor >= 0.22
                                ? (() => {
                                    const rightWrist = landmarks[16];
                                    const leftWrist = landmarks[15];
                                    const wrist = rightWrist?.visibility >= leftWrist?.visibility ? rightWrist : leftWrist;
                                    const b = lastObjDetections!.racket!.box;
                                    if (!wrist || !Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)) return undefined;
                                    const corners = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y1 }];
                                    let best = corners[0], bestD2 = -Infinity;
                                    for (const c of corners) {
                                        const d2 = (c.x - wrist.x) ** 2 + (c.y - wrist.y) ** 2;
                                        if (d2 > bestD2) { bestD2 = d2; best = c; }
                                    }
                                    return { x0: wrist.x, y0: wrist.y, x1: best.x, y1: best.y, confidence: lastObjDetections!.racket!.confidence * staleFactor };
                                })()
                                : undefined;
                            const racket = modelRacket ?? detectRacketFromVideo(video, landmarks, ball);

                            results.push({ landmarks, worldLandmarks: worldLandmarks ?? landmarks, timestamp: video.currentTime, frameData, ball, racket });
                        } else {
                            if (frameCount % 30 === 0) console.log(`Skipped low-quality frame at ${video.currentTime.toFixed(2)}s (vis: ${avgVisibility.toFixed(2)})`);
                        }
                    }

                    const logInterval = isMobile ? 10 : 30;
                    if (frameCount % logInterval === 0) {
                        const dur = getEffectiveDuration() ?? fallbackDurationSeconds;
                        const progress = sparseTimestamps
                            ? ((sparseIndex / sparseTimestamps.length) * 100).toFixed(0)
                            : Math.min(100, (currentTime / dur) * 100).toFixed(0);
                        console.log(`Processing: ${progress}% (${results.length} frames, ${currentTime.toFixed(1)}s)`);
                        if (isMobile && results.length === 0) {
                            console.log(`[MobileDebug] readyState=${video.readyState}, seeking=${video.seeking}, ct=${video.currentTime.toFixed(3)}`);
                        }
                    }

                    if (sparseTimestamps) {
                        sparseIndex++;
                        if (sparseIndex < sparseTimestamps.length) currentTime = sparseTimestamps[sparseIndex];
                    } else {
                        currentTime = Math.round((currentTime + INTERVAL) * 1000) / 1000;
                    }
                    frameCount++;
                    setTimeout(processNextFrame, 0);
                } catch (e) {
                    console.error('Frame error:', e);
                    if (sparseTimestamps) { sparseIndex++; if (sparseIndex < sparseTimestamps.length) currentTime = sparseTimestamps[sparseIndex]; }
                    else currentTime += INTERVAL;
                    setTimeout(processNextFrame, 0);
                }
            };

            processNextFrame();
        };

        let processingStarted = false;
        video.onloadedmetadata = () => { if (!processingStarted) { processingStarted = true; startProcessing(); } };
        if (video.readyState >= 1 && !processingStarted) { processingStarted = true; startProcessing(); }
        video.onerror = (e) => {
            console.error('Video load error', e);
            window.clearTimeout(timeoutId);
            cleanup();
            reject(new Error(`Video load error: ${video.error?.message || 'Code ' + video.error?.code}`));
        };
    });
}
