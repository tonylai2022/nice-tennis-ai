export interface WatchMotionSample {
    timestamp: number;
    accelX: number;
    accelY: number;
    accelZ: number;
    gyroX: number;
    gyroY: number;
    gyroZ: number;
    roll: number;
    pitch: number;
    yaw: number;
}

export interface SwingMotionFeatures {
    peakAngularVelocity: number;
    peakAcceleration: number;
    forwardSwingDurationMs: number;
    backswingDurationMs: number;
    impactStability: number;
    impactWristRoll: number;
    motionScore: number;
}

export interface SwingSession {
    sessionId: string;
    startedAt: number;
    videoFileName: string;
    motionSamples: WatchMotionSample[];
    swingFeatures?: SwingMotionFeatures;
}

export interface NativeBridgePayload {
    type: 'session_started' | 'sample_batch' | 'session_complete' | 'session_error';
    session?: SwingSession;
    samples?: WatchMotionSample[];
    error?: string;
}
