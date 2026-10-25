/**
 * Advanced Tennis Serve Phase Detector with Hybrid Vision (Pose + YOLO + Ball Tracking)
 * Uses biomechanical signals + racket motion + ball detection for accurate phase detection
 * Based on TennisMotionAnalysis.ts hybrid approach
 */

interface Landmark {
    x: number;
    y: number;
    z: number;
    visibility?: number;
}

interface RacketDetection {
    x: number;
    y: number;
    confidence: number;
}

interface BallDetection {
    x: number;
    y: number;
    confidence: number;
    radius?: number;
}

export class AdvancedServePhaseDetector {
    private poseHistory: Landmark[][] = [];
    private racketHistory: RacketDetection[] = [];
    private ballHistory: BallDetection[] = [];
    private velocityHistory: number[] = [];
    private racketVelocityHistory: number[] = [];
    private currentPhase = 'start';
    private phaseStartFrame = 0;
    private phaseSequence: string[] = [];
    private frameInPhase = 0;
    private totalFramesProcessed = 0;
    private serveComplete = false; // Track if serve is complete
    private serveStartFrame = -1; // Track when serve starts (at release)
    private serveArmed = false; // True only after sustained real-serve onset cues
    private onsetEvidenceFrames = 0;
    private transitionCandidatePhase: string | null = null;
    private transitionCandidateFrames = 0;
    private tossEvidenceFrames = 0;
    private hasTossEvidence = false;
    private hasAccelerationEvidence = false;
    private hasContactEvidence = false;
    private maxRightWristHeight = 0;
    private minRightWristHeight = 0;
    private minKneeBendSeen = 1;
    private maxKneeBendSeen = 0;
    private handedness: 'right' | 'left' = 'right';

    private readonly MAX_HISTORY = 120;
    private readonly MIN_PHASE_DURATION = 4;
    private readonly MIN_TRANSITION_CONFIRMATION_FRAMES = 1;
    private readonly BEGINNER_FINISH_SETTLE_FRAMES = 8;
    private readonly PHASE_ORDER = ['start', 'release', 'loading', 'cocking', 'acceleration', 'contact', 'deceleration', 'finish'];

    private readonly PHASE_FRAME_DURATIONS: Record<string, number> = {
        start: 10,
        release: 8,
        loading: 8,
        cocking: 8,
        acceleration: 6,
        contact: 2,
        deceleration: 8,
        finish: 8
    };
    private readonly beginnerPronationMode: boolean;
    private readonly allowUpperBodyShadowMode: boolean;

    constructor(options?: { beginnerPronationMode?: boolean; allowUpperBodyShadowMode?: boolean }) {
        this.beginnerPronationMode = options?.beginnerPronationMode ?? false;
        this.allowUpperBodyShadowMode = options?.allowUpperBodyShadowMode ?? false;
    }

    private readonly LANDMARK_INDICES = {
        RIGHT_SHOULDER: 12,
        RIGHT_ELBOW: 14,
        RIGHT_WRIST: 16,
        LEFT_SHOULDER: 11,
        LEFT_ELBOW: 13,
        LEFT_WRIST: 15,
        RIGHT_HIP: 24,
        LEFT_HIP: 23,
        RIGHT_KNEE: 26,
        LEFT_KNEE: 25,
    };

    /**
     * Update phase with pose landmarks + optional racket and ball detection
     */
    updatePhase(
        landmarks: Landmark[],
        racket?: RacketDetection,
        ball?: BallDetection,
        handedness?: 'right' | 'left'
    ): string {
        if (handedness) {
            this.handedness = handedness;
        }
        this.poseHistory.push(landmarks);
        if (this.poseHistory.length > this.MAX_HISTORY) {
            this.poseHistory.shift();
        }

        if (racket) {
            this.racketHistory.push(racket);
            if (this.racketHistory.length > this.MAX_HISTORY) {
                this.racketHistory.shift();
            }
        }

        if (ball) {
            this.ballHistory.push(ball);
            if (this.ballHistory.length > this.MAX_HISTORY) {
                this.ballHistory.shift();
            }
        }

        // Calculate velocities
        const wristVelocity = this.calculateRightWristVelocity();
        this.velocityHistory.push(wristVelocity);
        if (this.velocityHistory.length > 30) {
            this.velocityHistory.shift();
        }

        const racketVelocity = this.calculateRacketVelocity();
        this.racketVelocityHistory.push(racketVelocity);
        if (this.racketVelocityHistory.length > 30) {
            this.racketVelocityHistory.shift();
        }

        // Increment frame counters
        this.frameInPhase++;
        this.totalFramesProcessed++;
        const rightWristHeightNow = this.getRightWristHeight();
        const kneeBendNow = this.calculateKneeBend();
        this.maxRightWristHeight = Math.max(this.maxRightWristHeight, rightWristHeightNow);
        this.minRightWristHeight = Math.min(this.minRightWristHeight, rightWristHeightNow);
        this.minKneeBendSeen = Math.min(this.minKneeBendSeen, kneeBendNow);
        this.maxKneeBendSeen = Math.max(this.maxKneeBendSeen, kneeBendNow);

        // Track authenticity signals to separate real serves from random movement.
        const leftWristHeightNow = this.getLeftWristHeight();
        const ballTossSignalNow = !!ball && ball.confidence > 0.25 && this.detectBallToss();
        const splitArmTossSignalNow = this.isSplitArmTossPose(leftWristHeightNow, rightWristHeightNow);
        const tossSignalNow = ballTossSignalNow || splitArmTossSignalNow;

        this.tossEvidenceFrames = tossSignalNow
            ? Math.min(8, this.tossEvidenceFrames + 1)
            : Math.max(0, this.tossEvidenceFrames - 1);

        if (this.tossEvidenceFrames >= 2) {
            this.hasTossEvidence = true;
        }

        const avgVelocityNow = this.velocityHistory.length > 0
            ? this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length
            : 0;
        const accelNow = this.velocityHistory.length >= 2
            ? this.velocityHistory[this.velocityHistory.length - 1] - this.velocityHistory[this.velocityHistory.length - 2]
            : 0;
        if ((wristVelocity > Math.max(0.02, avgVelocityNow * 1.22)) && accelNow > 0.002) {
            this.hasAccelerationEvidence = true;
        }
        if (this.detectContact()) {
            this.hasContactEvidence = true;
        }

        // Beginner mode must not speak at the instant the phase detector first
        // sees a finish shape. Keep watching through a sustained finish window
        // so feedback arrives after the player has completed the follow-through.
        const hasCompletedShadowFollowThrough = ['release', 'acceleration', 'contact', 'deceleration']
            .every((phase) => this.phaseSequence.includes(phase));
        const isCompletedBeginnerFollowThrough = this.beginnerPronationMode
            && this.isBeginnerPronationAttempt()
            && this.hasBeginnerFollowThroughCompleted();
        if (
            !this.serveComplete
            && this.currentPhase === 'finish'
            && this.frameInPhase >= this.BEGINNER_FINISH_SETTLE_FRAMES
            && (isCompletedBeginnerFollowThrough || (
                this.allowUpperBodyShadowMode && hasCompletedShadowFollowThrough
            ))
        ) {
            this.serveComplete = true;
            const serveFrames = this.getServeFrameCount();
            console.log(`✅ [Serve] COMPLETE after follow-through - Sequence: ${this.phaseSequence.join(' → ')} (${serveFrames} frames)`);
        }

        // Human-like onset gating: ignore pre-serve bounces/fidgets until a real toss+motion pattern appears.
        if (!this.serveArmed) {
            const setupVisible = this.isServeSetupVisible();
            const hasOnsetSignals = this.detectServeOnsetSignals();
            this.onsetEvidenceFrames = hasOnsetSignals
                ? Math.min(10, this.onsetEvidenceFrames + 1)
                : Math.max(0, this.onsetEvidenceFrames - 1);

            const neededOnsetFrames = this.beginnerPronationMode || this.allowUpperBodyShadowMode
                ? 2
                : (setupVisible ? 3 : 5);

            if (this.onsetEvidenceFrames < neededOnsetFrames) {
                this.currentPhase = 'start';
                // Reflect arming confidence while waiting, instead of pinning UI progress to 0%.
                this.frameInPhase = this.onsetEvidenceFrames;
                return this.currentPhase;
            }

            this.serveArmed = true;
            this.frameInPhase = 0;
            this.phaseStartFrame = this.totalFramesProcessed;
            // Set serveStartFrame at arming time so getServeFrameCount() is always > 0
            if (this.serveStartFrame === -1) {
                this.serveStartFrame = this.totalFramesProcessed;
            }
        }

        // Track serve start (at release, refine if possible)
        if (this.currentPhase === 'release' && this.serveStartFrame === -1 && this.frameInPhase <= 2) {
            this.serveStartFrame = this.totalFramesProcessed;
        }

        // Detect phase using enforced state machine
        const newPhase = this.detectPhaseWithStateEnforcement();

        // Frame-based transition (not time-based)
        const transitionFrameGate = this.beginnerPronationMode ? 2 : this.MIN_PHASE_DURATION;
        if (newPhase !== this.currentPhase && this.frameInPhase >= transitionFrameGate) {
            if (this.phaseSequence.length === 0 || newPhase !== this.phaseSequence[this.phaseSequence.length - 1]) {
                this.phaseSequence.push(newPhase);
                console.log(`[Phase] Transition: ${this.currentPhase} → ${newPhase} (frame ${this.frameInPhase})`);

                // Mark serve as complete when transitioning FROM finish BACK TO start.
                if (this.currentPhase === 'finish' && newPhase === 'start' && !this.serveComplete) {
                    if (this.beginnerPronationMode && (!this.isBeginnerPronationAttempt() || !this.hasBeginnerFollowThroughCompleted())) {
                        console.log('[Beginner Serve] Discarded movement without a completed follow-through');
                        this.reset();
                        return this.currentPhase;
                    }
                    this.serveComplete = true;
                    const serveFrames = this.totalFramesProcessed - this.serveStartFrame;
                    console.log(`✅ [Serve] COMPLETE - Sequence: ${this.phaseSequence.join(' → ')} (${serveFrames} frames)`);
                }
            }
            this.currentPhase = newPhase;
            this.phaseStartFrame = this.totalFramesProcessed;
            this.frameInPhase = 0;
        }

        return this.currentPhase;
    }

    /**
     * Beginner mode is forgiving about toss, knee bend, and follow-through, but
     * it must still see an actual serving-arm swing before speaking feedback.
     * This prevents ordinary setup movement, racket adjustment, or gestures
     * from being mistaken for a pancake/snap attempt.
     */
    private isBeginnerPronationAttempt(): boolean {
        const hasSwingPhases = ['acceleration', 'contact', 'deceleration']
            .every((phase) => this.phaseSequence.includes(phase));
        const hasUpwardStrikePath = this.maxRightWristHeight >= 0.12
            && (this.maxRightWristHeight - this.minRightWristHeight) >= 0.25;
        const hasEnoughFrames = this.getServeFrameCount() >= 8;

        return hasSwingPhases
            && this.hasAccelerationEvidence
            && hasUpwardStrikePath
            && hasEnoughFrames;
    }

    /**
     * A pause at trophy position can look like reduced acceleration, but it is
     * not a completed serve. Require the hitting wrist to rise well above the
     * shoulder and then descend from that peak before issuing any verdict.
     */
    private hasBeginnerFollowThroughCompleted(): boolean {
        const currentWristHeight = this.getRightWristHeight();
        const reachedStrikeHeight = this.maxRightWristHeight >= 0.25;
        const descendedFromPeak = (this.maxRightWristHeight - currentWristHeight) >= 0.20;
        return reachedStrikeHeight && descendedFromPeak;
    }

    /**
     * Detect whether movement looks like the start of a real serve (not a pre-serve bounce).
     */
    private detectServeOnsetSignals(): boolean {
        const velocity = this.velocityHistory[this.velocityHistory.length - 1] || 0;
        const avgVelocity = this.velocityHistory.length > 0
            ? this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length
            : 0;
        const leftWristHeight = this.getLeftWristHeight();
        const rightWristHeight = this.getRightWristHeight();
        const kneeBend = this.calculateKneeBend();
        const armExtension = this.calculateArmExtension();
        const ballTossing = this.detectBallToss();
        const kneeReliable = this.hasReliableKneeLandmarks();
        const setupVisible = this.isServeSetupVisible();

        // Toss cue: left arm up while serving arm is still comparatively lower, or tracked ball rise.
        const splitArmTossPose = this.isSplitArmTossPose(leftWristHeight, rightWristHeight);
        const tossCue = ballTossing || splitArmTossPose;
        const tossSustained = this.tossEvidenceFrames >= 2;

        // Real serve onset should include controlled motion, not static arm raises.
        const motionCue = (
            velocity > Math.max(0.018, avgVelocity * 1.08)
            && velocity < 0.50
            && this.hasRecentMotion(0.012, 6, 0.34)
        );

        // Loading posture cue: avoid blocking when knees are partially out of frame.
        const postureCue = (kneeReliable ? kneeBend < 0.86 : true) && (armExtension < 1.08);

        const beginnerSwingCue = this.isHittingArmVisible()
            && velocity > Math.max(0.012, avgVelocity * 1.03)
            && this.hasRecentMotion(0.010, 4, 0.30);

        // Live shadow practice is often framed from the chest upward and may not
        // include a ball or a literal toss. It can start from sustained serving-arm
        // motion, while later phase gates still require upward extension and a
        // follow-through descent before a rep is completed.
        const upperBodyShadowCue = this.allowUpperBodyShadowMode
            && this.isHittingArmVisible()
            && postureCue
            && ((tossCue && tossSustained && motionCue) || beginnerSwingCue);

        if (this.allowUpperBodyShadowMode && upperBodyShadowCue) {
            return upperBodyShadowCue;
        }

        if (!setupVisible && !ballTossing && !this.beginnerPronationMode) return false;

        if (this.beginnerPronationMode) {
            return postureCue && (motionCue || beginnerSwingCue);
        }

        return tossCue && tossSustained && motionCue && postureCue;
    }

    private isSplitArmTossPose(leftWristHeight: number, rightWristHeight: number): boolean {
        return leftWristHeight > 0.24
            && rightWristHeight < 0.20
            && (leftWristHeight - rightWristHeight) > 0.16;
    }

    /**
     * Require core full-body landmarks so upper-body-only framing cannot arm the serve pipeline.
     */
    private isFullBodyVisible(): boolean {
        if (this.poseHistory.length === 0) return false;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const required = [
            this.LANDMARK_INDICES.LEFT_SHOULDER,
            this.LANDMARK_INDICES.RIGHT_SHOULDER,
            this.LANDMARK_INDICES.LEFT_HIP,
            this.LANDMARK_INDICES.RIGHT_HIP,
            this.LANDMARK_INDICES.LEFT_KNEE,
            this.LANDMARK_INDICES.RIGHT_KNEE,
        ];

        return required.every((idx) => {
            const lm = current[idx];
            return !!lm && (lm.visibility ?? 0) >= 0.35;
        });
    }

    /**
     * Phone pronation drills need only the serving shoulder, elbow, and wrist
     * in frame. Requiring hips here kept the detector stuck at start for users
     * who correctly frame their upper body and racket close to the camera.
     */
    private isHittingArmVisible(): boolean {
        if (this.poseHistory.length === 0) return false;
        const current = this.poseHistory[this.poseHistory.length - 1];
        const shoulderIndex = this.handedness === 'right'
            ? this.LANDMARK_INDICES.RIGHT_SHOULDER
            : this.LANDMARK_INDICES.LEFT_SHOULDER;
        const elbowIndex = this.handedness === 'right'
            ? this.LANDMARK_INDICES.RIGHT_ELBOW
            : this.LANDMARK_INDICES.LEFT_ELBOW;
        const wristIndex = this.handedness === 'right'
            ? this.LANDMARK_INDICES.RIGHT_WRIST
            : this.LANDMARK_INDICES.LEFT_WRIST;

        return [shoulderIndex, elbowIndex, wristIndex].every((index) => {
            const landmark = current[index];
            return !!landmark && (landmark.visibility ?? 0) >= 0.30;
        });
    }

    /**
     * Serve setup visibility: shoulders+hips and at least one lower-body chain visible.
     */
    private isServeSetupVisible(): boolean {
        if (this.poseHistory.length === 0) return false;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const shoulderHipCore = [
            this.LANDMARK_INDICES.LEFT_SHOULDER,
            this.LANDMARK_INDICES.RIGHT_SHOULDER,
            this.LANDMARK_INDICES.LEFT_HIP,
            this.LANDMARK_INDICES.RIGHT_HIP,
        ];

        const coreVisible = shoulderHipCore.every((idx) => {
            const lm = current[idx];
            return !!lm && (lm.visibility ?? 0) >= 0.35;
        });

        if (!coreVisible) {
            return false;
        }

        const lowerBodyCandidates = [
            this.LANDMARK_INDICES.LEFT_KNEE,
            this.LANDMARK_INDICES.RIGHT_KNEE,
            31,
            32,
        ];

        return lowerBodyCandidates.some((idx) => {
            const lm = current[idx];
            return !!lm && (lm.visibility ?? 0) >= 0.25;
        });
    }

    private hasReliableKneeLandmarks(): boolean {
        if (this.poseHistory.length === 0) return false;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const rightHip = current[this.LANDMARK_INDICES.RIGHT_HIP];
        const rightKnee = current[this.LANDMARK_INDICES.RIGHT_KNEE];
        const rightAnkle = current[32];

        return !!rightHip
            && !!rightKnee
            && !!rightAnkle
            && (rightHip.visibility ?? 0) >= 0.3
            && (rightKnee.visibility ?? 0) >= 0.3
            && (rightAnkle.visibility ?? 0) >= 0.3;
    }

    /**
     * Calculate right wrist velocity (key indicator of serve acceleration)
     * Includes smoothing for reliability
     */
    private calculateRightWristVelocity(): number {
        if (this.poseHistory.length < 2) return 0;

        const previous = this.poseHistory[this.poseHistory.length - 2];
        const current = this.poseHistory[this.poseHistory.length - 1];
        const hittingWristIndex = this.handedness === 'right'
            ? this.LANDMARK_INDICES.RIGHT_WRIST
            : this.LANDMARK_INDICES.LEFT_WRIST;
        const rightWristPrev = previous[hittingWristIndex];
        const rightWristCurr = current[hittingWristIndex];
        if (!rightWristPrev || !rightWristCurr) return 0;
        const prevVis = rightWristPrev.visibility ?? 1;
        const currVis = rightWristCurr.visibility ?? 1;
        if (prevVis < 0.3 || currVis < 0.3) return 0;
        const dx = rightWristCurr.x - rightWristPrev.x;
        const dy = rightWristCurr.y - rightWristPrev.y;
        const dz = rightWristCurr.z - rightWristPrev.z;
        const velocity = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Apply exponential moving average for smoothing
        if (this.velocityHistory.length > 0) {
            const lastVelocity = this.velocityHistory[this.velocityHistory.length - 1];
            return lastVelocity * 0.6 + velocity * 0.4;
        }

        return velocity;
    }

    private getHittingWristVerticalVelocity(): number {
        if (this.poseHistory.length < 2) return 0;

        const previous = this.poseHistory[this.poseHistory.length - 2];
        const current = this.poseHistory[this.poseHistory.length - 1];
        const wristIndex = this.handedness === 'right'
            ? this.LANDMARK_INDICES.RIGHT_WRIST
            : this.LANDMARK_INDICES.LEFT_WRIST;
        const previousWrist = previous[wristIndex];
        const currentWrist = current[wristIndex];

        if (!previousWrist || !currentWrist) return 0;
        if ((previousWrist.visibility ?? 1) < 0.3 || (currentWrist.visibility ?? 1) < 0.3) return 0;

        return previousWrist.y - currentWrist.y;
    }

    /**
     * Calculate racket velocity (from YOLO detection)
     */
    private calculateRacketVelocity(): number {
        if (this.racketHistory.length < 2) return 0;

        const previous = this.racketHistory[this.racketHistory.length - 2];
        const current = this.racketHistory[this.racketHistory.length - 1];

        const dx = current.x - previous.x;
        const dy = current.y - previous.y;

        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Detect ball toss event (ball rises significantly)
     */
    private detectBallToss(): boolean {
        if (this.ballHistory.length < 5) return false;

        const recent = this.ballHistory.slice(-5);
        const heights = recent.map(b => b.y);

        // Ball should be moving upward overall
        const isRising = heights[4] < heights[0];
        const ballConfidence = recent.every(b => b.confidence > 0.3);

        return isRising && ballConfidence;
    }

    /**
     * Detect contact point (racket/wrist at high altitude + high velocity or actual ball contact)
     */
    private detectContact(): boolean {
        const velocity = this.velocityHistory[this.velocityHistory.length - 1] || 0;
        const avgVelocity = this.velocityHistory.length > 0
            ? this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length
            : 0;
        const accel = this.velocityHistory.length >= 2
            ? this.velocityHistory[this.velocityHistory.length - 1] - this.velocityHistory[this.velocityHistory.length - 2]
            : 0;

        // CV evidence: ball close to racket with elevated racket velocity and impact-like trajectory change.
        let cvContact = false;
        if (this.ballHistory.length > 0 && this.racketHistory.length > 0) {
            const ball = this.ballHistory[this.ballHistory.length - 1];
            const racket = this.racketHistory[this.racketHistory.length - 1];
            const racketVelocity = this.racketVelocityHistory[this.racketVelocityHistory.length - 1] || 0;
            const avgRacketVel = this.racketVelocityHistory.length > 0
                ? this.racketVelocityHistory.reduce((a, b) => a + b) / this.racketVelocityHistory.length
                : 0;

            const dx = ball.x - racket.x;
            const dy = ball.y - racket.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Coordinates are normalized (0..1). Use dynamic normalized tolerance.
            const radius = typeof ball.radius === 'number' && Number.isFinite(ball.radius) ? ball.radius : 0.02;
            const proximityTol = Math.max(0.04, Math.min(0.12, 0.06 + radius * 0.9));
            const nearRacketNow = distance < proximityTol;

            let nearRacketPrev = false;
            if (this.ballHistory.length >= 2 && this.racketHistory.length >= 2) {
                const prevBall = this.ballHistory[this.ballHistory.length - 2];
                const prevRacket = this.racketHistory[this.racketHistory.length - 2];
                const pdx = prevBall.x - prevRacket.x;
                const pdy = prevBall.y - prevRacket.y;
                nearRacketPrev = Math.sqrt(pdx * pdx + pdy * pdy) < proximityTol * 1.15;
            }

            const reliableBall = ball.confidence > 0.2;
            const reliableRacket = racket.confidence > 0.2;
            const swingCue = racketVelocity > Math.max(0.008, avgRacketVel * 1.2);

            // Ball trajectory cue around impact: speed jump or direction deflection.
            let speedJump = false;
            let deflection = false;
            if (this.ballHistory.length >= 3) {
                const b0 = this.ballHistory[this.ballHistory.length - 3];
                const b1 = this.ballHistory[this.ballHistory.length - 2];
                const b2 = this.ballHistory[this.ballHistory.length - 1];

                const v1x = b1.x - b0.x;
                const v1y = b1.y - b0.y;
                const v2x = b2.x - b1.x;
                const v2y = b2.y - b1.y;

                const s1 = Math.sqrt(v1x * v1x + v1y * v1y);
                const s2 = Math.sqrt(v2x * v2x + v2y * v2y);
                speedJump = s2 > Math.max(0.004, s1 * 1.25);

                const dot = v1x * v2x + v1y * v2y;
                const denom = Math.max(1e-6, s1 * s2);
                const cos = Math.max(-1, Math.min(1, dot / denom));
                deflection = cos < 0.35;
            }

            cvContact = reliableBall
                && reliableRacket
                && nearRacketNow
                && (swingCue || nearRacketPrev)
                && (speedJump || deflection || swingCue);
        }

        // Kinematic fallback: wrist reaches high speed at full extension.
        const armExtension = this.calculateArmExtension();
        const rightWristHeight = this.getRightWristHeight();
        const highSpeed = velocity > Math.max(0.028, avgVelocity * 1.2);
        const postureAtStrike = armExtension > 0.50 && rightWristHeight > 0.15;
        const kinematicContact = highSpeed && postureAtStrike;

        return cvContact || kinematicContact;
    }

    /**
     * Calculate knee bend with visibility checks
     */
    private calculateKneeBend(): number {
        if (this.poseHistory.length === 0) return 1.0;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const rightHip = current[this.LANDMARK_INDICES.RIGHT_HIP];
        const rightKnee = current[this.LANDMARK_INDICES.RIGHT_KNEE];
        const rightAnkle = current[32];

        if (!rightHip || !rightKnee || !rightAnkle) return 1.0;

        // Check visibility
        if ((rightHip.visibility ?? 1) < 0.3 || (rightKnee.visibility ?? 1) < 0.3 || (rightAnkle.visibility ?? 1) < 0.3) {
            return 1.0;
        }

        const v1 = { x: rightKnee.x - rightHip.x, y: rightKnee.y - rightHip.y };
        const v2 = { x: rightAnkle.x - rightKnee.x, y: rightAnkle.y - rightKnee.y };

        const dot = v1.x * v2.x + v1.y * v2.y;
        const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
        const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);

        if (mag1 === 0 || mag2 === 0) return 1.0;

        const cos = dot / (mag1 * mag2);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));

        return 1 - (angle / Math.PI);
    }

    /**
     * Calculate arm extension with visibility checks
     */
    private calculateArmExtension(): number {
        if (this.poseHistory.length === 0) return 0.5;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const shoulder = current[this.handedness === 'right' ? this.LANDMARK_INDICES.RIGHT_SHOULDER : this.LANDMARK_INDICES.LEFT_SHOULDER];
        const elbow = current[this.handedness === 'right' ? this.LANDMARK_INDICES.RIGHT_ELBOW : this.LANDMARK_INDICES.LEFT_ELBOW];
        const wrist = current[this.handedness === 'right' ? this.LANDMARK_INDICES.RIGHT_WRIST : this.LANDMARK_INDICES.LEFT_WRIST];

        if (!shoulder || !elbow || !wrist) return 0.5;

        // Check visibility
        if ((shoulder.visibility ?? 1) < 0.3 || (elbow.visibility ?? 1) < 0.3 || (wrist.visibility ?? 1) < 0.3) {
            return 0.5; // Return neutral value for unreliable landmarks
        }

        // Calculate the angle at the elbow: Shoulder-Elbow-Wrist
        const v1 = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
        const v2 = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };

        const dot = v1.x * v2.x + v1.y * v2.y;
        const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
        const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);

        if (mag1 === 0 || mag2 === 0) return 0.5;

        const cos = dot / (mag1 * mag2);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));

        // angle is ~180 (Math.PI) for straight arm, 0 for fully bent.
        return angle / Math.PI; // Maps straight to 1.0, 90-degree to 0.5, folded to 0.0
    }

    /**
     * Get left wrist height (for ball toss) with visibility checks
     */
    private getLeftWristHeight(): number {
        if (this.poseHistory.length === 0) return 0.0;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const tossWristIndex = this.handedness === 'right' ? this.LANDMARK_INDICES.LEFT_WRIST : this.LANDMARK_INDICES.RIGHT_WRIST;
        const tossShoulderIndex = this.handedness === 'right' ? this.LANDMARK_INDICES.LEFT_SHOULDER : this.LANDMARK_INDICES.RIGHT_SHOULDER;
        const leftWrist = current[tossWristIndex];
        const leftShoulder = current[tossShoulderIndex];

        if (!leftWrist || !leftShoulder) return 0.0;

        if ((leftWrist.visibility ?? 1) < 0.3 || (leftShoulder.visibility ?? 1) < 0.3) {
            return 0.0;
        }

        // Return raw relative Y. Positive means above shoulder, negative means below.
        return (leftShoulder.y - leftWrist.y) / 0.3;
    }

    /**
     * Get right wrist height with visibility checks
     */
    private getRightWristHeight(): number {
        if (this.poseHistory.length === 0) return 0.0;

        const current = this.poseHistory[this.poseHistory.length - 1];
        const hittingWristIndex = this.handedness === 'right' ? this.LANDMARK_INDICES.RIGHT_WRIST : this.LANDMARK_INDICES.LEFT_WRIST;
        const hittingShoulderIndex = this.handedness === 'right' ? this.LANDMARK_INDICES.RIGHT_SHOULDER : this.LANDMARK_INDICES.LEFT_SHOULDER;
        const rightWrist = current[hittingWristIndex];
        const rightShoulder = current[hittingShoulderIndex];

        if (!rightWrist || !rightShoulder) return 0.0;

        if ((rightWrist.visibility ?? 1) < 0.3 || (rightShoulder.visibility ?? 1) < 0.3) {
            return 0.0;
        }

        // Return raw relative Y. Positive means above shoulder, negative means below.
        return (rightShoulder.y - rightWrist.y) / 0.4;
    }

    /**
     * Get racket position relative to wrist (if available)
     */
    private getRacketPosition(): number {
        if (this.racketHistory.length === 0 || this.poseHistory.length === 0) return 0.5;

        const racket = this.racketHistory[this.racketHistory.length - 1];
        const wrist = this.poseHistory[this.poseHistory.length - 1][this.handedness === 'right' ? this.LANDMARK_INDICES.RIGHT_WRIST : this.LANDMARK_INDICES.LEFT_WRIST];

        if (!wrist) return 0.5;

        // How far below the wrist is the racket? (0 = wrist level, 1 = far below)
        return Math.max(0, (racket.y - wrist.y) / 0.2);
    }

    /**
     * Detect phase with enforced state machine
     * Only allows transitions to the next phase in sequence
     */
    private detectPhaseWithStateEnforcement(): string {
        const velocity = this.velocityHistory[this.velocityHistory.length - 1] || 0;
        const avgVelocity = this.velocityHistory.length > 0
            ? this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length
            : 0;
        const accel = this.velocityHistory.length >= 2
            ? this.velocityHistory[this.velocityHistory.length - 1] - this.velocityHistory[this.velocityHistory.length - 2]
            : 0;

        const kneeBend = this.calculateKneeBend();
        const armExtension = this.calculateArmExtension();
        const leftWristHeight = this.getLeftWristHeight();
        const rightWristHeight = this.getRightWristHeight();
        const ballTossing = this.detectBallToss();
        const contactDetected = this.detectContact();
        const hittingWristVerticalVelocity = this.getHittingWristVerticalVelocity();

        // Find current phase index
        const currentIndex = this.PHASE_ORDER.indexOf(this.currentPhase);

        // Try to transition to NEXT phase only
        const nextIndex = (currentIndex + 1) % this.PHASE_ORDER.length;
        const nextPhase = this.PHASE_ORDER[nextIndex];

        // Fast phases need much shorter frame gates
        let minFrames = this.MIN_PHASE_DURATION;
        if (this.currentPhase === 'contact') minFrames = 1;
        if (this.currentPhase === 'cocking') minFrames = 2;
        if (this.currentPhase === 'acceleration') minFrames = 1;

        if (this.beginnerPronationMode) {
            minFrames = Math.min(minFrames, 2);
        }

        const canAdvance = this.frameInPhase >= minFrames
            && this.validatePhaseTransition(
                this.currentPhase,
                nextPhase,
                velocity,
                avgVelocity,
                accel,
                kneeBend,
                armExtension,
                leftWristHeight,
                rightWristHeight,
                ballTossing,
                contactDetected,
                hittingWristVerticalVelocity
            );

        const targetPhase = canAdvance ? nextPhase : null;

        if (targetPhase !== null) {
            if (this.transitionCandidatePhase !== targetPhase) {
                this.transitionCandidatePhase = targetPhase;
                this.transitionCandidateFrames = 1;
                return this.currentPhase;
            }

            this.transitionCandidateFrames += 1;

            // Explosive swing phases should trigger almost instantly without waiting 3 frames
            let neededConfirmations = this.MIN_TRANSITION_CONFIRMATION_FRAMES;
            if (['acceleration', 'contact', 'deceleration'].includes(targetPhase)) {
                neededConfirmations = 1; // Instant transition for rapid motion
            }
            if (this.transitionCandidateFrames >= neededConfirmations) {
                this.transitionCandidatePhase = null;
                this.transitionCandidateFrames = 0;
                return targetPhase;
            }

            return this.currentPhase;
        }

        // Do not auto-advance on timeout; this can falsely complete serves from noisy gestures.

        this.transitionCandidatePhase = null;
        this.transitionCandidateFrames = 0;

        return this.currentPhase;
    }

    /**
     * Checks whether there is sustained movement in recent frames.
     * This prevents phase auto-advancement when the athlete stops moving.
     */
    private hasRecentMotion(minVelocity: number, lookbackFrames = 6, minActiveRatio = 0.34): boolean {
        if (this.velocityHistory.length === 0) return false;

        const samples = this.velocityHistory.slice(-Math.max(1, lookbackFrames));
        const active = samples.filter((v) => v >= minVelocity).length;
        return active / samples.length >= minActiveRatio;
    }

    /**
     * Validate phase with relaxed thresholds and better signal smoothing
     */
    private validatePhase(
        phase: string,
        velocity: number,
        avgVelocity: number,
        accel: number,
        kneeBend: number,
        armExtension: number,
        leftWristHeight: number,
        rightWristHeight: number,
        ballTossing: boolean,
        contactDetected: boolean
    ): boolean {
        // Apply smoothing to reduce false negatives
        const smoothedVelocity = velocity * 0.7 + (avgVelocity * 0.3);

        switch (phase) {
            case 'start':
                // Arms at rest, low movement.
                return smoothedVelocity < 0.03 && armExtension < 0.85;

            case 'release':
                // Ball release/toss from non-serving hand.
                return (ballTossing || leftWristHeight > 0.30) && smoothedVelocity < 0.22;

            case 'loading':
                // Lower body loading and knee flexion.
                return kneeBend < 0.62 && smoothedVelocity < 0.30;

            case 'cocking':
                // Shoulder external rotation / racket drop approximation.
                return armExtension < 0.96 && rightWristHeight > 0.03 && smoothedVelocity < 0.28;

            case 'acceleration':
                // Rapid acceleration into the strike.
                return smoothedVelocity > Math.max(0.016, avgVelocity * 1.02) && accel > -0.004;

            case 'contact':
                // Contact is a short event, not a sustained state.
                return (contactDetected || (smoothedVelocity > avgVelocity * 1.1 && armExtension > 0.45))
                    && rightWristHeight > 0.20;

            case 'deceleration':
                // Immediately after contact while body decelerates.
                return smoothedVelocity < avgVelocity * 1.8 || accel < 0.02;

            case 'finish':
                // End of serve motion before resetting.
                return smoothedVelocity < 0.08 || rightWristHeight < 0.16;

            default:
                return true;
        }
    }

    /**
     * Validate transitions using movement evidence only.
     * This prevents auto-advancing through phases from noisy arm movement.
     */
    private validatePhaseTransition(
        fromPhase: string,
        toPhase: string,
        velocity: number,
        avgVelocity: number,
        accel: number,
        kneeBend: number,
        armExtension: number,
        leftWristHeight: number,
        rightWristHeight: number,
        ballTossing: boolean,
        contactDetected: boolean,
        hittingWristVerticalVelocity: number
    ): boolean {
        const smoothedVelocity = velocity * 0.7 + (avgVelocity * 0.3);
        const isMoving = smoothedVelocity > 0.015; // Low noise threshold

        // start → release
        if (fromPhase === 'start' && toPhase === 'release') {
            if (this.beginnerPronationMode) {
                return this.isHittingArmVisible()
                    && isMoving
                    && this.hasRecentMotion(0.010, 4, 0.30);
            }
            if (this.allowUpperBodyShadowMode) {
                return this.isHittingArmVisible()
                    && isMoving
                    && (this.isSplitArmTossPose(leftWristHeight, rightWristHeight)
                        || (armExtension < 0.88 && rightWristHeight < 0.18))
                    && this.hasRecentMotion(0.010, 4, 0.30);
            }
            // Require true toss structure before beginning the serve. Shadow mode
            // permits a tight upper-body frame, but not a toss-less arm wave.
            const setupOrShadowVisible = this.isServeSetupVisible()
                || (this.allowUpperBodyShadowMode && this.isHittingArmVisible());
            return setupOrShadowVisible
                && this.hasTossEvidence
                && (ballTossing || this.isSplitArmTossPose(leftWristHeight, rightWristHeight))
                && isMoving;
        }

        // release → loading
        if (fromPhase === 'release' && toPhase === 'loading') {
            if (this.beginnerPronationMode) {
                return isMoving;
            }
            if (this.allowUpperBodyShadowMode) {
                return isMoving
                    && armExtension < 0.90
                    && rightWristHeight < 0.20;
            }
            // Player begins dropping into knee bend (1.0 = straight, 0.75 = 45deg bend)
            return this.hasTossEvidence && rightWristHeight < 0.15 && isMoving;
        }

        // loading → cocking
        if (fromPhase === 'loading' && toPhase === 'cocking') {
            if (this.beginnerPronationMode) {
                return isMoving && (armExtension < 0.95 || rightWristHeight < 0.20);
            }
            if (this.allowUpperBodyShadowMode) {
                return isMoving
                    && armExtension < 0.78
                    && rightWristHeight < 0.18;
            }
            // Trophy pose/racket drop. Right wrist must drop back down, or elbow bent deeply.
            return (armExtension < 0.70 || rightWristHeight < 0.06) && isMoving;
        }

        // cocking → acceleration
        if (fromPhase === 'cocking' && toPhase === 'acceleration') {
            if (this.beginnerPronationMode) {
                return smoothedVelocity > Math.max(0.016, avgVelocity * 1.02) && accel > -0.012;
            }
            if (this.allowUpperBodyShadowMode) {
                return smoothedVelocity > Math.max(0.016, avgVelocity * 1.02)
                    && accel > -0.012
                    && hittingWristVerticalVelocity > 0.008
                    && this.hasRecentMotion(0.014, 5, 0.30);
            }
            // The upward explosion. Wrist breaks above shoulder level with high velocity.
            return rightWristHeight > 0.15 && smoothedVelocity > 0.025 && accel > -0.005 && this.hasRecentMotion(0.018, 6, 0.4);
        }

        // acceleration → contact
        if (fromPhase === 'acceleration' && toPhase === 'contact') {
            if (this.beginnerPronationMode) {
                const beginnerStrike = armExtension > 0.45
                    && rightWristHeight > 0.10
                    && smoothedVelocity > Math.max(0.016, avgVelocity * 1.02);
                return contactDetected || beginnerStrike;
            }
            if (this.allowUpperBodyShadowMode) {
                const shadowStrike = armExtension > 0.72
                    && rightWristHeight > 0.25
                    && hittingWristVerticalVelocity > -0.004
                    && this.hasRecentMotion(0.016, 4, 0.30);
                return contactDetected || shadowStrike;
            }
            // Maximum reach: arm is straight and wrist is extremely high above head.
            const strikePosture = armExtension > 0.80 && rightWristHeight > 0.50;
            return contactDetected || (strikePosture && this.hasAccelerationEvidence);
        }

        // contact → deceleration
        if (fromPhase === 'contact' && toPhase === 'deceleration') {
            if (this.beginnerPronationMode) {
                return this.frameInPhase >= 1 && (smoothedVelocity < avgVelocity * 1.6 || accel < 0.006);
            }
            if (this.allowUpperBodyShadowMode) {
                return this.frameInPhase >= 1
                    && this.maxRightWristHeight >= 0.25
                    && (hittingWristVerticalVelocity < -0.006 || accel < -0.002);
            }
            // The wrist naturally comes back down below the peak height.
            return this.maxRightWristHeight > 0.42 && rightWristHeight < 0.30;
        }

        // deceleration → finish
        if (fromPhase === 'deceleration' && toPhase === 'finish') {
            if (this.beginnerPronationMode) {
                const descendedFromPeak = (this.maxRightWristHeight - rightWristHeight) >= 0.20;
                return this.frameInPhase >= 2
                    && this.maxRightWristHeight >= 0.25
                    && descendedFromPeak
                    && (smoothedVelocity < avgVelocity * 1.4 || accel <= 0.004);
            }
            if (this.allowUpperBodyShadowMode) {
                const descendedFromPeak = (this.maxRightWristHeight - rightWristHeight) >= 0.12;
                return this.frameInPhase >= 2
                    && descendedFromPeak
                    && (smoothedVelocity < avgVelocity * 1.5 || accel <= 0.008);
            }
            // The arm sweeps completely across/down the body (well below shoulder).
            return rightWristHeight < -0.30;
        }

        // finish → start
        if (fromPhase === 'finish' && toPhase === 'start') {
            // Require settling down and resting.
            return smoothedVelocity < 0.015 && this.frameInPhase > 25;
        }

        return false;
    }

    /**
     * Get phase progress (0-1) FRAME-BASED instead of time-based
     * This ensures all phases complete within reasonable frame counts even on short videos
     */
    getPhaseProgress(): number {
        // Use frame-based duration instead of milliseconds
        const maxFrames = this.PHASE_FRAME_DURATIONS[this.currentPhase] || 5;

        // Progress is capped at current frame count to allow for variable-length phases
        // This prevents phases from hitting 1.0 and getting stuck
        return Math.min(1, this.frameInPhase / Math.max(1, maxFrames));
    }

    getPhaseSequence(): string[] {
        return [...this.phaseSequence];
    }

    /**
     * Check if the serve is complete (reached follow_through phase)
     */
    isServeComplete(): boolean {
        return this.serveComplete;
    }

    isServeAuthentic(): boolean {
        const requiredCorePhases = ['release', 'loading', 'acceleration', 'contact'];
        const hasCorePhases = requiredCorePhases.every((p) => this.phaseSequence.includes(p));
        const serveFrames = this.getServeFrameCount();

        // Require evidence: toss + ordered motion phases + enough frames
        const tossOrSwingEvidence = this.hasTossEvidence;

        // Core check: minimal motion + sequence completeness
        if (!hasCorePhases || serveFrames < 4) {
            return false;  // Reject: need core phases and minimum frames
        }

        if (!tossOrSwingEvidence) {
            return false;
        }

        const minWristHeight = 0.25;
        if (this.maxRightWristHeight < minWristHeight) {
            return false;
        }

        const kneeExcursion = this.maxKneeBendSeen - this.minKneeBendSeen;
        if (kneeExcursion < 0.02) {
            return false;
        }

        const wristExcursion = this.maxRightWristHeight - this.minRightWristHeight;
        if (wristExcursion < 0.25) {
            return false;
        }

        let signals = 0;
        if (this.hasAccelerationEvidence) signals++;
        if (this.hasContactEvidence) signals++;

        return signals >= 1;
    }

    /**
     * Get the total frames the current serve has taken
     */
    getServeFrameCount(): number {
        if (this.serveStartFrame === -1) return 0;
        return this.totalFramesProcessed - this.serveStartFrame;
    }

    reset(): void {
        this.poseHistory = [];
        this.racketHistory = [];
        this.ballHistory = [];
        this.velocityHistory = [];
        this.racketVelocityHistory = [];
        this.currentPhase = 'start';
        this.phaseStartFrame = 0;
        this.phaseSequence = [];
        this.frameInPhase = 0;
        this.totalFramesProcessed = 0;
        this.serveComplete = false;
        this.serveStartFrame = -1;
        this.serveArmed = false;
        this.onsetEvidenceFrames = 0;
        this.transitionCandidatePhase = null;
        this.transitionCandidateFrames = 0;
        this.tossEvidenceFrames = 0;
        this.hasTossEvidence = false;
        this.hasAccelerationEvidence = false;
        this.hasContactEvidence = false;
        this.maxRightWristHeight = 0;
        this.minRightWristHeight = 0;
        this.minKneeBendSeen = 1;
        this.maxKneeBendSeen = 0;
    }
}
