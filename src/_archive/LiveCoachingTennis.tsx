import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { AdvancedServePhaseDetector } from '../services/phaseDetection/ServePhaseDetector';
import { AdvancedGroundstrokePhaseDetector } from '../services/phaseDetection/GroundstrokePhaseDetector';
import {
    TennisServeCoach,
    ReferencePhaseTargets,
} from '../services/coaching/TennisServeCoach';
import {
    TennisGroundstrokeCoach,
} from '../services/coaching/TennisGroundstrokeCoach';
import { YoloObjectsService } from '../services/pose/YoloObjects';
import { referenceVideoService } from '../services/ReferenceVideoService';

const DEFAULT_SERVE_REFERENCE_URL = '/reference_videos/novak-serve-sideview.mp4';

type RacketDetection = {
    x: number;
    y: number;
    confidence: number;
    box?: { x0: number; y0: number; x1: number; y1: number };
    origin?: { x: number; y: number };
    source: 'yolo' | 'heuristic';
};

const formatVerticalPosition = (value: number) => {
    const distance = Math.round(Math.abs(value) * 100);
    return value <= 0 ? `${distance} units above shoulder` : `${distance} units below shoulder`;
};

const describeProMetric = (metric: any) => {
    const difference = metric.userValue - metric.referenceValue;
    const isClose = Math.abs(difference) < (metric.unit === 'degrees' ? 6 : 0.04);

    if (metric.metric === 'Toss-arm height' || metric.metric === 'Contact reach' || metric.metric === 'Elbow height') {
        return {
            user: formatVerticalPosition(metric.userValue),
            pro: formatVerticalPosition(metric.referenceValue),
            cue: isClose ? 'Matches the pro height' : difference > 0 ? 'Raise it higher' : 'Keep it lower',
        };
    }

    if (metric.metric === 'Shoulder coil') {
        return {
            user: `${Math.round(metric.userValue)} degrees of coil`,
            pro: `${Math.round(metric.referenceValue)} degrees of coil`,
            cue: isClose ? 'Matches the pro coil' : difference < 0 ? 'Turn more before driving up' : 'You are turning more than the reference',
        };
    }

    if (metric.metric === 'Knee bend') {
        return {
            user: `${Math.round((1 - metric.userValue) * 100)} units of bend`,
            pro: `${Math.round((1 - metric.referenceValue) * 100)} units of bend`,
            cue: isClose ? 'Matches the pro load' : difference > 0 ? 'Bend more into the load' : 'You are loading deeper than the reference',
        };
    }

    if (metric.metric === 'Arm extension') {
        return {
            user: `${Math.round(Math.abs(metric.userValue) * 100)} units past elbow`,
            pro: `${Math.round(Math.abs(metric.referenceValue) * 100)} units past elbow`,
            cue: isClose ? 'Matches the pro extension' : difference < 0 ? 'Reach farther through contact' : 'You are extending farther than the reference',
        };
    }

    return {
        user: `${Math.round(Math.abs(metric.userValue) * 100)} units from shoulder line`,
        pro: `${Math.round(Math.abs(metric.referenceValue) * 100)} units from shoulder line`,
        cue: isClose ? 'Matches the pro finish' : 'Let the finish travel closer to the pro path',
    };
};

class PosePainter {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private lastTransform = { offsetX: 0, offsetY: 0, drawWidth: 0, drawHeight: 0 };

    private readonly connections = [
        [0, 1], [1, 2], [2, 3], [3, 7],
        [0, 4], [4, 5], [5, 6], [6, 8],
        [9, 10],
        [11, 12],
        [11, 13], [13, 15],
        [12, 14], [14, 16],
        [23, 24],
        [23, 25], [24, 26],
        [25, 27], [26, 28],
        [27, 29], [28, 30],
        [29, 31], [30, 32],
        [31, 32],
    ];

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas 2D context');
        this.ctx = ctx;
    }

    drawVideoFrame(video: HTMLVideoElement) {
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = canvasWidth / canvasHeight;

        let drawWidth: number;
        let drawHeight: number;
        let offsetX: number;
        let offsetY: number;

        if (videoAspect > canvasAspect) {
            drawHeight = canvasHeight;
            drawWidth = canvasHeight * videoAspect;
            offsetX = (canvasWidth - drawWidth) / 2;
            offsetY = 0;
        } else {
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / videoAspect;
            offsetX = 0;
            offsetY = (canvasHeight - drawHeight) / 2;
        }

        this.ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
        this.lastTransform = { offsetX, offsetY, drawWidth, drawHeight };
    }

    drawSkeletonWithVideo(video: HTMLVideoElement, landmarks: any[], showWarning = false, drawVideo = true) {
        if (drawVideo) {
            this.drawVideoFrame(video);
        } else {
            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = canvasWidth / canvasHeight;
            const drawWidth = videoAspect > canvasAspect ? canvasHeight * videoAspect : canvasWidth;
            const drawHeight = videoAspect > canvasAspect ? canvasHeight : canvasWidth / videoAspect;
            this.lastTransform = {
                offsetX: (canvasWidth - drawWidth) / 2,
                offsetY: (canvasHeight - drawHeight) / 2,
                drawWidth,
                drawHeight,
            };
            this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        }

        // IMPORTANT: landmarks are normalized (0-1) within the *video* frame, not the
        // canvas. drawVideoFrame uses a cover-fit transform (offset + uniform scale)
        // that can crop/offset the video within the fixed-size canvas, e.g. for
        // portrait phone camera streams. Joints must be mapped through that exact
        // same transform or they land at the wrong pixels (often off-screen).
        const { offsetX, offsetY, drawWidth, drawHeight } = this.lastTransform;
        const toCanvasX = (nx: number) => offsetX + nx * drawWidth;
        const toCanvasY = (ny: number) => offsetY + ny * drawHeight;

        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';

        for (const [a, b] of this.connections) {
            const start = landmarks[a];
            const end = landmarks[b];
            if (!start || !end) continue;
            if ((start.visibility ?? 1) < 0.5 || (end.visibility ?? 1) < 0.5) continue;

            const sx = toCanvasX(start.x);
            const sy = toCanvasY(start.y);
            const ex = toCanvasX(end.x);
            const ey = toCanvasY(end.y);

            // Dark outline first so the line is visible against any background/lighting.
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
            this.ctx.lineWidth = 6;
            this.ctx.globalAlpha = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(sx, sy);
            this.ctx.lineTo(ex, ey);
            this.ctx.stroke();

            this.ctx.strokeStyle = '#39FF6A';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.moveTo(sx, sy);
            this.ctx.lineTo(ex, ey);
            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1;
        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            if (!lm || (lm.visibility ?? 1) < 0.5) continue;

            const x = toCanvasX(lm.x);
            const y = toCanvasY(lm.y);

            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 8, 0, 2 * Math.PI);
            this.ctx.fill();

            this.ctx.fillStyle = '#39FF6A';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 5, 0, 2 * Math.PI);
            this.ctx.fill();
        }

        if (showWarning) {
            this.ctx.strokeStyle = '#FF3333';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(10, 10, this.canvas.width - 20, this.canvas.height - 20);
        }
    }

    drawFeedback(text: string, color = '#00FF00') {
        this.ctx.font = 'bold 22px Arial';
        this.ctx.fillStyle = color;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(text, this.canvas.width / 2, 42);
    }

    drawRacketTracking(detection: RacketDetection | null) {
        if (!detection) return;
        const { offsetX, offsetY, drawWidth, drawHeight } = this.lastTransform;
        const toCanvasX = (nx: number) => offsetX + nx * drawWidth;
        const toCanvasY = (ny: number) => offsetY + ny * drawHeight;
        const ctx = this.ctx;

        ctx.save();
        ctx.textAlign = 'left';

        if (detection.box) {
            // Real YOLO detection — draw the actual bounding box.
            const x0 = toCanvasX(detection.box.x0);
            const y0 = toCanvasY(detection.box.y0);
            const x1 = toCanvasX(detection.box.x1);
            const y1 = toCanvasY(detection.box.y1);

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.lineWidth = 5;
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

            ctx.strokeStyle = '#FFC400';
            ctx.lineWidth = 2.5;
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

            const label = `Racket ${Math.round(detection.confidence * 100)}%`;
            ctx.font = 'bold 13px Arial';
            const labelY = Math.max(14, y0 - 6);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.lineWidth = 3;
            ctx.strokeText(label, x0, labelY);
            ctx.fillStyle = '#FFC400';
            ctx.fillText(label, x0, labelY);
        }

        ctx.restore();
    }

    drawHandPronation(landmarks: any[] | null, rollRateDegPerSecond: number | null) {
        if (!landmarks?.length) return;
        const { offsetX, offsetY, drawWidth, drawHeight } = this.lastTransform;
        const toCanvasX = (nx: number) => offsetX + nx * drawWidth;
        const toCanvasY = (ny: number) => offsetY + ny * drawHeight;
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17],
        ];
        const ctx = this.ctx;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const [startIndex, endIndex] of connections) {
            const start = landmarks[startIndex];
            const end = landmarks[endIndex];
            if (!start || !end) continue;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(toCanvasX(start.x), toCanvasY(start.y));
            ctx.lineTo(toCanvasX(end.x), toCanvasY(end.y));
            ctx.stroke();
            ctx.strokeStyle = '#24D9FF';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        for (const landmark of landmarks) {
            ctx.fillStyle = '#24D9FF';
            ctx.beginPath();
            ctx.arc(toCanvasX(landmark.x), toCanvasY(landmark.y), 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

        const wrist = landmarks[0];
        if (wrist && rollRateDegPerSecond !== null) {
            const label = `Hand roll ${Math.round(rollRateDegPerSecond)} deg/s`;
            const x = toCanvasX(wrist.x) + 12;
            const y = toCanvasY(wrist.y) - 12;
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'left';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.lineWidth = 3;
            ctx.strokeText(label, x, y);
            ctx.fillStyle = '#24D9FF';
            ctx.fillText(label, x, y);
        }
        ctx.restore();
    }
}

const POSE_LANDMARKER_BASE_OPTIONS = {
    modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

// GPU delegate is 3-5x faster than CPU on most phones, which is why serve
// reactions felt laggy. Some older/embedded WebViews lose their WebGL
// framebuffer, so we still fall back to CPU if GPU init or first inference fails.
async function createLandmarkerWithFallback(resolver: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
    try {
        return await PoseLandmarker.createFromOptions(resolver, {
            baseOptions: { ...POSE_LANDMARKER_BASE_OPTIONS, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });
    } catch (err) {
        console.warn('[LiveCoaching] GPU pose delegate unavailable, falling back to CPU', err);
        return PoseLandmarker.createFromOptions(resolver, {
            baseOptions: { ...POSE_LANDMARKER_BASE_OPTIONS, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });
    }
}

const HAND_LANDMARKER_BASE_OPTIONS = {
    modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

async function createHandLandmarkerWithFallback(
    resolver: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    isMobileDevice: boolean
) {
    const options = {
        runningMode: 'VIDEO' as const,
        // A serve normally shows both the tossing and hitting hand. Tracking
        // both lets getHittingHandRoll select the hand nearest the pose wrist,
        // instead of randomly accepting only the more visible tossing hand.
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
    };

    // Pose keeps the phone's GPU delegate for responsive phase detection. Hand
    // tracking is secondary and a second GPU context can crash/reload mobile
    // browsers under camera load, so deliberately use the single-threaded CPU
    // delegate on phones instead.
    if (isMobileDevice) {
        return HandLandmarker.createFromOptions(resolver, {
            baseOptions: { ...HAND_LANDMARKER_BASE_OPTIONS, delegate: 'CPU' },
            ...options,
        });
    }

    try {
        return await HandLandmarker.createFromOptions(resolver, {
            baseOptions: { ...HAND_LANDMARKER_BASE_OPTIONS, delegate: 'GPU' },
            ...options,
        });
    } catch (err) {
        console.warn('[LiveCoaching] GPU hand delegate unavailable, falling back to CPU', err);
        return HandLandmarker.createFromOptions(resolver, {
            baseOptions: { ...HAND_LANDMARKER_BASE_OPTIONS, delegate: 'CPU' },
            ...options,
        });
    }
}

type Vector3 = { x: number; y: number; z: number };

const dot3 = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vector3, b: Vector3): Vector3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
const subtract3 = (a: any, b: any): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const magnitude3 = (v: Vector3) => Math.sqrt(dot3(v, v));
const normalize3 = (v: Vector3): Vector3 | null => {
    const magnitude = magnitude3(v);
    return magnitude > 1e-6 ? { x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude } : null;
};
const projectPerpendicularTo = (v: Vector3, axis: Vector3): Vector3 | null => {
    const projected = {
        x: v.x - axis.x * dot3(v, axis),
        y: v.y - axis.y * dot3(v, axis),
        z: v.z - axis.z * dot3(v, axis),
    };
    return normalize3(projected);
};

type LiveCoachingTennisProps = {
    onClose: () => void;
};

export const LiveCoachingTennis: React.FC<LiveCoachingTennisProps> = ({ onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const referenceVideoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const painterRef = useRef<PosePainter | null>(null);
    const landmarkerRef = useRef<PoseLandmarker | null>(null);
    const advancedPhaseDetectorRef = useRef<any>(null);
    const coachRef = useRef<any>(new TennisServeCoach());
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const animationTimeoutRef = useRef<number | null>(null);
    const nextMotionResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initAttemptedRef = useRef(false);
    const isRunningRef = useRef(false);
    const gpuFallbackAttemptedRef = useRef(false);
    const yoloObjectsReadyRef = useRef(false);
    const yoloObjectsInitTriedRef = useRef(false);
    const lastYoloRacketRef = useRef<{ detection: RacketDetection; timestamp: number } | null>(null);
    const frameCountRef = useRef(0);
    const lastMediaPipeTimestampRef = useRef(0);
    const lowElbowWarningStreakRef = useRef(0);

    const motionStartedRef = useRef(false);
    const motionEndedRef = useRef(false);
    const lockedSequenceRef = useRef<string[] | null>(null);
    const lockedPhaseRef = useRef<string>('start');
    const previousPhaseRef = useRef<string>('start');
    const decelerationStartFrameRef = useRef<number | null>(null);
    const completionPendingSinceRef = useRef<number | null>(null);

    const lastSpokenAtRef = useRef(0);
    const lastProcessTimeRef = useRef(0);
    const motionChecksRef = useRef(0);
    const motionReferenceMatchesRef = useRef(0);
    const motionCorrectionsRef = useRef<Record<string, number>>({});
    const motionErrorEvidenceRef = useRef<Record<string, { phase: string; consecutiveFrames: number }>>({});
    const phaseComparisonMetricsRef = useRef<Record<string, any[]>>({});
    const sessionHistoryRef = useRef<{ score: number; topCorrection: string | null }[]>([]);
    const racketPresenceScoreRef = useRef(0);
    const ballPresenceScoreRef = useRef(0);
    const ballTrackRef = useRef<{ x: number; y: number; vx: number; vy: number; misses: number } | null>(null);
    const handednessScoreRef = useRef(0);
    const detectedHandednessRef = useRef<'right' | 'left'>('right');
    const prevWristPositionsRef = useRef<{ left: { x: number; y: number; t: number } | null; right: { x: number; y: number; t: number } | null }>({ left: null, right: null });
    const previousHandRollRef = useRef<{ palmAxis: Vector3; timestamp: number } | null>(null);
    const handAxisHistoryRef = useRef<Array<{ t: number; palmAcross: Vector3 }>>([]);
    const contactPronationStateRef = useRef<{
        contactEnteredAt: number | null;
        preAxis: Vector3 | null;
        netAngleDeg: number | null;
        loggedForRep: boolean;
    }>({ contactEnteredAt: null, preAxis: null, netAngleDeg: null, loggedForRep: false });
    const backViewTrackingRef = useRef({
        samples: 0,
        fullArmSamples: 0,
        shoulderLineSamples: 0,
        overheadWristSamples: 0,
    });

    const uploadedFeedbackRef = useRef<string[]>([]);
    const uploadStartTimeRef = useRef<number>(0);
    const uploadedVideoUrlRef = useRef<string | null>(null);
    const uploadedReferenceUrlRef = useRef<string | null>(null);
    const showReferenceOverlayRef = useRef(true);

    const [skill, setSkill] = useState<'serve' | 'forehand' | 'backhand'>('serve');
    const [isInitialized, setIsInitialized] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset reference when skill changes
    useEffect(() => {
        defaultRefAttemptedRef.current = false;
        coachRef.current?.clearReferenceTargets?.();
    }, [skill]);
    const [feedback, setFeedback] = useState<string>('Ready to coach!');
    const [currentPhase, setCurrentPhase] = useState<string>('start');
    const [phaseProgress, setPhaseProgress] = useState(0);
    const [detectedErrors, setDetectedErrors] = useState<any[]>([]);
    const [motionCount, setMotionCount] = useState(0);
    const [shadowSetComparisons, setShadowSetComparisons] = useState<Array<{
        matchScore: number;
        metrics: any[];
    }>>([]);
    const [phaseSequence, setPhaseSequence] = useState<string[]>([]);
    const [isInMotion, setIsInMotion] = useState(false);
    const [useVideoUpload, setUseVideoUpload] = useState(false);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [cameraAngle, setCameraAngle] = useState<'side' | 'back'>('side');
    const [videoFileName, setVideoFileName] = useState('');
    const [videoProgress, setVideoProgress] = useState('');
    const [analysisMode, setAnalysisMode] = useState<'shadow' | 'equipment'>('shadow');
    const [detectedHandedness, setDetectedHandedness] = useState<'right' | 'left'>('right');
    const [speechMode, setSpeechMode] = useState<'en' | 'zh-cantonese-first'>('en');
    const [referenceStatus, setReferenceStatus] = useState('No pro reference loaded');
    const [serveReferenceUrl, setServeReferenceUrl] = useState<string | null>(
        () => referenceVideoService.getLiveTennisServeReference()?.url ?? DEFAULT_SERVE_REFERENCE_URL
    );
    const [isCalibratingReference, setIsCalibratingReference] = useState(false);
    const [showReferenceOverlay, setShowReferenceOverlay] = useState(true);
    useEffect(() => {
        showReferenceOverlayRef.current = showReferenceOverlay;
    }, [showReferenceOverlay]);
    const [isMobileDevice, setIsMobileDevice] = useState(() => {
        const isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        return isMobileUA || isTouch;
    });
    const [performanceMode, setPerformanceMode] = useState<'balanced' | 'battery'>('balanced');
    const [backViewResult, setBackViewResult] = useState<{
        armPathTracked: boolean;
        shoulderLineTracked: boolean;
        wristReachedOverhead: boolean;
    } | null>(null);

    const FEEDBACK_COOLDOWN_MS = 2500;
    const NEXT_MOTION_RESET_MS = 4500;
    const VIDEO_ANALYSIS_MAX_TIME = 120000;

    const isRearCameraMode = !useVideoUpload && facingMode === 'environment';

    const processingIntervalMs = useMemo(() => {
        if (useVideoUpload) return 33; // Faster processing for uploaded videos

        let interval = 33; // Base interval for desktop
        if (isMobileDevice) {
            interval = isRearCameraMode ? 45 : 40;
        }
        if (performanceMode === 'battery') {
            interval += 15; // Slightly increase interval in battery saver mode
        }
        return interval;
    }, [isMobileDevice, isRearCameraMode, performanceMode, useVideoUpload]);

    const ballDetectionStride = useMemo(() => {
        if (useVideoUpload) return 2;

        let stride = 3;
        if (isMobileDevice) {
            stride = isRearCameraMode ? 4 : 3;
        }
        if (performanceMode === 'battery') {
            stride += 1;
        }
        return stride;
    }, [isMobileDevice, isRearCameraMode, performanceMode, useVideoUpload]);

    const detectionCanvasWidth = useMemo(() => {
        if (useVideoUpload) return 224;
        return isMobileDevice && isRearCameraMode ? 192 : 224;
    }, [isMobileDevice, isRearCameraMode, useVideoUpload]);

    const detectionCanvasHeight = useMemo(() => Math.round(detectionCanvasWidth * 0.75), [detectionCanvasWidth]);
    const isGroundstrokeSkill = skill === 'forehand' || skill === 'backhand';

    const mapStageToCoachPhase = useCallback((stage: string): string => {
        if (isGroundstrokeSkill) {
            if (stage === 'start') return 'preparation';
            if (stage === 'release') return 'unit_turn';
            if (stage === 'loading') return 'drop';
            if (stage === 'cocking') return 'loading';
            if (stage === 'acceleration' || stage === 'contact') return 'contact';
            if (stage === 'deceleration' || stage === 'follow_through') return 'follow_through';
            return 'preparation';
        }

        if (stage === 'start') return 'preparation';
        if (stage === 'release') return 'ball_toss';
        if (stage === 'loading' || stage === 'cocking') return 'loading';
        if (stage === 'acceleration' || stage === 'contact') return 'contact';
        if (stage === 'deceleration' || stage === 'finish') return 'finish';
        return 'preparation';
    }, [isGroundstrokeSkill]);

    const formatStageLabel = useCallback((stage: string): string => {
        const labels: Record<string, string> = {
            start: 'Start',
            release: isGroundstrokeSkill ? 'Unit Turn' : 'Ball Toss',
            loading: 'Loading',
            cocking: isGroundstrokeSkill ? 'Drop' : 'Cocking',
            acceleration: 'Acceleration',
            contact: 'Contact',
            deceleration: isGroundstrokeSkill ? 'Follow Through' : 'Finish',
            finish: 'Finish',
            follow_through: 'Follow Through',
            preparation: 'Preparation',
            unit_turn: 'Unit Turn',
            drop: 'Drop',
            ball_toss: 'Ball Toss',
        };

        return labels[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    }, [isGroundstrokeSkill]);

    const getMonotonicMediaPipeTimestamp = useCallback((rawTimestampMs: number): number => {
        const timestampMs = Math.max(Math.round(rawTimestampMs), lastMediaPipeTimestampRef.current + 1);
        lastMediaPipeTimestampRef.current = timestampMs;
        return timestampMs;
    }, []);

    const localizeForChineseSpeech = useCallback((text: string): string => {
        return text
            .replace(/Right side cue:/gi, '右侧提示：')
            .replace(/Left side cue:/gi, '左侧提示：')
            .replace(/\bright\b/gi, '右')
            .replace(/\bleft\b/gi, '左')
            .replace(/elbow/gi, '手肘')
            .replace(/wrist/gi, '手腕')
            .replace(/arm/gi, '手臂')
            .replace(/shoulder/gi, '肩膀')
            .replace(/contact point/gi, '击球点')
            .replace(/contact/gi, '击球')
            .replace(/toss/gi, '抛球');
    }, []);

    const speakFeedback = useCallback((text: string, force = false) => {
        const now = Date.now();
        if (!force && now - lastSpokenAtRef.current < FEEDBACK_COOLDOWN_MS) {
            return;
        }

        lastSpokenAtRef.current = now;
        const speechText = speechMode === 'zh-cantonese-first'
            ? localizeForChineseSpeech(text)
            : text;

        setFeedback(speechText);
        uploadedFeedbackRef.current.push(speechText);

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(speechText);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                let premiumVoice: SpeechSynthesisVoice | undefined;
                let voiceLanguage = 'en-US';

                if (speechMode === 'zh-cantonese-first') {
                    // Priority 1: Try Cantonese (yue/zh-HK/zh-MO)
                    const yueVoices = voices.filter((v) => /(^yue)|zh-HK|zh-MO/i.test(v.lang));
                    if (yueVoices.length > 0) {
                        premiumVoice = yueVoices.find((v) => v.localService) || yueVoices[0];
                        voiceLanguage = premiumVoice.lang;
                    }

                    // Priority 2: If no Cantonese, try any Chinese (zh-CN, etc.)
                    if (!premiumVoice) {
                        const zhVoices = voices.filter((v) => /^zh/i.test(v.lang));
                        if (zhVoices.length > 0) {
                            premiumVoice = zhVoices.find((v) => v.localService) || zhVoices[0];
                            voiceLanguage = premiumVoice.lang;
                        }
                    }

                    // Priority 3: If no Chinese voices exist, inform user and fall back to English
                    if (!premiumVoice) {
                        console.warn('No Cantonese or Mandarin voices found on this device. Falling back to English.');
                        setFeedback('(Note: Cantonese not available on this device. Using English instead.)');

                        const enVoices = voices.filter(v => v.lang.startsWith('en'));
                        premiumVoice = enVoices.find(v => (v.name.includes('Siri') || v.name.includes('Samantha') || v.name.includes('Google')) && v.localService) || enVoices.find(v => v.localService) || enVoices[0];
                        voiceLanguage = 'en-US';
                    }

                    utterance.lang = voiceLanguage;
                } else {
                    // English mode: prefer native English voices
                    const enVoices = voices.filter(v => v.lang.startsWith('en'));
                    premiumVoice = enVoices.find(v => (v.name.includes('Siri') || v.name.includes('Samantha') || v.name.includes('Google')) && v.localService) || enVoices.find(v => v.localService) || enVoices[0];
                    utterance.lang = premiumVoice?.lang || 'en-US';
                }

                // CRITICAL: Always set a voice to ensure proper language is used
                if (premiumVoice) {
                    utterance.voice = premiumVoice;
                }
            }

            window.speechSynthesis.speak(utterance);
        }
    }, [localizeForChineseSpeech, speechMode]);

    const resetMotionFeedbackTracking = useCallback(() => {
        motionChecksRef.current = 0;
        motionReferenceMatchesRef.current = 0;
        motionCorrectionsRef.current = {};
        motionErrorEvidenceRef.current = {};
        phaseComparisonMetricsRef.current = {};
    }, []);

    const resetForNextMotion = useCallback(() => {
        advancedPhaseDetectorRef.current?.reset();
        motionStartedRef.current = false;
        motionEndedRef.current = false;
        lowElbowWarningStreakRef.current = 0;
        lockedSequenceRef.current = null;
        lockedPhaseRef.current = 'start';
        previousPhaseRef.current = 'start';
        decelerationStartFrameRef.current = null;
        completionPendingSinceRef.current = null;
        setCurrentPhase('start');
        setPhaseProgress(0);
        setPhaseSequence([]);
        setDetectedErrors([]);
        setIsInMotion(false);
        setAnalysisMode('shadow');
        racketPresenceScoreRef.current = 0;
        ballPresenceScoreRef.current = 0;
        ballTrackRef.current = null;
        handednessScoreRef.current = 0;
        detectedHandednessRef.current = 'right';
        prevWristPositionsRef.current = { left: null, right: null };
        backViewTrackingRef.current = { samples: 0, fullArmSamples: 0, shoulderLineSamples: 0, overheadWristSamples: 0 };
        setBackViewResult(null);
        setDetectedHandedness('right');
        resetMotionFeedbackTracking();
    }, [resetMotionFeedbackTracking]);

    const updateDetectedHandedness = useCallback((
        landmarks: any[],
        racketDetection: { x: number; y: number; confidence: number } | null
    ): { handedness: 'right' | 'left' } => {
        const leftWrist = landmarks?.[15];
        const rightWrist = landmarks?.[16];
        const leftVisible = !!leftWrist && (leftWrist.visibility ?? 0) >= 0.35;
        const rightVisible = !!rightWrist && (rightWrist.visibility ?? 0) >= 0.35;

        let delta = 0;
        const prev = prevWristPositionsRef.current;
        const now = performance.now();
        let leftSpeed = 0;
        let rightSpeed = 0;

        if (leftVisible && rightVisible && prev.left && prev.right) {
            const leftDx = leftWrist.x - prev.left.x;
            const leftDy = leftWrist.y - prev.left.y;
            const rightDx = rightWrist.x - prev.right.x;
            const rightDy = rightWrist.y - prev.right.y;
            const dtSeconds = Math.max(0.001, (now - Math.min(prev.left.t, prev.right.t)) / 1000);

            leftSpeed = Math.sqrt(leftDx * leftDx + leftDy * leftDy) / dtSeconds;
            rightSpeed = Math.sqrt(rightDx * rightDx + rightDy * rightDy) / dtSeconds;

            if (rightSpeed > leftSpeed * 1.15) {
                delta += 1;
            } else if (leftSpeed > rightSpeed * 1.15) {
                delta -= 1;
            }
        }

        if (racketDetection && leftVisible && rightVisible) {
            const drx = racketDetection.x - rightWrist.x;
            const dry = racketDetection.y - rightWrist.y;
            const dlx = racketDetection.x - leftWrist.x;
            const dly = racketDetection.y - leftWrist.y;
            const distRight = Math.sqrt(drx * drx + dry * dry);
            const distLeft = Math.sqrt(dlx * dlx + dly * dly);

            if (distRight + 0.02 < distLeft) {
                delta += 2;
            } else if (distLeft + 0.02 < distRight) {
                delta -= 2;
            }
        }

        const decayed = handednessScoreRef.current * 0.92;
        handednessScoreRef.current = Math.max(-20, Math.min(20, decayed + delta));

        if (leftVisible) {
            prev.left = { x: leftWrist.x, y: leftWrist.y, t: now };
        }
        if (rightVisible) {
            prev.right = { x: rightWrist.x, y: rightWrist.y, t: now };
        }

        let nextHandedness = detectedHandednessRef.current;
        if (handednessScoreRef.current >= 3) {
            nextHandedness = 'right';
        } else if (handednessScoreRef.current <= -3) {
            nextHandedness = 'left';
        }

        if (nextHandedness !== detectedHandednessRef.current) {
            detectedHandednessRef.current = nextHandedness;
            setDetectedHandedness(nextHandedness);
        }

        return { handedness: detectedHandednessRef.current };
    }, []);

    const getHittingHandRoll = useCallback((
        handResults: any,
        poseLandmarks: any[],
        poseWorldLandmarks: any[] | undefined,
        handedness: 'right' | 'left',
        timestamp: number,
        coachPhase: string
    ): { landmarks: any[]; rollRateDegPerSecond: number; confidence: number; netRotationAngleDeg: number | null } | null => {
        const wristIndex = handedness === 'right' ? 16 : 15;
        const elbowIndex = handedness === 'right' ? 14 : 13;
        const poseWrist = poseLandmarks[wristIndex];
        const poseWorldWrist = poseWorldLandmarks?.[wristIndex];
        const poseWorldElbow = poseWorldLandmarks?.[elbowIndex];
        const candidateHands = handResults?.landmarks ?? [];
        const candidateWorldHands = handResults?.worldLandmarks ?? [];

        if (!poseWrist || !poseWorldWrist || !poseWorldElbow || candidateHands.length === 0) {
            previousHandRollRef.current = null;
            return null;
        }

        let selectedIndex = -1;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < candidateHands.length; index++) {
            const handWrist = candidateHands[index]?.[0];
            if (!handWrist) continue;
            const dx = handWrist.x - poseWrist.x;
            const dy = handWrist.y - poseWrist.y;
            const distance = dx * dx + dy * dy;
            if (distance < closestDistance) {
                closestDistance = distance;
                selectedIndex = index;
            }
        }

        const handLandmarks = selectedIndex >= 0 ? candidateHands[selectedIndex] : null;
        const handWorldLandmarks = selectedIndex >= 0 ? candidateWorldHands[selectedIndex] : null;
        const confidence = selectedIndex >= 0
            ? handResults?.handednesses?.[selectedIndex]?.[0]?.score ?? 0.7
            : 0;
        if (!handLandmarks || !handWorldLandmarks || closestDistance > 0.08 || confidence < 0.20) {
            previousHandRollRef.current = null;
            return null;
        }

        const forearmAxis = normalize3(subtract3(poseWorldWrist, poseWorldElbow));
        const palmAcross = normalize3(subtract3(handWorldLandmarks[5], handWorldLandmarks[17]));
        if (!forearmAxis || !palmAcross) {
            previousHandRollRef.current = null;
            return null;
        }

        // Rolling raw-axis history (kept independent of the forearm axis at capture
        // time) lets us later compare two moments in a single consistent plane —
        // see the contact-window block below.
        const axisHistory = handAxisHistoryRef.current;
        axisHistory.push({ t: timestamp, palmAcross });
        while (axisHistory.length > 0 && timestamp - axisHistory[0].t > 700) {
            axisHistory.shift();
        }

        // NET rotation through contact: a pancake serve keeps the palm/forearm
        // relationship roughly constant even while the arm swings fast, while a
        // real pronation snap rotates it sharply. Comparing two averaged moments
        // (just-before-contact vs shortly-after) is far more robust to per-frame
        // jitter and motion blur (common right at contact) than any single-frame
        // rate. We deliberately sample "after" ~130-800ms into contact/deceleration
        // rather than the exact contact frame, since that's often blurred/lost.
        const contactState = contactPronationStateRef.current;
        if (coachPhase === 'contact' && contactState.contactEnteredAt === null) {
            contactState.contactEnteredAt = timestamp;
            contactState.netAngleDeg = null;
            contactState.loggedForRep = false;
            let preSample = axisHistory[0] ?? null;
            for (const sample of axisHistory) {
                if (timestamp - sample.t >= 150) preSample = sample;
            }
            contactState.preAxis = preSample?.palmAcross ?? null;
        }
        if (
            contactState.contactEnteredAt !== null
            && contactState.netAngleDeg === null
            && contactState.preAxis
        ) {
            const sinceContact = timestamp - contactState.contactEnteredAt;
            if (sinceContact >= 130 && sinceContact <= 800) {
                const preProjected = projectPerpendicularTo(contactState.preAxis, forearmAxis);
                const postProjected = projectPerpendicularTo(palmAcross, forearmAxis);
                if (preProjected && postProjected) {
                    const netSine = dot3(forearmAxis, cross3(preProjected, postProjected));
                    const netCosine = Math.max(-1, Math.min(1, dot3(preProjected, postProjected)));
                    contactState.netAngleDeg = Math.abs(Math.atan2(netSine, netCosine) * 180 / Math.PI);
                    if (!contactState.loggedForRep) {
                        contactState.loggedForRep = true;
                        console.log(`[Pronation] Net forearm/hand rotation through contact: ${contactState.netAngleDeg.toFixed(0)} deg`);
                    }
                }
            }
        }
        const netRotationAngleDeg = contactState.netAngleDeg;

        const palmAxis = projectPerpendicularTo(palmAcross, forearmAxis);
        if (!palmAxis) {
            previousHandRollRef.current = null;
            return null;
        }

        const previous = previousHandRollRef.current;
        previousHandRollRef.current = { palmAxis, timestamp };
        if (!previous) return { landmarks: handLandmarks, rollRateDegPerSecond: 0, confidence, netRotationAngleDeg };

        const previousProjected = projectPerpendicularTo(previous.palmAxis, forearmAxis);
        const elapsedSeconds = (timestamp - previous.timestamp) / 1000;
        if (!previousProjected || elapsedSeconds < 0.02 || elapsedSeconds > 0.2) {
            return { landmarks: handLandmarks, rollRateDegPerSecond: 0, confidence, netRotationAngleDeg };
        }

        const sine = dot3(forearmAxis, cross3(previousProjected, palmAxis));
        const cosine = Math.max(-1, Math.min(1, dot3(previousProjected, palmAxis)));
        const rollRateDegPerSecond = Math.min(1800, Math.abs(Math.atan2(sine, cosine) * 180 / Math.PI) / elapsedSeconds);
        return { landmarks: handLandmarks, rollRateDegPerSecond, confidence, netRotationAngleDeg };
    }, []);

    const updateBackViewTracking = useCallback((landmarks: any[], handedness: 'right' | 'left') => {
        const leftShoulder = landmarks?.[11];
        const rightShoulder = landmarks?.[12];
        const elbow = landmarks?.[handedness === 'right' ? 14 : 13];
        const wrist = landmarks?.[handedness === 'right' ? 16 : 15];
        const visible = (landmark: any) => !!landmark && (landmark.visibility ?? 0) >= 0.5;
        const tracking = backViewTrackingRef.current;

        tracking.samples++;
        if (visible(leftShoulder) && visible(rightShoulder)) {
            tracking.shoulderLineSamples++;
        }
        if (visible(leftShoulder) && visible(rightShoulder) && visible(elbow) && visible(wrist)) {
            tracking.fullArmSamples++;
            const shoulderMidpointY = (leftShoulder.y + rightShoulder.y) / 2;
            if (wrist.y < shoulderMidpointY - 0.08) {
                tracking.overheadWristSamples++;
            }
        }
    }, []);

    const finalizeBackViewTracking = useCallback(() => {
        const tracking = backViewTrackingRef.current;
        const samples = Math.max(1, tracking.samples);
        const armPathTracked = tracking.fullArmSamples / samples >= 0.65;
        const shoulderLineTracked = tracking.shoulderLineSamples / samples >= 0.75;
        const wristReachedOverhead = tracking.overheadWristSamples >= 3;
        setBackViewResult({ armPathTracked, shoulderLineTracked, wristReachedOverhead });

        if (!armPathTracked || !shoulderLineTracked) {
            return 'Back view captured, but keep both shoulders, elbow, and wrist visible for the full serve to track the arm path.';
        }
        if (wristReachedOverhead) {
            return 'Back view tracked both shoulders and the serving arm. The wrist rose above the shoulder line during the motion.';
        }
        return 'Back view tracked both shoulders and the serving arm. The wrist did not rise clearly above the shoulder line in this recording.';
    }, []);

    const updateAnalysisMode = useCallback((
        racketDetection: { confidence: number } | null,
        ballDetection: { confidence: number } | null
    ): 'shadow' | 'equipment' => {
        const racketSeen = !!racketDetection && racketDetection.confidence >= 0.35;
        const ballSeen = !!ballDetection && ballDetection.confidence >= 0.2;

        racketPresenceScoreRef.current = racketSeen
            ? Math.min(20, racketPresenceScoreRef.current + 2)
            : Math.max(0, racketPresenceScoreRef.current - 1);

        ballPresenceScoreRef.current = ballSeen
            ? Math.min(20, ballPresenceScoreRef.current + 2)
            : Math.max(0, ballPresenceScoreRef.current - 1);

        const mode: 'shadow' | 'equipment' = (
            racketPresenceScoreRef.current >= 6 && ballPresenceScoreRef.current >= 4
        ) ? 'equipment' : 'shadow';

        setAnalysisMode(mode);
        return mode;
    }, []);

    const buildContactContext = useCallback((
        landmarks: any[],
        racketDetection: { x: number; y: number; confidence: number } | null,
        ballDetection: { x: number; y: number; confidence: number; radius: number } | null
    ) => {
        if (!racketDetection || !ballDetection) return undefined;

        const wrist = landmarks?.[16];
        if (!wrist) return undefined;

        const dxBallRacket = ballDetection.x - racketDetection.x;
        const dyBallRacket = ballDetection.y - racketDetection.y;
        const dxBallWrist = ballDetection.x - wrist.x;
        const dyBallWrist = ballDetection.y - wrist.y;

        return {
            ballToRacketDistance: Math.sqrt(dxBallRacket * dxBallRacket + dyBallRacket * dyBallRacket),
            ballToWristDistance: Math.sqrt(dxBallWrist * dxBallWrist + dyBallWrist * dyBallWrist),
            ballAheadOfWrist: ballDetection.x - wrist.x,
            ballVerticalOffsetFromWrist: ballDetection.y - wrist.y,
        };
    }, []);

    const resetMotionPipeline = useCallback(() => {
        frameCountRef.current = 0;
        resetForNextMotion();
    }, [resetForNextMotion]);

    useEffect(() => {
        // Swap detector + coach by selected skill so forehand/backhand are not analyzed by serve logic.
        coachRef.current = isGroundstrokeSkill
            ? new TennisGroundstrokeCoach()
            : new TennisServeCoach();

        advancedPhaseDetectorRef.current = isGroundstrokeSkill
            ? new AdvancedGroundstrokePhaseDetector()
            : new AdvancedServePhaseDetector({ allowUpperBodyShadowMode: true });

        resetMotionPipeline();
        setFeedback(isGroundstrokeSkill ? 'Ready to coach groundstrokes!' : 'Ready to coach serves!');
    }, [isGroundstrokeSkill, resetMotionPipeline]);

    const getSmartFeedback = useCallback(async (): Promise<string> => {
        const hasReference = coachRef.current.hasReferenceTargets();
        const checks = Math.max(1, motionChecksRef.current);
        const matchScore = Math.round((motionReferenceMatchesRef.current / checks) * 100);
        const topCorrectionKey = Object.entries(motionCorrectionsRef.current)
            .sort((a, b) => b[1] - a[1])[0]?.[0];

        const topCorrection = topCorrectionKey
            ? topCorrectionKey.charAt(0).toLowerCase() + topCorrectionKey.slice(1)
            : null;

        const getDirectionalCue = (text: string | null): string | null => {
            if (!text) return null;
            const normalized = text.replace(/\s+/g, ' ').trim();

            if (/\bright\b/i.test(normalized)) {
                return `Right side cue: ${normalized}`;
            }
            if (/\bleft\b/i.test(normalized)) {
                return `Left side cue: ${normalized}`;
            }

            const fallbackSide = detectedHandedness === 'right' ? 'right' : 'left';
            const fallbackLabel = detectedHandedness === 'right' ? 'Right' : 'Left';
            return `${fallbackLabel} side cue: focus on your ${fallbackSide} arm. ${normalized}`;
        };

        const directionalCue = getDirectionalCue(topCorrection);

        const getRuleBasedFeedback = (): string => {
            const randomElement = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
            const skillName = isGroundstrokeSkill ? 'shot' : 'serve';
            const motionCap = isGroundstrokeSkill ? 'Shot' : 'Serve';
            const zhSkillName = isGroundstrokeSkill ? '击球' : '发球';

            if (speechMode === 'zh-cantonese-first') {
                const localizedDirectionalCue = directionalCue ? localizeForChineseSpeech(directionalCue) : null;

                if (matchScore >= 95) {
                    return randomElement([
                        `非常好，这次${zhSkillName}节奏和时机都很接近职业动作。`,
                        `这球很漂亮，动作流畅，继续保持。`,
                        `做得很好，基本到位了，再来一球。`
                    ]);
                }

                if (matchScore >= 80) {
                    if (localizedDirectionalCue) {
                        return randomElement([
                            `整体不错，下一球重点：${localizedDirectionalCue}`,
                            `你已经很接近了，记住这个重点：${localizedDirectionalCue}`,
                            `很好，再微调一下：${localizedDirectionalCue}`
                        ]);
                    }
                    return randomElement([
                        `这次${zhSkillName}不错，继续稳定节奏。`,
                        `整体动作可以，再把时机做得更一致一点。`,
                        `很好，继续保持这个流畅度。`
                    ]);
                }

                if (localizedDirectionalCue) {
                    return randomElement([
                        `这球先别急，下一球只专注这点：${localizedDirectionalCue}`,
                        `我们简化一下，先做到：${localizedDirectionalCue}`,
                        `重来一球，记住：${localizedDirectionalCue}`
                    ]);
                }

                return randomElement([
                    `继续练，先把${zhSkillName}的节奏稳定下来。`,
                    `放松肩膀，动作连贯一点，再来。`,
                    `别急，顺着节奏做完整动作。`
                ]);
            }

            if (matchScore >= 95) {
                return randomElement([
                    `Outstanding ${skillName}. Your timing is perfectly in sync.`,
                    "Beautiful motion! That looked exactly like the pro.",
                    "Perfect execution! Keep doing exactly that.",
                    `Textbook ${skillName} right there. Incredible job.`,
                    "Flawless rhythm. Let's see if you can do it again."
                ]);
            }

            if (matchScore >= 80) {
                if (topCorrection) {
                    return randomElement([
                        `Really good fluid motion! You're super close. ${directionalCue}`,
                        `Looking solid right there. To get it perfect, ${directionalCue}`,
                        `Great effort! Just a tiny adjustment. ${directionalCue}`,
                        `Nice ${skillName}! One clear tip: ${directionalCue}`
                    ]);
                }
                return randomElement([
                    `Solid ${skillName}. You are very close to the pro reference. Keep refining that rhythm.`,
                    "Great work. The form is looking very consistent.",
                    "I like what I'm seeing! You're matching the timing well."
                ]);
            }

            if (topCorrection) {
                return randomElement([
                    `Okay, keep at it. On this next one, ${directionalCue}`,
                    `Not quite there yet. Let's simplify: ${directionalCue}`,
                    `Let's try that again. ${directionalCue}`,
                    `Alright, reset. Focus on this next rep: ${directionalCue}`,
                    `Remember your basics. Next ${skillName}: ${directionalCue}`,
                    `Let's brush that off and go again. ${directionalCue}`
                ]);
            }

            return randomElement([
                "Keep swinging. Try to match the pro reference rhythm and find that contact timing better.",
                "A bit off that time. Relax your shoulders and let's try it again.",
                "Don't rush it. Let the motion flow a bit more smoothly next time."
            ]);
        };

        if (!hasReference) {
            if (speechMode === 'zh-cantonese-first') {
                return isGroundstrokeSkill
                    ? '本次击球完成。上传职业参考视频后，可以获得更详细的时机反馈。'
                    : '本次发球完成。上传职业参考视频后，可以获得更详细的时机反馈。';
            }

            const motionCap = isGroundstrokeSkill ? 'Shot' : 'Serve';
            return `${motionCap} complete. Upload a pro reference to get detailed timing feedback.`;
        }

        const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
        const skillName = isGroundstrokeSkill ? 'shot' : 'serve';

        const currentMotionData = { score: matchScore, topCorrection };
        const history = sessionHistoryRef.current.slice(-6); // Keep last 6 motions for context
        sessionHistoryRef.current.push(currentMotionData); // Save current motion for future

        if (!apiKey) {
            return getRuleBasedFeedback();
        }

        let coachContext = `You are an elite tennis coach. Give the player a concise, encouraging 15-30 word tip about their ${skillName}. Be direct, conversational, and patient.`;
        coachContext += ` If the flaw text contains LEFT or RIGHT, you MUST keep the same side word explicitly in the final tip.`;
        if (speechMode === 'zh-cantonese-first') {
            coachContext += ' Respond in Traditional Chinese with spoken Cantonese style. If Cantonese wording is uncertain, use clear Mandarin Chinese.';
        }
        if (history.length > 0) {
            const historyText = history.map((s, i) => `${skillName} -${history.length - i}: Score ${s.score}, Error: ${s.topCorrection || "None"}`).join(' | ');
            coachContext += `\nPast ${skillName}s history: ${historyText}\nNotice if they are fixing past mistakes, repeating the same error, or struggling with a new one. Acknowledge improvements warmly. Patiently remind them if they forgot previous lessons.`;
        }

        try {
            const response = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        {
                            role: "system",
                            content: coachContext
                        },
                        {
                            role: "user",
                            content: `Current ${skillName} -> flaw: ${topCorrection || "none detected"}. match score: ${matchScore}/100.`
                        }
                    ],
                    max_tokens: 80
                })
            });

            if (!response.ok) {
                console.error("DeepSeek API error response:", response.status);
                return getRuleBasedFeedback();
            }

            const data = await response.json();
            const aiText = data.choices[0].message.content.replace(/["*]/g, ''); // Clean up any quotes or markdown

            // Guarantee side-specific cue is audible even if model summary becomes generic.
            if (directionalCue && !/\bleft\b|\bright\b|左|右/i.test(aiText)) {
                const cue = speechMode === 'zh-cantonese-first'
                    ? localizeForChineseSpeech(directionalCue)
                    : directionalCue;
                return `${cue} ${aiText}`;
            }

            return aiText;
        } catch (error) {
            console.error("DeepSeek API error:", error);
            // Fallback to rule-based feedback on network/fetch error
            return getRuleBasedFeedback();
        }
    }, [detectedHandedness, isGroundstrokeSkill, localizeForChineseSpeech, speechMode]);

    const finalizeMotion = useCallback(async (phase: string, sequence: string[]) => {
        if (motionEndedRef.current) return;

        motionEndedRef.current = true;
        lockedSequenceRef.current = [...sequence];
        lockedPhaseRef.current = phase;

        setMotionCount((prev) => prev + 1);
        setIsInMotion(false);

        const skillName = isGroundstrokeSkill ? 'shot' : 'serve';
        const skillNameZh = isGroundstrokeSkill ? '击球' : '发球';
        const topCorrection = Object.entries(motionCorrectionsRef.current)
            .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)[0]?.[0] ?? null;
        const matchScore = motionChecksRef.current > 0
            ? Math.round((motionReferenceMatchesRef.current / motionChecksRef.current) * 100)
            : 0;

        if (!isGroundstrokeSkill) {
            setShadowSetComparisons((previous) => {
                if (previous.length >= 5) return previous;
                return [...previous, {
                    matchScore,
                    metrics: Object.values(phaseComparisonMetricsRef.current).flat(),
                }];
            });
        }

        const backViewLineEn = cameraAngle === 'back' ? finalizeBackViewTracking() : null;
        const completionLineEn = isGroundstrokeSkill
            ? 'Shot captured. Preparing your next-repetition cue.'
            : 'Serve captured. Preparing your next-serve cue.';
        const completionLineZh = isGroundstrokeSkill
            ? '已记录击球动作，正在准备下一次练习提示。'
            : '已记录发球动作，正在准备下一次发球提示。';

        setFeedback(
            speechMode === 'zh-cantonese-first'
                ? completionLineZh
                : backViewLineEn ? `${backViewLineEn} ${completionLineEn}` : completionLineEn
        );

        const nextRepCue = await getSmartFeedback();
        if (!isRunningRef.current) return;

        const coachedFeedback = backViewLineEn && speechMode !== 'zh-cantonese-first'
            ? `${backViewLineEn} ${nextRepCue}`
            : nextRepCue;
        speakFeedback(coachedFeedback, true);

        if (nextMotionResetTimeoutRef.current) {
            clearTimeout(nextMotionResetTimeoutRef.current);
        }

        nextMotionResetTimeoutRef.current = setTimeout(() => {
            if (!isRunningRef.current) return;
            resetForNextMotion();
            setFeedback(speechMode === 'zh-cantonese-first' ? `准备好下一次${skillNameZh}。` : `Ready for next ${skillName}.`);
        }, NEXT_MOTION_RESET_MS);
    }, [NEXT_MOTION_RESET_MS, resetForNextMotion, speakFeedback, getSmartFeedback, isGroundstrokeSkill, speechMode, cameraAngle, finalizeBackViewTracking]);


    const waitForSeek = (video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            reject(new Error('Seek timeout on reference video'));
        }, 10000);

        const onSeeked = () => {
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            resolve();
        };
        video.addEventListener('seeked', onSeeked);
    });

    const buildReferenceTargets = (metrics: Record<string, Array<Record<string, number>>>): ReferencePhaseTargets => {
        const phaseMean = (phase: string, key: string, fallback: number) => {
            const values = (metrics[phase] || [])
                .map((sample) => sample[key])
                .filter((value) => typeof value === 'number' && isFinite(value));
            if (values.length === 0) return fallback;
            return values.reduce((sum, value) => sum + value, 0) / values.length;
        };

        return {
            preparation: {
                shoulderWidth: phaseMean('preparation', 'shoulderWidth', 0.25),
                elbowOffset: phaseMean('preparation', 'elbowOffset', 0),
            },
            ball_toss: {
                shoulderWidth: phaseMean('ball_toss', 'shoulderWidth', 0.25),
                wristRelativeY: phaseMean('ball_toss', 'wristRelativeY', -0.1),
            },
            loading: {
                shoulderWidth: phaseMean('loading', 'shoulderWidth', 0.25),
                elbowOffset: phaseMean('loading', 'elbowOffset', 0),
                wristRelativeY: phaseMean('loading', 'wristRelativeY', 0.05),
                shoulderRotation: phaseMean('loading', 'shoulderRotation', 25),
            },
            contact: {
                shoulderWidth: phaseMean('contact', 'shoulderWidth', 0.25),
                elbowOffset: phaseMean('contact', 'elbowOffset', 0.1),
                wristMinusElbowX: phaseMean('contact', 'wristMinusElbowX', 0.05),
                wristRelativeY: phaseMean('contact', 'wristRelativeY', -0.12),
            },
            finish: {
                shoulderWidth: phaseMean('finish', 'shoulderWidth', 0.25),
                wristMinusShoulderX: phaseMean('finish', 'wristMinusShoulderX', -0.05),
            },
        };
    };

    const calibrateReferenceVideoUrl = useCallback(async (url: string, sourceName: string) => {
        if (!landmarkerRef.current) {
            setReferenceStatus('Pose model not ready yet. Try again in a moment.');
            return;
        }

        const cacheKey = `motiontutor_calib_v3_${encodeURIComponent(url)}`;
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsedTargets = JSON.parse(cached);
                coachRef.current.setReferenceTargets(parsedTargets, sourceName);
                setReferenceStatus(`Reference ready from cache: ${sourceName}`);
                setFeedback(
                    isGroundstrokeSkill
                        ? 'Reference-based coaching active. Your groundstroke will be compared to the pro timing.'
                        : 'Reference-based coaching active. Your serve will be compared to the pro timing.'
                );
                return;
            }
        } catch (e) {
            console.warn("Failed to parse cached reference metrics:", e);
        }

        setIsCalibratingReference(true);
        setReferenceStatus('Calibrating pro reference...');

        const tempVideo = document.createElement('video');
        tempVideo.crossOrigin = 'anonymous';
        tempVideo.muted = true;
        tempVideo.playsInline = true;
        tempVideo.preload = 'auto';
        tempVideo.src = url;
        tempVideo.load();

        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout loading reference metadata. Autoplay might be blocked by mobile device.')), 5000);
                tempVideo.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    resolve();
                };
                tempVideo.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('Failed to load reference video metadata'));
                };
            });

            const duration = Math.max(0, tempVideo.duration || 0);
            if (!isFinite(duration) || duration <= 0) {
                throw new Error('Reference video duration is invalid');
            }

            const detector = isGroundstrokeSkill
                ? new AdvancedGroundstrokePhaseDetector()
                : new AdvancedServePhaseDetector();
            let sampledFrames = 0;
            const perPhaseMetrics: Record<string, Array<Record<string, number>>> = isGroundstrokeSkill
                ? {
                    preparation: [],
                    unit_turn: [],
                    drop: [],
                    loading: [],
                    contact: [],
                    follow_through: [],
                }
                : {
                    preparation: [],
                    ball_toss: [],
                    loading: [],
                    contact: [],
                    finish: [],
                };

            const step = 1 / 20;
            for (let t = 0; t <= duration; t += step) {
                tempVideo.currentTime = Math.min(duration, t);
                await waitForSeek(tempVideo);

                // Ensure video has actual dimensions before sending to MediaPipe to avoid WebGL crashes
                if (tempVideo.videoWidth === 0 || tempVideo.videoHeight === 0 || tempVideo.readyState < 2) {
                    continue;
                }

                const ts = getMonotonicMediaPipeTimestamp(tempVideo.currentTime * 1000);
                const results = landmarkerRef.current.detectForVideo(tempVideo, ts);
                if (!results.landmarks || results.landmarks.length === 0) continue;

                const landmarks = results.landmarks[0];
                const stage = detector.updatePhase(landmarks);
                const coachPhase = mapStageToCoachPhase(stage);
                const snapshot = isGroundstrokeSkill
                    ? TennisGroundstrokeCoach.extractPhaseMetricSnapshot(landmarks)
                    : TennisServeCoach.extractPhaseMetricSnapshot(landmarks);
                if (!snapshot) continue;

                perPhaseMetrics[coachPhase].push(snapshot as unknown as Record<string, number>);
                sampledFrames++;
            }

            if (sampledFrames < 20) {
                throw new Error('Not enough valid frames in pro reference video');
            }

            const targets = buildReferenceTargets(perPhaseMetrics);
            try {
                localStorage.setItem(cacheKey, JSON.stringify(targets));
            } catch (e) {
                console.warn("Could not save reference cache:", e);
            }
            coachRef.current.setReferenceTargets(targets, sourceName);
            setReferenceStatus(`Reference ready: ${sourceName} (${sampledFrames} sampled frames)`);
            setFeedback(
                isGroundstrokeSkill
                    ? 'Reference-based coaching active. Your groundstroke will be compared to the pro timing.'
                    : 'Reference-based coaching active. Your serve will be compared to the pro timing.'
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setReferenceStatus(`Reference calibration failed: ${message}`);
        } finally {
            setIsCalibratingReference(false);
        }
    }, [getMonotonicMediaPipeTimestamp, isGroundstrokeSkill, mapStageToCoachPhase]);

    const calibrateReferenceVideo = useCallback(async (file: File) => {
        if (uploadedReferenceUrlRef.current) {
            URL.revokeObjectURL(uploadedReferenceUrlRef.current);
        }
        const url = URL.createObjectURL(file);
        uploadedReferenceUrlRef.current = url;
        setServeReferenceUrl(url);
        await calibrateReferenceVideoUrl(url, file.name);
    }, [calibrateReferenceVideoUrl]);

    const defaultRefAttemptedRef = useRef(false);

    useEffect(() => {
        if (!isInitialized || isGroundstrokeSkill || defaultRefAttemptedRef.current) return;
        defaultRefAttemptedRef.current = true;
        const libraryReference = referenceVideoService.getLiveTennisServeReference();
        if (libraryReference) {
            setServeReferenceUrl(libraryReference.url);
            calibrateReferenceVideoUrl(libraryReference.url, libraryReference.title);
            return;
        }

        setServeReferenceUrl(DEFAULT_SERVE_REFERENCE_URL);
        calibrateReferenceVideoUrl(DEFAULT_SERVE_REFERENCE_URL, 'Novak Djokovic Serve (Side View)');
    }, [calibrateReferenceVideoUrl, isGroundstrokeSkill, isInitialized]);

    useEffect(() => {
        const isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        setIsMobileDevice(isMobileUA || isTouch);
    }, []);

    const initializeCameraAndModel = useCallback(async () => {
        try {
            setError(null);
            if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Requesting camera and pose model');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode,
                    width: { ideal: isMobileDevice && facingMode === 'environment' ? 480 : 640, max: isMobileDevice ? 960 : 1280 },
                    height: { ideal: isMobileDevice && facingMode === 'environment' ? 360 : 480, max: isMobileDevice ? 720 : 720 },
                    frameRate: { ideal: 30, max: 30 },
                },
                audio: false,
            });
            cameraStreamRef.current = stream;
            if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Camera stream acquired');

            if (videoRef.current && !useVideoUpload) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = true;
                videoRef.current.playsInline = true;
                try {
                    await videoRef.current.play();
                } catch {
                    // Autoplay can fail until user interaction.
                }
            }

            const resolver = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
            );

            landmarkerRef.current = await createLandmarkerWithFallback(resolver);
            if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Pose model ready');

            // Real racket/ball detection (ONNX Runtime WASM) is desktop-only again.
            // Running it concurrently with two GPU-delegate MediaPipe models (pose +
            // hand) on phones was almost certainly why the app was crashing/getting
            // killed mid-session on mobile — three concurrent inference runtimes is
            // too much sustained memory/GPU pressure for many phones. It's also no
            // longer required for the core pancake-vs-snap pronation verdict, which
            // now runs entirely on the Hand Landmarker net-rotation-angle signal
            // (see coaching-calibration notes). Heuristic wrist/elbow racket
            // estimation remains the mobile fallback.
            if (!isMobileDevice && !yoloObjectsInitTriedRef.current) {
                yoloObjectsInitTriedRef.current = true;
                YoloObjectsService.initialize()
                    .then(() => {
                        yoloObjectsReadyRef.current = true;
                    })
                    .catch((yoloErr) => {
                        console.warn('[LiveCoaching] Real racket/ball detection unavailable, falling back to heuristic detection.', yoloErr);
                    });
            }

            if (canvasRef.current) {
                painterRef.current = new PosePainter(canvasRef.current);
            }

            advancedPhaseDetectorRef.current = isGroundstrokeSkill
                ? new AdvancedGroundstrokePhaseDetector()
                : new AdvancedServePhaseDetector({ allowUpperBodyShadowMode: true });
            lastMediaPipeTimestampRef.current = 0;
            setIsInitialized(true);
            if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Live coaching initialization complete');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[LiveCoaching] Camera/ML initialization failed', err);
            if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Camera/ML initialization failed', err);
            setError(`Camera/ML initialization failed: ${message}`);
        }
    }, [useVideoUpload, facingMode, isMobileDevice, isGroundstrokeSkill]);

    const toggleCamera = useCallback(async () => {
        const newMode = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(newMode);

        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach((track) => track.stop());
            cameraStreamRef.current = null;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: newMode,
                    width: { ideal: isMobileDevice && newMode === 'environment' ? 480 : 640, max: isMobileDevice ? 960 : 1280 },
                    height: { ideal: isMobileDevice && newMode === 'environment' ? 360 : 480, max: isMobileDevice ? 720 : 720 },
                    frameRate: { ideal: 30, max: 30 },
                },
                audio: false,
            });
            cameraStreamRef.current = stream;

            if (videoRef.current && !useVideoUpload) {
                videoRef.current.srcObject = stream;
                try {
                    await videoRef.current.play();
                } catch {
                    // Autoplay may fail
                }
            }
        } catch (err) {
            console.error("Camera switch failed:", err);
            setError("Failed to switch camera.");
        }
    }, [facingMode, useVideoUpload, isMobileDevice]);

    const attachCameraStream = useCallback(async () => {
        if (!cameraStreamRef.current || !videoRef.current) return;
        videoRef.current.srcObject = cameraStreamRef.current;
        videoRef.current.muted = true;
        videoRef.current.currentTime = 0;
        try {
            await videoRef.current.play();
        } catch {
            // User action may be required in some browsers.
        }
    }, []);

    const rgbToHsv = (r: number, g: number, b: number) => {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;

        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const delta = max - min;

        let h = 0;
        if (delta > 1e-6) {
            if (max === rn) {
                h = ((gn - bn) / delta) % 6;
            } else if (max === gn) {
                h = (bn - rn) / delta + 2;
            } else {
                h = (rn - gn) / delta + 4;
            }
            h *= 60;
            if (h < 0) h += 360;
        }

        const s = max <= 1e-6 ? 0 : delta / max;
        const v = max;
        return { h, s, v };
    };

    const isLikelyTennisBallPixel = (r: number, g: number, b: number) => {
        const { h, s, v } = rgbToHsv(r, g, b);
        const hsvMatch = h >= 28 && h <= 95 && s >= 0.22 && v >= 0.22;
        const rgbMatch = g > r * 0.82 && g > b * 1.15 && (r + g) > 130;
        return hsvMatch && rgbMatch;
    };

    const detectBall = (imageData: ImageData, width: number, height: number) => {
        const data = imageData.data;

        const totalPixels = width * height;
        const mask = new Uint8Array(totalPixels);
        let candidatePixels = 0;

        for (let p = 0; p < totalPixels; p++) {
            const i = p * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            if (isLikelyTennisBallPixel(r, g, b)) {
                mask[p] = 1;
                candidatePixels++;
            }
        }

        if (candidatePixels < 8) {
            if (ballTrackRef.current) {
                ballTrackRef.current.misses = Math.min(12, ballTrackRef.current.misses + 1);
                if (ballTrackRef.current.misses > 6) {
                    ballTrackRef.current = null;
                }
            }
            return null;
        }

        type Component = {
            area: number;
            sumX: number;
            sumY: number;
            minX: number;
            minY: number;
            maxX: number;
            maxY: number;
        };

        const visited = new Uint8Array(totalPixels);
        const stack: number[] = [];
        const components: Component[] = [];

        for (let start = 0; start < totalPixels; start++) {
            if (!mask[start] || visited[start]) continue;

            let area = 0;
            let sumX = 0;
            let sumY = 0;
            let minX = width;
            let minY = height;
            let maxX = 0;
            let maxY = 0;

            stack.push(start);
            visited[start] = 1;

            while (stack.length > 0) {
                const idx = stack.pop() as number;
                const x = idx % width;
                const y = Math.floor(idx / width);

                area++;
                sumX += x;
                sumY += y;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;

                const left = idx - 1;
                const right = idx + 1;
                const up = idx - width;
                const down = idx + width;

                if (x > 0 && mask[left] && !visited[left]) {
                    visited[left] = 1;
                    stack.push(left);
                }
                if (x < width - 1 && mask[right] && !visited[right]) {
                    visited[right] = 1;
                    stack.push(right);
                }
                if (y > 0 && mask[up] && !visited[up]) {
                    visited[up] = 1;
                    stack.push(up);
                }
                if (y < height - 1 && mask[down] && !visited[down]) {
                    visited[down] = 1;
                    stack.push(down);
                }
            }

            components.push({ area, sumX, sumY, minX, minY, maxX, maxY });
        }

        const prev = ballTrackRef.current;
        const expectedX = prev ? (prev.x + prev.vx) : 0.5;
        const expectedY = prev ? (prev.y + prev.vy) : 0.5;

        let best: { x: number; y: number; confidence: number; radius: number; score: number } | null = null;

        for (const c of components) {
            if (c.area < 6 || c.area > 420) continue;

            const bboxW = c.maxX - c.minX + 1;
            const bboxH = c.maxY - c.minY + 1;
            if (bboxW <= 0 || bboxH <= 0) continue;

            const aspect = bboxW / bboxH;
            if (aspect < 0.45 || aspect > 2.2) continue;

            const fillRatio = c.area / (bboxW * bboxH);
            if (fillRatio < 0.24) continue;

            const cx = (c.sumX / c.area) / width;
            const cy = (c.sumY / c.area) / height;
            const radius = Math.sqrt(c.area / Math.PI) / Math.max(width, height);

            const dx = cx - expectedX;
            const dy = cy - expectedY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const trackScore = prev ? Math.max(0, 1 - (dist / 0.26)) : 0.65;
            const areaScore = Math.min(1, c.area / 120);
            const shapeScore = Math.min(1, Math.max(0, fillRatio * 1.2));

            const score = (areaScore * 0.35) + (shapeScore * 0.3) + (trackScore * 0.35);
            const confidence = Math.max(0.15, Math.min(1, score));

            if (!best || score > best.score) {
                best = { x: cx, y: cy, confidence, radius, score };
            }
        }

        if (!best) {
            if (ballTrackRef.current) {
                ballTrackRef.current.misses = Math.min(12, ballTrackRef.current.misses + 1);
                if (ballTrackRef.current.misses > 6) {
                    ballTrackRef.current = null;
                }
            }
            return null;
        }

        if (prev) {
            ballTrackRef.current = {
                x: best.x,
                y: best.y,
                vx: best.x - prev.x,
                vy: best.y - prev.y,
                misses: 0,
            };
        } else {
            ballTrackRef.current = { x: best.x, y: best.y, vx: 0, vy: 0, misses: 0 };
        }

        return {
            x: best.x,
            y: best.y,
            confidence: best.confidence,
            radius: best.radius,
        };
    };

    const detectRacket = (landmarks: any[]) => {
        if (!landmarks || landmarks.length < 17) return null;

        const buildCandidate = (wristIdx: number, elbowIdx: number) => {
            const wrist = landmarks[wristIdx];
            const elbow = landmarks[elbowIdx];

            if (!wrist || !elbow) return null;
            if ((wrist.visibility ?? 0) < 0.3 || (elbow.visibility ?? 0) < 0.3) return null;

            const dx = wrist.x - elbow.x;
            const dy = wrist.y - elbow.y;
            const confidence = ((wrist.visibility ?? 0.6) + (elbow.visibility ?? 0.6)) / 2;
            const forearmLength = Math.sqrt(dx * dx + dy * dy);
            if (forearmLength < 1e-4) return null;

            // A racket head is roughly 1.5-2 forearm lengths beyond the grip in
            // camera space. The old 0.4/0.5 multiplier put this point on the palm.
            const headDistance = Math.max(0.14, Math.min(0.55, forearmLength * 1.7));
            const unitX = dx / forearmLength;
            const unitY = dy / forearmLength;

            return {
                x: wrist.x + unitX * headDistance,
                y: wrist.y + unitY * headDistance,
                confidence,
                origin: { x: wrist.x, y: wrist.y },
            };
        };

        const leftCandidate = buildCandidate(15, 13);
        const rightCandidate = buildCandidate(16, 14);

        if (!leftCandidate && !rightCandidate) return null;
        if (!leftCandidate) return rightCandidate;
        if (!rightCandidate) return leftCandidate;

        if (Math.abs(leftCandidate.confidence - rightCandidate.confidence) < 0.06) {
            return detectedHandednessRef.current === 'right' ? rightCandidate : leftCandidate;
        }

        return leftCandidate.confidence > rightCandidate.confidence ? leftCandidate : rightCandidate;
    };

    const predictWebcam = useCallback(async () => {
        if (!isRunningRef.current) {
            return;
        }

        const video = videoRef.current;
        const landmarker = landmarkerRef.current;
        if (!painterRef.current && canvasRef.current) {
            painterRef.current = new PosePainter(canvasRef.current);
        }
        const painter = painterRef.current;

        if (video && landmarker && painter) {
            if (video.readyState >= 2) {
                const now = performance.now();
                const elapsed = now - lastProcessTimeRef.current;

                if (elapsed >= processingIntervalMs) {
                    lastProcessTimeRef.current = now;

                    try {
                        const timestamp = getMonotonicMediaPipeTimestamp(video.currentTime * 1000);
                        const results = landmarker.detectForVideo(video, timestamp);
                        frameCountRef.current++;

                        if (results.landmarks && results.landmarks.length > 0) {
                            const landmarks = results.landmarks[0];

                            const heuristicRaw = detectRacket(landmarks);
                            const heuristicRacketDetection: RacketDetection | null = heuristicRaw
                                ? {
                                    x: heuristicRaw.x,
                                    y: heuristicRaw.y,
                                    confidence: heuristicRaw.confidence,
                                    origin: heuristicRaw.origin,
                                    source: 'heuristic',
                                }
                                : null;
                            let racketDetection: RacketDetection | null = heuristicRacketDetection;
                            let ballDetection: { x: number; y: number; confidence: number; radius: number } | null = null;
                            const now = performance.now();
                            const cachedYoloRacket = lastYoloRacketRef.current;
                            const yoloCacheLifetimeMs = isMobileDevice ? 900 : 350;
                            if (cachedYoloRacket && now - cachedYoloRacket.timestamp <= yoloCacheLifetimeMs) {
                                racketDetection = cachedYoloRacket.detection;
                            }

                            const detectionCanvas = detectCanvasRef.current;
                            // Once the swing has started, track every processed frame instead
                            // of the idle-time stride — pronation/racket-face rotation happens
                            // within ~100-200ms around contact, faster than the stride's
                            // ~100-275ms sampling gap would reliably catch. Idle/pre-motion
                            // frames keep the throttle to save battery while just watching.
                            const shouldRunBallDetection = !!detectionCanvas && (
                                motionStartedRef.current
                                || (frameCountRef.current % Math.max(1, ballDetectionStride) === 0)
                            );
                            const mobileYoloStride = motionStartedRef.current ? 3 : 6;
                            const shouldRunYoloDetection = yoloObjectsReadyRef.current && (
                                !isMobileDevice || frameCountRef.current % mobileYoloStride === 0
                            );
                            const shouldRunVisionDetection = shouldRunBallDetection || shouldRunYoloDetection;

                            if (shouldRunVisionDetection && video.videoWidth > 0 && video.videoHeight > 0) {
                                let usedYolo = false;
                                if (shouldRunYoloDetection) {
                                    try {
                                        const yoloDetections = await YoloObjectsService.detectFromVideo(video);
                                        if (yoloDetections.ball) {
                                            const b = yoloDetections.ball;
                                            ballDetection = { x: b.x, y: b.y, confidence: b.confidence, radius: b.radius ?? 0.03 };
                                        }
                                        if (yoloDetections.racket && yoloDetections.racket.confidence >= 0.25) {
                                            const box = yoloDetections.racket.box;
                                            racketDetection = {
                                                x: (box.x0 + box.x1) / 2,
                                                y: (box.y0 + box.y1) / 2,
                                                confidence: yoloDetections.racket.confidence,
                                                box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
                                                source: 'yolo',
                                            };
                                            lastYoloRacketRef.current = {
                                                detection: racketDetection,
                                                timestamp: performance.now(),
                                            };
                                        }
                                        usedYolo = true;
                                    } catch (yoloErr) {
                                        console.warn('[LiveCoaching] YOLO object detection frame failed, using heuristic fallback.', yoloErr);
                                    }
                                }

                                if (!usedYolo && shouldRunBallDetection && detectionCanvas) {
                                    const detectCtx = detectionCanvas.getContext('2d', { willReadFrequently: true });
                                    if (detectCtx) {
                                        detectCtx.drawImage(video, 0, 0, detectionCanvas.width, detectionCanvas.height);
                                        const frame = detectCtx.getImageData(0, 0, detectionCanvas.width, detectionCanvas.height);
                                        ballDetection = detectBall(frame, detectionCanvas.width, detectionCanvas.height);
                                    }
                                }
                            }

                            const { handedness } = updateDetectedHandedness(landmarks, racketDetection);
                            const analysisMode = updateAnalysisMode(racketDetection, ballDetection);
                            const contactContext = buildContactContext(landmarks, racketDetection, ballDetection);

                            let detector = advancedPhaseDetectorRef.current;
                            if (!detector || typeof detector.updatePhase !== 'function') {
                                detector = isGroundstrokeSkill
                                    ? new AdvancedGroundstrokePhaseDetector()
                                    : new AdvancedServePhaseDetector({ allowUpperBodyShadowMode: true });
                                advancedPhaseDetectorRef.current = detector;
                            }

                            const phase = detector.updatePhase(
                                landmarks,
                                racketDetection || undefined,
                                ballDetection || undefined,
                                handedness
                            );
                            const coachPhase = mapStageToCoachPhase(phase);
                            const progress = typeof detector.getPhaseProgress === 'function'
                                ? detector.getPhaseProgress()
                                : 0;
                            const sequence = typeof detector.getPhaseSequence === 'function'
                                ? detector.getPhaseSequence()
                                : [];
                            const isNewMotion = !motionStartedRef.current && phase !== 'start';
                            const isMotionComplete = isGroundstrokeSkill
                                ? (typeof detector.isGroundstrokeComplete === 'function' && detector.isGroundstrokeComplete())
                                : (typeof detector.isServeComplete === 'function' && detector.isServeComplete());

                            if (isNewMotion) {
                                motionStartedRef.current = true;
                                setIsInMotion(true);
                                resetMotionFeedbackTracking();
                            }

                            if (cameraAngle === 'back' && motionStartedRef.current) {
                                updateBackViewTracking(landmarks, handedness);
                            }

                            setCurrentPhase(phase);
                            setPhaseProgress(progress);
                            setPhaseSequence(sequence);

                            if (motionStartedRef.current) {
                                const canAnalyzePose = typeof coachRef.current.analyzePhase === 'function';
                                if (canAnalyzePose) {
                                    const errors = typeof coachRef.current.analyzePhase === 'function'
                                        ? coachRef.current.analyzePhase(landmarks, coachPhase, {
                                            handedness,
                                            analysisMode,
                                            contactContext,
                                            detectionConfidence: ballDetection?.confidence ?? racketDetection?.confidence,
                                        })
                                        : [];
                                    const activeErrorTypes = new Set(errors.map((error: { type: string }) => error.type));
                                    for (const [type, evidence] of Object.entries(motionErrorEvidenceRef.current)) {
                                        if (evidence.phase === coachPhase && !activeErrorTypes.has(type)) {
                                            evidence.consecutiveFrames = Math.max(0, evidence.consecutiveFrames - 1);
                                        }
                                    }

                                    const stableErrors = errors.filter((error: { type: string }) => {
                                        const evidence = motionErrorEvidenceRef.current[error.type];
                                        const consecutiveFrames = evidence?.phase === coachPhase
                                            ? evidence.consecutiveFrames + 1
                                            : 1;
                                        motionErrorEvidenceRef.current[error.type] = { phase: coachPhase, consecutiveFrames };
                                        return consecutiveFrames >= 3;
                                    });
                                    const stablePrimaryError = typeof coachRef.current.selectPrimaryError === 'function'
                                        ? coachRef.current.selectPrimaryError(stableErrors)
                                        : (stableErrors[0] ?? null);
                                    const match = stableErrors.length === 0;
                                    const correction = stablePrimaryError?.correction;
                                    if (!isGroundstrokeSkill && typeof coachRef.current.getPhaseMetricComparisons === 'function') {
                                        phaseComparisonMetricsRef.current[coachPhase] = coachRef.current.getPhaseMetricComparisons(landmarks, coachPhase);
                                    }
                                    motionChecksRef.current++;
                                    if (match) motionReferenceMatchesRef.current++;
                                    if (stablePrimaryError && correction) {
                                        motionCorrectionsRef.current[correction] = (motionCorrectionsRef.current[correction] || 0) + 1;
                                    }
                                }

                                if (isMotionComplete && (isGroundstrokeSkill || phase === 'finish')) {
                                    completionPendingSinceRef.current = null;
                                    finalizeMotion(phase, sequence);
                                }
                            }

                            painter.drawSkeletonWithVideo(video, landmarks, false, !showReferenceOverlayRef.current);
                            painter.drawRacketTracking(racketDetection);
                        } else {
                            painter.drawVideoFrame(video);
                        }
                    } catch (err) {
                        console.warn('[LiveCoaching] Pose inference frame failed', err);
                        painter.drawVideoFrame(video);
                        if (!gpuFallbackAttemptedRef.current) {
                            gpuFallbackAttemptedRef.current = true;
                            FilesetResolver.forVisionTasks(
                                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
                            ).then((resolver) => PoseLandmarker.createFromOptions(resolver, {
                                baseOptions: { ...POSE_LANDMARKER_BASE_OPTIONS, delegate: 'CPU' },
                                runningMode: 'VIDEO',
                                numPoses: 1,
                                minPoseDetectionConfidence: 0.5,
                                minPosePresenceConfidence: 0.5,
                                minTrackingConfidence: 0.5,
                            })).then((cpuLandmarker) => {
                                landmarkerRef.current?.close?.();
                                landmarkerRef.current = cpuLandmarker;
                            }).catch((fallbackErr) => {
                                console.error('[LiveCoaching] CPU fallback landmarker creation failed', fallbackErr);
                            });
                        }
                    }
                }
            }
        }

        animationTimeoutRef.current = requestAnimationFrame(predictWebcam);
    }, [
        ballDetectionStride,
        buildContactContext,
        finalizeMotion,
        formatStageLabel,
        getMonotonicMediaPipeTimestamp,
        getHittingHandRoll,
        isGroundstrokeSkill,
        isMobileDevice,
        mapStageToCoachPhase,
        processingIntervalMs,
        resetMotionFeedbackTracking,
        updateAnalysisMode,
        updateBackViewTracking,
        cameraAngle,
        updateDetectedHandedness,
    ]);

    const handleStartCoaching = useCallback(async () => {
        if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Start Coaching tapped');
        // Wake up speech synthesis for iOS
        if ('speechSynthesis' in window) {
            const silent = new SpeechSynthesisUtterance('');
            silent.volume = 0;
            window.speechSynthesis.speak(silent);
        }

        if (!isInitialized) {
            await initializeCameraAndModel();
        }

        if (useVideoUpload) {
            setError('Switch to Live Camera mode to start live coaching.');
            return;
        }

        if (isCalibratingReference) {
            setError('Reference calibration is still running. Wait for it to finish before starting live coaching.');
            return;
        }

        if (!videoRef.current) return;

        await attachCameraStream();
        if (isMobileDevice) (window as any).__motionTutorMobileLog?.('Camera attached; starting inference loop');

        if (!isGroundstrokeSkill && showReferenceOverlay && referenceVideoRef.current) {
            referenceVideoRef.current.currentTime = 0;
            referenceVideoRef.current.play().catch(() => {
                setError('Reference playback was blocked. Tap Start Coaching again to play the pro overlay.');
            });
        }

        resetMotionPipeline();
        uploadedFeedbackRef.current = [];
        setVideoProgress('');
        setFeedback(`Coaching started. Perform a full ${isGroundstrokeSkill ? 'shot' : 'serve'}.`);

        isRunningRef.current = true;
        setIsRunning(true);
        predictWebcam();
    }, [attachCameraStream, initializeCameraAndModel, isInitialized, resetMotionPipeline, useVideoUpload, isGroundstrokeSkill, isMobileDevice, isCalibratingReference]);

    const handleStopCoaching = useCallback(() => {
        isRunningRef.current = false;
        setIsRunning(false);
        setIsInMotion(false);
        setVideoProgress('');
        lowElbowWarningStreakRef.current = 0;

        if (nextMotionResetTimeoutRef.current) {
            clearTimeout(nextMotionResetTimeoutRef.current);
            nextMotionResetTimeoutRef.current = null;
        }

        if (animationTimeoutRef.current) {
            cancelAnimationFrame(animationTimeoutRef.current);
            animationTimeoutRef.current = null;
        }

        window.speechSynthesis?.cancel();
        referenceVideoRef.current?.pause();
        setFeedback('Coaching stopped.');
    }, []);

    const handleVideoUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setError(null);
            setVideoFileName(file.name);
            resetMotionPipeline();
            uploadedFeedbackRef.current = [];
            uploadStartTimeRef.current = Date.now();

            if (!isInitialized) {
                await initializeCameraAndModel();
            }

            if (!videoRef.current) return;

            if (uploadedVideoUrlRef.current) {
                URL.revokeObjectURL(uploadedVideoUrlRef.current);
            }
            const videoUrl = URL.createObjectURL(file);
            uploadedVideoUrlRef.current = videoUrl;

            videoRef.current.srcObject = null;
            videoRef.current.src = videoUrl;
            videoRef.current.muted = false;
            videoRef.current.preload = 'auto';

            await new Promise<void>((resolve, reject) => {
                const onLoaded = () => {
                    videoRef.current?.removeEventListener('loadedmetadata', onLoaded);
                    videoRef.current?.removeEventListener('error', onError);
                    resolve();
                };
                const onError = () => {
                    videoRef.current?.removeEventListener('loadedmetadata', onLoaded);
                    videoRef.current?.removeEventListener('error', onError);
                    reject(new Error('Failed to load uploaded video'));
                };

                videoRef.current?.addEventListener('loadedmetadata', onLoaded);
                videoRef.current?.addEventListener('error', onError);
            });

            await videoRef.current.play();
            setFeedback(`Video analysis started. Waiting for a full ${isGroundstrokeSkill ? 'shot' : 'serve'} sequence.`);
            setVideoProgress('0%');

            isRunningRef.current = true;
            setIsRunning(true);
            predictWebcam();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(`Failed to analyze video: ${message}`);
        }
    }, [initializeCameraAndModel, isInitialized, predictWebcam, resetMotionPipeline, isGroundstrokeSkill]);

    const handleReferenceUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        calibrateReferenceVideo(file);
    }, [calibrateReferenceVideo]);

    const handleClearReference = useCallback(() => {
        coachRef.current.clearReferenceTargets();
        referenceVideoService.clearLiveTennisServeReference();
        if (uploadedReferenceUrlRef.current) {
            URL.revokeObjectURL(uploadedReferenceUrlRef.current);
            uploadedReferenceUrlRef.current = null;
        }
        referenceVideoRef.current?.pause();
        setServeReferenceUrl(null);
        setReferenceStatus('No pro reference loaded');
        setFeedback('Reference removed. Choose a new serve video to calibrate coaching against it.');
    }, []);

    const downloadFeedback = useCallback(() => {
        if (uploadedFeedbackRef.current.length === 0) return;

        const feedbackText = uploadedFeedbackRef.current.join('\n\n---\n\n');
        const blob = new Blob([feedbackText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `serve-feedback-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    useEffect(() => {
        if (initAttemptedRef.current) return;
        initAttemptedRef.current = true;
        initializeCameraAndModel();
    }, [initializeCameraAndModel]);

    useEffect(() => {
        const syncCanvas = () => {
            if (!videoRef.current || !canvasRef.current) return;
            const w = videoRef.current.videoWidth || 640;
            const h = videoRef.current.videoHeight || 480;
            const scale = Math.min(1, 640 / Math.max(w, 1));

            const newW = Math.max(1, Math.round(w * scale));
            const newH = Math.max(1, Math.round(h * scale));

            canvasRef.current.width = newW;
            canvasRef.current.height = newH;

            // Set up small detection canvas
            if (!detectCanvasRef.current) {
                detectCanvasRef.current = document.createElement('canvas');
            }
            detectCanvasRef.current.width = Math.max(1, detectionCanvasWidth);
            detectCanvasRef.current.height = Math.max(1, detectionCanvasHeight);
        };

        videoRef.current?.addEventListener('loadedmetadata', syncCanvas);
        return () => videoRef.current?.removeEventListener('loadedmetadata', syncCanvas);
    }, [detectionCanvasWidth, detectionCanvasHeight]);

    useEffect(() => {
        return () => {
            isRunningRef.current = false;
            if (animationTimeoutRef.current) {
                cancelAnimationFrame(animationTimeoutRef.current);
                animationTimeoutRef.current = null;
            }
            if (nextMotionResetTimeoutRef.current) {
                clearTimeout(nextMotionResetTimeoutRef.current);
            }
            if (uploadedVideoUrlRef.current) {
                URL.revokeObjectURL(uploadedVideoUrlRef.current);
            }
            if (uploadedReferenceUrlRef.current) {
                URL.revokeObjectURL(uploadedReferenceUrlRef.current);
            }
            window.speechSynthesis?.cancel();
            if (cameraStreamRef.current) {
                cameraStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            landmarkerRef.current?.close?.();
        };
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
            <div className="sticky top-0 z-10 flex items-center justify-between p-3 sm:p-4 border-b border-slate-700 bg-slate-900/95 backdrop-blur">
                <div>
                    <h1 className="text-lg sm:text-2xl font-bold text-white">Live Coaching: Tennis</h1>
                    <p className="text-xs sm:text-sm text-slate-400">Phone-based serve movement tracking from side or back view</p>

                    <div className="flex space-x-2 bg-slate-800 p-1 mt-2 rounded-lg inline-flex">
                        <button
                            onClick={() => { setSkill('serve'); setIsRunning(false); }}
                            className={`px-3 py-1 rounded-md ${skill === 'serve' ? 'bg-blue-600' : 'hover:bg-slate-700'} text-white text-xs sm:text-sm font-medium`}
                        >
                            Serve
                        </button>
                        <button
                            onClick={() => { setSkill('forehand'); setIsRunning(false); }}
                            className={`px-3 py-1 rounded-md ${skill === 'forehand' ? 'bg-blue-600' : 'hover:bg-slate-700'} text-white text-xs sm:text-sm font-medium`}
                        >
                            Forehand
                        </button>
                        <button
                            onClick={() => { setSkill('backhand'); setIsRunning(false); }}
                            className={`px-3 py-1 rounded-md ${skill === 'backhand' ? 'bg-blue-600' : 'hover:bg-slate-700'} text-white text-xs sm:text-sm font-medium`}
                        >
                            Backhand
                        </button>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="min-h-[44px] px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition"
                >
                    Close
                </button>
            </div>

            {error && (
                <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 m-4 rounded">
                    <p className="font-bold">Error</p>
                    <p className="text-sm">{error}</p>
                </div>
            )}

            <div className="flex-1 flex flex-col xl:flex-row gap-3 sm:gap-4 p-3 sm:p-4 overflow-y-auto">
                <div className="flex-1 flex flex-col gap-4">
                    <div className="relative bg-black rounded-xl overflow-hidden flex-shrink-0 border border-slate-700" style={{ minHeight: isMobileDevice ? '42svh' : '300px' }}>
                        {serveReferenceUrl && (
                            <video
                                ref={referenceVideoRef}
                                src={serveReferenceUrl}
                                className={`absolute inset-0 h-full w-full object-contain ${showReferenceOverlay && !isGroundstrokeSkill ? '' : 'hidden'}`}
                                muted
                                playsInline
                                loop
                                crossOrigin="anonymous"
                            />
                        )}
                        <video
                            ref={videoRef}
                            width={640}
                            height={480}
                            className={`absolute inset-0 h-full w-full object-contain ${showReferenceOverlay && isRunning && !isGroundstrokeSkill ? 'opacity-30' : ''}`}
                            autoPlay
                            playsInline
                            crossOrigin="anonymous"
                            controls
                        />
                        <canvas
                            ref={canvasRef}
                            width={640}
                            height={480}
                            className={`w-full h-full object-contain absolute inset-0 ${isRunning ? '' : 'hidden'}`}
                        />
                        {!isInitialized && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                <p className="text-white text-lg">Initializing...</p>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            onClick={handleStartCoaching}
                            disabled={!isInitialized || isRunning}
                            className="min-h-[52px] px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition font-semibold text-base"
                        >
                            {isRunning ? 'Coaching Active' : 'Start Coaching'}
                        </button>
                        <button
                            onClick={handleStopCoaching}
                            disabled={!isRunning}
                            className="min-h-[52px] px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition font-semibold text-base"
                        >
                            Stop
                        </button>
                    </div>

                    {!isGroundstrokeSkill && (
                        <button
                            onClick={() => setShowReferenceOverlay((current) => !current)}
                            className={`min-h-[44px] rounded border px-4 py-2 text-sm font-medium transition ${showReferenceOverlay
                                ? 'border-cyan-400 bg-cyan-900/50 text-cyan-100 hover:bg-cyan-900'
                                : 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
                        >
                            Pro Overlay: {showReferenceOverlay ? 'On' : 'Off'}
                        </button>
                    )}

                    {!isGroundstrokeSkill && (
                        <section className="rounded-lg border border-cyan-700/60 bg-cyan-950/30 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h2 className="text-sm font-semibold text-cyan-100">Local Serve Reference</h2>
                                    <p className="text-xs text-cyan-200">{referenceStatus}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <label className={`inline-flex min-h-[40px] cursor-pointer items-center justify-center rounded border border-cyan-500 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-900 ${isCalibratingReference || isRunning ? 'cursor-not-allowed opacity-50' : ''}`}>
                                        {isCalibratingReference ? 'Calibrating...' : 'Choose Serve Video'}
                                        <input
                                            type="file"
                                            accept="video/*"
                                            onChange={handleReferenceUpload}
                                            disabled={isCalibratingReference || isRunning}
                                            className="sr-only"
                                        />
                                    </label>
                                    <button
                                        onClick={handleClearReference}
                                        disabled={isCalibratingReference}
                                        className="min-h-[40px] rounded border border-slate-600 px-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Clear Reference
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}

                    {!isGroundstrokeSkill && (
                        <section className="rounded-lg border border-cyan-700/60 bg-cyan-950/30 p-3">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-sm font-semibold text-cyan-100">Five-Rep Shadow Set vs Pro</h2>
                                    <p className="text-xs text-cyan-200">Phase-normalized MediaPipe comparison against the pro reference.</p>
                                </div>
                                <button
                                    onClick={() => setShadowSetComparisons([])}
                                    disabled={shadowSetComparisons.length === 0}
                                    className="min-h-[36px] rounded border border-cyan-600 px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Reset {shadowSetComparisons.length}/5
                                </button>
                            </div>
                            {shadowSetComparisons.length === 0 ? (
                                <p className="text-xs text-cyan-200">Complete five shadow serves. Each detected serve adds one comparison row.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[900px] text-left text-xs">
                                        <thead className="border-b border-cyan-800 text-cyan-300">
                                            <tr>
                                                <th className="px-2 py-2 font-medium">Rep</th>
                                                <th className="px-2 py-2 font-medium">Overall</th>
                                                <th className="px-2 py-2 font-medium">Your Movement Compared With Pro</th>
                                                <th className="px-2 py-2 font-medium">Next Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-cyan-50">
                                            {shadowSetComparisons.map((comparison, repIndex) => {
                                                const details = comparison.metrics.map((metric) => ({
                                                    stage: metric.stage.replace('_', ' '),
                                                    metric: metric.metric,
                                                    ...describeProMetric(metric),
                                                }));
                                                const priority = details.find((detail) => !detail.cue.startsWith('Matches')) ?? details[0];
                                                const overall = comparison.matchScore >= 80
                                                    ? { label: 'Close to pro', color: 'text-emerald-300' }
                                                    : comparison.matchScore >= 60
                                                        ? { label: 'Developing', color: 'text-amber-300' }
                                                        : { label: 'Needs one clear fix', color: 'text-rose-300' };

                                                return (
                                                    <tr key={repIndex} className="border-b border-cyan-900/70 align-top last:border-0">
                                                        <td className="px-2 py-3 font-semibold">{repIndex + 1}</td>
                                                        <td className={`px-2 py-3 font-semibold ${overall.color}`}>{overall.label}</td>
                                                        <td className="px-2 py-3">
                                                            <div className="space-y-2">
                                                                {details.map((detail) => (
                                                                    <div key={`${detail.stage}-${detail.metric}`}>
                                                                        <span className="font-medium capitalize text-cyan-200">{detail.stage}, {detail.metric}:</span>{' '}
                                                                        <span>You: {detail.user}. Pro: {detail.pro}.</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-3 font-medium text-amber-200">{priority?.cue ?? 'Keep matching the pro rhythm.'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300">
                            Camera: <span className="text-white font-medium">{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
                        </div>
                        <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300">
                            Device: <span className="text-white font-medium">{isMobileDevice ? 'Mobile/Tablet' : 'Desktop'}</span>
                        </div>
                        <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300">
                            View: <span className="text-white font-medium">{cameraAngle === 'back' ? 'Back' : 'Side'}</span>
                        </div>
                        <button
                            onClick={() => setPerformanceMode((prev) => prev === 'balanced' ? 'battery' : 'balanced')}
                            className="min-h-[44px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white hover:bg-slate-700 transition"
                        >
                            Mode: {performanceMode === 'battery' ? 'Battery Saver' : 'Balanced'}
                        </button>
                        <button
                            onClick={() => setSpeechMode((prev) => prev === 'en' ? 'zh-cantonese-first' : 'en')}
                            className="min-h-[44px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white hover:bg-slate-700 transition"
                        >
                            Audio: {speechMode === 'zh-cantonese-first' ? 'Cantonese (Mandarin Fallback)' : 'English'}
                        </button>
                    </div>

                    {isMobileDevice && isRearCameraMode && (
                        <div className="rounded-lg border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200">
                            Rear camera optimization is active: lower capture resolution, adaptive FPS, and lighter object detection for smoother coaching.
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-700 bg-slate-800 p-1">
                            <button
                                onClick={() => setCameraAngle('side')}
                                disabled={isRunning}
                                className={`min-h-[44px] rounded px-3 py-2 text-sm font-medium transition ${cameraAngle === 'side' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-700'} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                                Side View
                            </button>
                            <button
                                onClick={() => setCameraAngle('back')}
                                disabled={isRunning}
                                className={`min-h-[44px] rounded px-3 py-2 text-sm font-medium transition ${cameraAngle === 'back' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-700'} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                                Back View
                            </button>
                        </div>
                        <p className="text-xs text-slate-400">
                            {cameraAngle === 'back'
                                ? 'Back view tracks shoulder-line visibility, serving-arm coverage, and whether the wrist rises above the shoulders.'
                                : 'Side view tracks the upward arm path, contact reach, and follow-through descent.'}
                        </p>
                        <div className="flex justify-end">
                            <button
                                onClick={toggleCamera}
                                className="w-full sm:w-auto min-h-[44px] px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition flex items-center justify-center gap-2 text-sm"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                Switch Camera ({facingMode === 'user' ? 'Front' : 'Back'})
                            </button>
                        </div>
                    </div>
                </div>

                <div className="w-full xl:w-96 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3 sm:gap-4">
                    {cameraAngle === 'back' && backViewResult && (
                        <div className="rounded-lg border border-cyan-700/60 bg-cyan-900/20 p-4 text-sm text-cyan-100">
                            <h2 className="mb-2 text-sm font-semibold uppercase text-cyan-300">Back View Tracking</h2>
                            <div className="space-y-1 text-xs">
                                <p>{backViewResult.shoulderLineTracked ? 'Shoulder line tracked through the serve.' : 'Shoulder line was not visible long enough to track.'}</p>
                                <p>{backViewResult.armPathTracked ? 'Serving arm path tracked from shoulder to wrist.' : 'Serving arm was not visible long enough to track.'}</p>
                                <p>{backViewResult.wristReachedOverhead ? 'Wrist rose above the shoulder line.' : 'No clear above-shoulder wrist position was observed.'}</p>
                            </div>
                        </div>
                    )}

                    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                        <h2 className="text-lg font-semibold text-white mb-2">Feedback</h2>
                        <div
                            className={`text-center py-6 rounded ${isInMotion
                                ? 'bg-blue-900 text-blue-100'
                                : 'bg-slate-700 text-slate-200'
                                }`}
                        >
                            {isInMotion ? `In ${isGroundstrokeSkill ? 'Shot' : 'Serve'} Sequence...` : feedback || (isRunning ? 'Analyzing...' : 'Ready')}
                        </div>
                    </div>

                    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-white mb-3 uppercase">Estimated Movement Stage</h3>
                        <div className="space-y-3">
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-slate-400 text-sm">{formatStageLabel(currentPhase)}</span>
                                    <span className="text-emerald-400 text-xs font-mono">{Math.round(phaseProgress * 100)}%</span>
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-2">
                                    <div
                                        className="bg-emerald-500 h-2 rounded-full transition-all"
                                        style={{ width: `${phaseProgress * 100}%` }}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400">{isGroundstrokeSkill ? 'Shots' : 'Serves'}</span>
                                <span className="text-white font-semibold">{motionCount}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400">Analysis Mode</span>
                                <span className={analysisMode === 'equipment' ? 'text-cyan-300' : 'text-amber-300'}>
                                    {analysisMode === 'equipment' ? 'Equipment + Contact Point' : 'Shadow Exercise'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400">Detected Hand</span>
                                <span className="text-white">{detectedHandedness === 'right' ? 'Right' : 'Left'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-white mb-2 uppercase">Estimated Motion Sequence</h3>
                        <div className="flex flex-wrap gap-2">
                            {phaseSequence.length === 0 && (
                                <span className="text-xs text-slate-400">Waiting for a real motion sequence...</span>
                            )}
                            {phaseSequence.map((phase, idx) => (
                                <div key={`${phase}-${idx}`} className="bg-slate-700 px-2 py-1 rounded text-xs text-slate-200 border border-slate-600">
                                    {phase}
                                </div>
                            ))}
                        </div>
                    </div>

                    {detectedErrors.length > 0 && (
                        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-red-300 mb-2">Issues Detected</h3>
                            <ul className="text-xs text-red-200 space-y-1">
                                {detectedErrors.slice(0, 3).map((err, idx) => (
                                    <li key={idx}>{err.description}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-blue-300 mb-2">Phase Guarding</h3>
                        <div className="text-xs text-blue-200 space-y-2">
                            <p>The detector is armed only after real onset signals.</p>
                            <p>Walking, idle movement, or random ball bouncing stays in the start state.</p>
                            <p>With detected racket + ball, contact-point diagnostics activate automatically.</p>
                        </div>
                    </div>

                    {isMobileDevice && (
                        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 md:col-span-2 xl:col-span-1">
                            <h3 className="text-sm font-semibold text-amber-300 mb-2">Mobile Smoothness Tips</h3>
                            <div className="text-xs text-amber-100 space-y-2">
                                <p>Place phone on a tripod at waist-to-chest height and keep full body in frame.</p>
                                <p>Use bright, even lighting and avoid complex moving backgrounds.</p>
                                <p>If heat builds up, switch Mode to Battery Saver for steadier frame delivery.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="border-t border-slate-700 px-4 py-2 bg-slate-800/50 text-xs text-slate-400">
                Camera Movement Tracking • Side and Back View • Live + Upload
            </div>
        </div>
    );
};
