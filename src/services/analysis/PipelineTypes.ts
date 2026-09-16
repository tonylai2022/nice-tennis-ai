export type StrokeEventType = 'unit_turn' | 'racket_drop' | 'contact' | 'follow_through';

export type StrokeType = 'forehand' | 'backhand' | 'serve';

export type NormalizedPoint2D = {
    x: number; // 0..1 image space
    y: number; // 0..1 image space
};

export type PoseLandmarks3D = Array<{ x: number; y: number; z?: number; visibility?: number }>;

export type RacketAxis = {
    // Normalized image-space segment approximating racket axis.
    // (x0,y0) is near the hand/handle; (x1,y1) is toward the tip.
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    confidence: number; // 0..1
};

export type BallObservation = {
    x: number; // 0..1
    y: number; // 0..1
    confidence: number; // 0..1
    radius?: number; // 0..1 approx
};

export type FrameFeatures = {
    timestampSec: number;
    poseLandmarks: PoseLandmarks3D;
    worldLandmarks?: PoseLandmarks3D;
    racket?: RacketAxis;
    ball?: BallObservation;
};

export type StrokeEvent = {
    type: StrokeEventType;
    frameIndex: number;
    timestampSec: number;
    confidence: number; // 0..1
};

export type StrokeEvents = {
    strokeType: StrokeType;
    events: StrokeEvent[];
};

export type ForehandMetrics = {
    // Mirrors the biomechanical prompt terms, in normalized units unless otherwise noted.
    verticalLift?: number; // racket-tip y(drop) - y(contact)
    extensionX?: number; // |left_shoulder.x - contact_point.x|
    lagAngleDegAtDrop?: number; // angle between forearm and racket axis

    // Sequencing (seconds)
    hipRotationPeakTimeSec?: number;
    shoulderRotationPeakTimeSec?: number;
    maxLagTimeSec?: number;
    contactTimeSec?: number;

    hipToShoulderLagSec?: number;
    shoulderToLagLagSec?: number;
    lagToContactLagSec?: number;
};
