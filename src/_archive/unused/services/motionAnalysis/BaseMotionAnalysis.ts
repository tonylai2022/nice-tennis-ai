import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { YoloPoseService } from '../pose/YoloPose';
import { YoloObjectsService, YoloObjectDetections } from '../pose/YoloObjects';

/**
 * BaseMotionAnalysis - Shared tennis motion-analysis utilities and interfaces
 * 
 * This file contains the common tennis analysis functionality:
 * - MediaPipe/YOLO initialization
 * - Video processing utilities
 * - Common pose detection logic
 * - Shared type definitions
 */

export interface PoseResult {
    landmarks: any[];
    worldLandmarks: any[];
    timestamp: number;
    frameData?: string; // Optional: captured frame as data URL (used on mobile for reliable display)
    ball?: {
        x: number; // normalized 0..1 (image space)
        y: number; // normalized 0..1 (image space)
        confidence: number; // 0..1
        radius?: number; // normalized approx radius
    };
    racket?: {
        // Normalized image-space segment approximating racket axis.
        // (x0,y0) is near the hand/handle; (x1,y1) is toward the tip.
        x0: number;
        y0: number;
        x1: number;
        y1: number;
        confidence: number; // 0..1
    };
}

export interface AlignmentIssue {
    phase: string;
    issue: string;
    timestamp: number;
    landmarks: any[];
    worldLandmarks?: any[];
    strokeType?: string;
    metrics?: Record<string, number | string | boolean | null>;
    debug?: Record<string, unknown>;
    visualCue: {
        targetIndex: number;
        cueType: 'circle' | 'arrow';
        color?: string;
    };
    frameImage?: string;
    refTimestamp?: number;
    refAlignedTimestamp?: number;
    refLandmarks?: any[];
    refWorldLandmarks?: any[];
    refAlignedLandmarks?: any[];
    refAlignedWorldLandmarks?: any[];
    refFrameImage?: string;
    refVisualCue?: {
        targetIndex: number;
        cueType: 'circle' | 'arrow';
        color?: string;
    };
}

export interface AnalysisOptions {
    userMirrored?: boolean;
    refMirrored?: boolean;
    handedness?: 'left' | 'right' | 'auto';
    maxAnalysisSeconds?: number;
    yoloDesktopFps?: number;
    yoloMobileFps?: number;
}

/**
 * Base class with shared functionality for all sports
 */
export abstract class BaseMotionAnalysisService {
    protected static poseBackend: 'yolo' | 'mediapipe' = 'yolo';
    protected static landmarker: PoseLandmarker | null = null;
    protected static isAnalyzing: boolean = false;
    protected static currentSessionId: number = 0;
    protected static currentVideoUrl: string = '';
    protected static lastYoloInitError: string | null = null;

    protected static analysisOptions: Required<AnalysisOptions> = {
        userMirrored: false,
        refMirrored: false,
        handedness: 'auto',
        maxAnalysisSeconds: 120,
        yoloDesktopFps: 20,
        yoloMobileFps: 15,
    };

    static setPoseBackend(backend: 'yolo' | 'mediapipe') {
        this.poseBackend = backend;
    }

    static getPoseBackend(): 'yolo' | 'mediapipe' {
        return this.poseBackend;
    }

    static getLastYoloInitError(): string | null {
        return this.lastYoloInitError;
    }

    static setAnalysisOptions(options: Partial<AnalysisOptions>) {
        this.analysisOptions = {
            ...this.analysisOptions,
            ...options
        };
    }

    static getAnalysisOptions(): Required<AnalysisOptions> {
        return { ...this.analysisOptions };
    }

    protected static isMobileDevice(): boolean {
        const ua = navigator.userAgent;
        const isIPadOS = /Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1;
        return /iPhone|iPad|iPod|Android/i.test(ua) || isIPadOS;
    }

    protected static clampInt(v: number, lo: number, hi: number): number {
        return Math.max(lo, Math.min(hi, Math.round(v)));
    }

    /**
     * Initialize MediaPipe or YOLO pose detection
     */
    static async initialize(): Promise<void> {
        if (this.poseBackend === 'yolo') {
            try {
                await YoloPoseService.initialize();
                await YoloObjectsService.initialize();
                this.lastYoloInitError = null;
                console.log('[BaseMotionAnalysis] YOLO initialization successful');
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.lastYoloInitError = msg;
                console.error('[BaseMotionAnalysis] YOLO init failed:', msg);
                throw err;
            }
        } else {
            // MediaPipe initialization
            if (!this.landmarker) {
                const vision = await FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
                );

                // Try GPU first, fall back to CPU on mobile/WebGL issues
                const isMobile = this.isMobileDevice();
                const confidence = isMobile ? 0.4 : 0.5; // Slightly lower confidence on mobile for better detection
                try {
                    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
                        baseOptions: {
                            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
                            delegate: 'GPU'
                        },
                        runningMode: 'VIDEO',
                        numPoses: 1,
                        minPoseDetectionConfidence: confidence,
                        minPosePresenceConfidence: confidence,
                        minTrackingConfidence: confidence
                    });
                    console.log('[BaseMotionAnalysis] MediaPipe initialized with GPU');
                } catch (gpuError) {
                    console.warn('[BaseMotionAnalysis] GPU delegate failed, falling back to CPU:', gpuError);
                    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
                        baseOptions: {
                            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
                            delegate: 'CPU'
                        },
                        runningMode: 'VIDEO',
                        numPoses: 1,
                        minPoseDetectionConfidence: confidence,
                        minPosePresenceConfidence: confidence,
                        minTrackingConfidence: confidence
                    });
                    console.log('[BaseMotionAnalysis] MediaPipe initialized with CPU');
                }
            }
        }
    }

    /**
     * Reset analysis state
     */
    static async reset(options?: { clearMemoryCache?: boolean }): Promise<void> {
        this.isAnalyzing = false;
        this.currentSessionId++;
        this.currentVideoUrl = '';

        if (options?.clearMemoryCache) {
            console.log('[BaseMotionAnalysis] Memory cache cleared');
        }
    }

    /**
     * Warmup the analysis engine
     */
    static async warmup(): Promise<void> {
        try {
            await this.initialize();
            console.log('[BaseMotionAnalysis] Warmup complete');
        } catch (err) {
            console.warn('[BaseMotionAnalysis] Warmup failed:', err);
        }
    }
}
