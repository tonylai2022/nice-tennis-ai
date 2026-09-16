import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export type PoseLandmark = { x: number; y: number; z?: number; visibility?: number };

class MediaPipeVideoPoseService {
    private landmarker: PoseLandmarker | null = null;
    private initPromise: Promise<PoseLandmarker | null> | null = null;
    private imageLandmarker: PoseLandmarker | null = null;
    private imageInitPromise: Promise<PoseLandmarker | null> | null = null;
    private lastTimestamp = 0;

    async init(): Promise<PoseLandmarker | null> {
        if (this.landmarker) return this.landmarker;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                const fileset = await FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
                );

                const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

                try {
                    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
                        baseOptions: { modelAssetPath, delegate: 'GPU' },
                        runningMode: 'VIDEO',
                        numPoses: 4,
                        minPoseDetectionConfidence: 0.35,
                        minPosePresenceConfidence: 0.35,
                        minTrackingConfidence: 0.35,
                    });
                } catch {
                    // Fall back to CPU if GPU delegate is unavailable
                    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
                        baseOptions: { modelAssetPath, delegate: 'CPU' },
                        runningMode: 'VIDEO',
                        numPoses: 4,
                        minPoseDetectionConfidence: 0.35,
                        minPosePresenceConfidence: 0.35,
                        minTrackingConfidence: 0.35,
                    });
                }

                return this.landmarker;
            } catch (err) {
                console.warn('[MediaPipeVideoPoseService] Failed to initialize PoseLandmarker:', err);
                return null;
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    isReady(): boolean {
        return this.landmarker !== null;
    }

    detect(video: HTMLVideoElement): PoseLandmark[] | null {
        if (!this.landmarker || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
            return null;
        }

        try {
            const now = Math.round(performance.now());
            this.lastTimestamp = Math.max(now, this.lastTimestamp + 1);
            const result = this.landmarker.detectForVideo(video, this.lastTimestamp);
            return selectPrimaryPose(result.landmarks as PoseLandmark[][]);
        } catch {
            return null;
        }
    }

    async detectImage(video: HTMLVideoElement): Promise<PoseLandmark[] | null> {
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
        if (!this.imageLandmarker) {
            if (!this.imageInitPromise) {
                this.imageInitPromise = (async () => {
                    try {
                        const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm');
                        this.imageLandmarker = await PoseLandmarker.createFromOptions(fileset, {
                            baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
                            runningMode: 'IMAGE',
                            numPoses: 4,
                            minPoseDetectionConfidence: 0.35,
                            minPosePresenceConfidence: 0.35,
                        });
                        return this.imageLandmarker;
                    } catch (error) {
                        console.warn('[MediaPipeVideoPoseService] Failed to initialize image detector:', error);
                        return null;
                    } finally {
                        this.imageInitPromise = null;
                    }
                })();
            }
            await this.imageInitPromise;
        }
        if (!this.imageLandmarker) return null;
        try {
            return selectPrimaryPose(this.imageLandmarker.detect(video).landmarks as PoseLandmark[][]);
        } catch {
            return null;
        }
    }
}

function selectPrimaryPose(poses: PoseLandmark[][]): PoseLandmark[] | null {
    if (!poses.length) return null;
    return poses.reduce<{ pose: PoseLandmark[]; score: number } | null>((best, pose) => {
        const bodyPoints = pose.slice(11, 33).filter((point) => (point.visibility ?? 1) >= 0.35);
        if (bodyPoints.length < 8) return best;
        const xs = bodyPoints.map((point) => point.x);
        const ys = bodyPoints.map((point) => point.y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        const visibleRatio = bodyPoints.reduce((total, point) => total + (point.visibility ?? 1), 0) / bodyPoints.length;
        const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
        const centerWeight = 1 - Math.min(0.35, Math.abs(centerX - 0.5) * 0.35);
        const score = width * height * visibleRatio * centerWeight;
        return !best || score > best.score ? { pose, score } : best;
    }, null)?.pose ?? null;
}

export const mediaPipeVideoPoseService = new MediaPipeVideoPoseService();
