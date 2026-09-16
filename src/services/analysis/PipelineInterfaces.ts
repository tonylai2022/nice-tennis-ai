import type {
    BallObservation,
    FrameFeatures,
    PoseLandmarks3D,
    RacketAxis,
    StrokeEvents,
    StrokeType,
} from './PipelineTypes';

export type ModelContext = {
    // Optional place for model handles/session objects.
    // (e.g., MediaPipe landmarker, ONNX sessions, WebGPU contexts)
    [key: string]: unknown;
};

export interface PoseDetector {
    readonly id: string;
    initialize?(ctx: ModelContext): Promise<void>;
    detectPose(frame: ImageData | HTMLVideoElement | HTMLCanvasElement, timestampSec: number): Promise<{
        poseLandmarks: PoseLandmarks3D;
        worldLandmarks?: PoseLandmarks3D;
        confidence?: number;
    } | null>;
}

export interface RacketDetector {
    readonly id: string;
    initialize?(ctx: ModelContext): Promise<void>;
    detectRacketAxis(frame: ImageData | HTMLVideoElement | HTMLCanvasElement, timestampSec: number): Promise<RacketAxis | null>;
}

export interface BallTracker {
    readonly id: string;
    initialize?(ctx: ModelContext): Promise<void>;
    detectBall(frame: ImageData | HTMLVideoElement | HTMLCanvasElement, timestampSec: number): Promise<BallObservation | null>;
}

export interface TemporalLocalizer {
    readonly id: string;
    initialize?(ctx: ModelContext): Promise<void>;
    localizeEvents(frames: FrameFeatures[], strokeType: StrokeType): Promise<StrokeEvents>;
}

export interface BiomechanicsEngine {
    readonly id: string;
    initialize?(ctx: ModelContext): Promise<void>;
    compute(frames: FrameFeatures[], events: StrokeEvents): Promise<Record<string, unknown>>;
}
