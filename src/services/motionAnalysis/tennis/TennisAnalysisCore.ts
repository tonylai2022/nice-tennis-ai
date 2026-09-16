import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { YoloPoseService } from '../../pose/YoloPose';
import { YoloObjectsService } from '../../pose/YoloObjects';
import { BaseMotionAnalysisService, PoseResult, AnalysisOptions } from '../BaseMotionAnalysis';
import { hydrateFromStorage, sanitizeForStorage, downsampleForStorage, logBallSummary, logRacketSummary } from './cacheStorage';
import { runVideoFrameLoop, VideoProcessorConfig } from './videoProcessing';

export class TennisAnalysisCore extends BaseMotionAnalysisService {
    // Mobile optimization: Capture frames during analysis for reliable display
    protected static readonly CAPTURE_FRAMES_DURING_ANALYSIS = true;
    protected static readonly FRAME_CAPTURE_INTERVAL = 5; // Capture every Nth frame to save memory
    protected static readonly FRAME_THUMBNAIL_SIZE = 480; // Max dimension for thumbnails

    // Cache state
    protected static refCache: Map<string, PoseResult[]> = new Map();
    protected static storageCacheDisabled: boolean = false;
    protected static didClearCacheFromQuery: boolean = false;
    protected static urlCacheTagMemo: Map<string, string> = new Map();

    // Versioned prefix so we can safely evolve cached schema.
    // NOTE: Bump when analysis logic/thresholds change to avoid reusing stale results.
    // v7: Biomechanical phase detection (racket head, ball proximity, joint angles)
    protected static readonly CACHE_KEY_PREFIX = 'motion_cache_v9_';
    protected static readonly CACHE_KEY_ANY_PREFIX = 'motion_cache_';
    // localStorage is typically ~5MB. Pose landmarks are verbose JSON; keep a conservative cap.
    protected static readonly MAX_CACHE_JSON_CHARS = 1_500_000;
    protected static readonly MAX_CACHED_FRAMES = 120;

    protected static getEffectiveTargetFpsForCache(): number {
        const isMobile = this.isMobileDevice();
        if (this.poseBackend === 'yolo') {
            const desiredYoloFps = isMobile ? this.analysisOptions.yoloMobileFps : this.analysisOptions.yoloDesktopFps;
            return this.clampInt(desiredYoloFps, 2, 30);
        }
        return isMobile ? 10 : 30;
    }

    protected static buildSamplingSignature(sparseTimestamps: number[] | null): string {
        const isMobile = this.isMobileDevice();
        const platformTag = isMobile ? 'm' : 'd';
        const fps = this.getEffectiveTargetFpsForCache();
        if (sparseTimestamps && sparseTimestamps.length) {
            const firstMs = Math.round((sparseTimestamps[0] ?? 0) * 1000);
            const lastMs = Math.round((sparseTimestamps[sparseTimestamps.length - 1] ?? 0) * 1000);
            return `${platformTag}_sparse_${sparseTimestamps.length}_${firstMs}_${lastMs}`;
        }
        return `${platformTag}_fps_${fps}`;
    }

    protected static buildMemoryCacheKey(videoUrl: string, sparseTimestamps: number[] | null): string {
        return `${this.poseBackend}|${this.buildSamplingSignature(sparseTimestamps)}|${videoUrl}`;
    }

    protected static normalizeCacheTag(raw: string): string {
        return String(raw)
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .slice(0, 96);
    }

    protected static async getUrlCacheTag(videoUrl: string): Promise<string> {
        if (!videoUrl || videoUrl.startsWith('blob:')) return '';
        const memo = this.urlCacheTagMemo.get(videoUrl);
        if (memo !== undefined) return memo;

        try {
            const resp = await fetch(videoUrl, { method: 'HEAD', cache: 'no-store' });
            if (!resp.ok) {
                this.urlCacheTagMemo.set(videoUrl, '');
                return '';
            }
            const etag = resp.headers.get('etag') || '';
            const lastModified = resp.headers.get('last-modified') || '';
            const contentLength = resp.headers.get('content-length') || '';
            const combined = [etag, lastModified, contentLength].filter(Boolean).join('|');
            const tag = combined ? this.normalizeCacheTag(combined) : '';
            this.urlCacheTagMemo.set(videoUrl, tag);
            return tag;
        } catch {
            this.urlCacheTagMemo.set(videoUrl, '');
            return '';
        }
    }

    protected static async buildPersistentCacheKey(videoUrl: string, sparseTimestamps: number[] | null): Promise<string> {
        const sig = this.buildSamplingSignature(sparseTimestamps);
        const tag = await this.getUrlCacheTag(videoUrl);
        const assetPart = tag ? `_a_${tag}` : '';
        return `${this.CACHE_KEY_PREFIX}${this.poseBackend}_${sig}_${videoUrl}${assetPart}`;
    }

    static async reset(options?: { clearMemoryCache?: boolean; clearPersistentCache?: boolean }) {
        this.currentSessionId++;

        if (options?.clearMemoryCache) {
            this.refCache.clear();
        }

        if (options?.clearPersistentCache) {
            try {
                const keys: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(this.CACHE_KEY_ANY_PREFIX)) keys.push(k);
                }
                for (const k of keys) localStorage.removeItem(k);
            } catch {
                // best-effort
            }
        }

        // YOLO backend has no timestamp state to reset.
        if (this.poseBackend === 'mediapipe' && this.landmarker) {
            // We MUST close it to reset the internal timestamp counter
            this.landmarker.close();
            this.landmarker = null;
        }
    }

    static async initialize() {
        console.log(`[MotionAnalysis] initialize() - Hybrid multi-model approach`);
        const ua = navigator.userAgent;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);

        // 1. Try YOLO first (for object detection)
        if (!isMobile) {
            try {
                console.log('[YOLO] Initializing ONNX pose backend...');
                await YoloPoseService.initialize();

                try {
                    console.log('[YOLO] Initializing ONNX object backend (optional)...');
                    await YoloObjectsService.initialize();
                } catch (e) {
                    console.warn('[YOLO] Object model init failed; continuing with heuristic ball/racket detection.', e);
                }

                this.lastYoloInitError = null;
                console.log('[MotionAnalysis] YOLO backend active for objects/racket');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.lastYoloInitError = msg;
                console.warn('[YOLO] Init failed; will use MediaPipe only.', e);
                this.poseBackend = 'mediapipe';
            }
        } else {
            console.log('[MotionAnalysis] Mobile detected; using MediaPipe only to avoid YOLO WASM compatibility issues.');
            this.poseBackend = 'mediapipe';
        }

        // 2. Always initialize MediaPipe for shoulder/hip analysis
        if (this.landmarker) {
            console.log('[MotionAnalysis] MediaPipe already initialized');
            return;
        }

        try {
            console.log('Initializing MediaPipe WASM...');
            const vision = await Promise.race([
                FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
                ),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('WASM loading timeout')), 15000)
                )
            ]) as any;

            console.log('Creating PoseLandmarker...');
            try {
                this.landmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                        delegate: 'GPU',
                    },
                    runningMode: 'VIDEO',
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });
                console.log('PoseLandmarker initialized with GPU');
            } catch (gpuError) {
                console.warn("GPU Delegate failed, falling back to CPU", gpuError);
                this.landmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                        delegate: 'CPU',
                    },
                    runningMode: 'VIDEO',
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });
                console.log('PoseLandmarker initialized with CPU');
            }
            console.log('[MotionAnalysis] Hybrid backend ready: YOLO (objects) + MediaPipe (shoulders)');
        } catch (error) {
            console.error("Failed to initialize PoseLandmarker", error);
            throw new Error(`MediaPipe init failed: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
    }

    protected static maybeClearCachesFromQueryOnce() {
        if (this.didClearCacheFromQuery) return;
        try {
            const qs = new URLSearchParams(window.location.search);
            if (qs.get('clearCache') !== '1') return;
            this.didClearCacheFromQuery = true;
        } catch {
            return;
        }

        console.warn('[MotionAnalysis] clearCache=1 detected; clearing motion caches (memory + storage)');
        try {
            this.refCache.clear();
            this.urlCacheTagMemo.clear();
        } catch {
            // ignore
        }

        try {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(this.CACHE_KEY_ANY_PREFIX)) keys.push(k);
            }
            for (const k of keys) localStorage.removeItem(k);
        } catch {
            // best-effort
        }
    }

    protected static tryPersistToLocalStorage(cacheKey: string, results: PoseResult[]) {
        if (this.storageCacheDisabled) return;
        try {
            const payload = downsampleForStorage(sanitizeForStorage(results), this.MAX_CACHED_FRAMES);
            const json = JSON.stringify(payload);
            if (json.length > this.MAX_CACHE_JSON_CHARS) {
                console.warn(
                    `[MotionAnalysis] Skipping persistent cache (too large: ${(json.length / 1024).toFixed(0)} KB)`,
                    cacheKey
                );
                return;
            }
            try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
            localStorage.setItem(cacheKey, json);
        } catch (e) {
            console.warn('[MotionAnalysis] Failed to persist analysis to storage; attempting cache cleanup', e);
            try {
                const keys: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(this.CACHE_KEY_ANY_PREFIX)) keys.push(k);
                }
                for (const k of keys) localStorage.removeItem(k);

                const payload = downsampleForStorage(sanitizeForStorage(results), this.MAX_CACHED_FRAMES);
                const json = JSON.stringify(payload);
                if (json.length <= this.MAX_CACHE_JSON_CHARS) {
                    try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
                    localStorage.setItem(cacheKey, json);
                }
            } catch (e2) {
                console.warn('[MotionAnalysis] Persistent cache cleanup failed; continuing without storage cache', e2);
                this.storageCacheDisabled = true;
            }
        }
    }

    static async analyzeVideo(videoUrl: string, sparseTimestamps: number[] | null = null): Promise<PoseResult[]> {
        this.maybeClearCachesFromQueryOnce();

        // 1. Check memory cache
        const memoryKey = this.buildMemoryCacheKey(videoUrl, sparseTimestamps);
        if (this.refCache.has(memoryKey)) {
            console.log(`Returning cached analysis (memory) [${this.poseBackend}] for:`, videoUrl);
            const cached = this.refCache.get(memoryKey)!;
            logBallSummary(cached, `cache(memory) ${videoUrl}`);
            logRacketSummary(cached, `cache(memory) ${videoUrl}`);
            return cached;
        }

        const persistentCacheKey = !videoUrl.startsWith('blob:')
            ? await this.buildPersistentCacheKey(videoUrl, sparseTimestamps)
            : null;

        // 2. Check persistent cache (only for reference/server URLs, not user blobs)
        if (!videoUrl.startsWith('blob:')) {
            try {
                const stored = persistentCacheKey ? localStorage.getItem(persistentCacheKey) : null;
                if (stored) {
                    console.log(`Returning cached analysis (storage) [${this.poseBackend}] for:`, videoUrl);
                    const data = hydrateFromStorage(JSON.parse(stored));
                    this.refCache.set(memoryKey, data);
                    logBallSummary(data, `cache(storage) ${videoUrl}`);
                    logRacketSummary(data, `cache(storage) ${videoUrl}`);
                    return data;
                }
            } catch (e) {
                console.warn("Cache storage read failed", e);
            }
        }

        // Mutex: wait if another analysis is in progress
        if (this.isAnalyzing) {
            console.warn('Previous analysis still running, forcing reset...');
            this.isAnalyzing = false;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isAnalyzing = true;

        try {
            const results = await this._doAnalyzeVideo(videoUrl, sparseTimestamps);

            if (results.length > 0) {
                const finalMemoryKey = this.buildMemoryCacheKey(videoUrl, sparseTimestamps);
                this.refCache.set(finalMemoryKey, results);

                if (!videoUrl.startsWith('blob:') && !videoUrl.includes('trainingvideolib')) {
                    try {
                        const cacheKey = persistentCacheKey || (await this.buildPersistentCacheKey(videoUrl, sparseTimestamps));
                        this.tryPersistToLocalStorage(cacheKey, results);
                    } catch (e) {
                        console.warn("Failed to persist analysis to storage (quota exceeded?)", e);
                    }
                }
            }
            return results;
        } catch (error) {
            this.isAnalyzing = false;
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    protected static async _doAnalyzeVideo(videoUrl: string, sparseTimestamps: number[] | null = null): Promise<PoseResult[]> {
        this.currentVideoUrl = videoUrl;

        // Create video element FIRST (synchronously) to preserve user gesture
        // This MUST happen before any await to keep the gesture token on mobile
        const video = document.createElement('video');
        // crossOrigin MUST be set before src — setting it after causes the browser
        // to re-request the resource without CORS headers, tainting the canvas.
        if (!videoUrl.startsWith('blob:')) {
            video.crossOrigin = 'anonymous';
        }
        video.src = videoUrl;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');
        video.preload = 'auto';
        (video as any).webkitPlaysinline = true;
        video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999';
        document.body.appendChild(video);

        // Kick video decoder on mobile Safari/iOS so canvas draws work reliably.
        try {
            video.load();
            const playPromise = video.play();
            if (playPromise && typeof (playPromise as any).catch === 'function') {
                (playPromise as Promise<void>).catch(() => undefined);
            }
            window.setTimeout(() => { try { video.pause(); } catch { /* ignore */ } }, 250);
        } catch {
            // ignore
        }

        // NOW we can do async operations while video loads
        await this.reset();
        await this.initialize();

        if (this.poseBackend === 'mediapipe' && !this.landmarker) {
            video.remove();
            throw new Error('Failed to initialize MediaPipe pose detection');
        }

        const capturedSessionId = this.currentSessionId;
        return runVideoFrameLoop(video, videoUrl, sparseTimestamps, {
            poseBackend: this.poseBackend,
            landmarker: this.landmarker,
            analysisOptions: this.analysisOptions,
            captureFramesDuringAnalysis: this.CAPTURE_FRAMES_DURING_ANALYSIS,
            frameCaptureInterval: this.FRAME_CAPTURE_INTERVAL,
            isSessionValid: () => this.currentSessionId === capturedSessionId,
        });
    }
}
