/**
 * Intelligent Tennis Serve Coaching System
 * 
 * Provides pro-level feedback by:
 * 1. Tracking serve phases (preparation → ball_toss → loading → contact → finish)
 * 2. Detecting multiple errors per phase
 * 3. Prioritizing feedback on the most critical error
 * 4. Using patient, natural coaching language
 * 5. Waiting for complete serve before coaching feedback
 */

export interface ServeError {
    type: string;
    severity: 'critical' | 'important' | 'minor';
    phase: string;
    description: string;
    correction: string;
    priority: number; // Higher = more important
}

export interface PhaseAnalysis {
    currentPhase: string;
    phaseProgress: number; // 0-1 within current phase
    detectedErrors: ServeError[];
    primaryError: ServeError | null;
    feedback: string;
}

export interface ServeAttempt {
    startTime: number;
    endTime: number;
    allErrors: ServeError[];
    criticalErrors: ServeError[];
    phaseErrors: Record<string, ServeError[]>;
    overallFeedback: string;
}

/**
 * Serve State Tracker
 * Detects when a serve starts, completes, and provides end-of-serve feedback
 */
export class ServeStateTracker {
    private state: 'idle' | 'in_serve' = 'idle';
    private serveStartTime: number = 0;
    private lastPhase: string = 'preparation';
    private phaseSequence: string[] = []; // Track phases in order
    private readonly EXPECTED_PHASES = [
        'preparation',
        'ball_toss',
        'trophy_position',
        'loading',
        'contact',
        'follow_through'
    ];
    private readonly SERVE_MIN_DURATION = 1000; // Min 1 second for valid serve
    private readonly SERVE_MAX_DURATION = 5000; // Max 5 seconds
    private phaseStartTime: number = 0;

    /**
     * Update serve state based on current phase
     * A complete serve must progress through all phases: preparation -> ball_toss -> trophy_position -> loading -> contact -> follow_through -> preparation
     */
    updateServeState(currentPhase: string): 'idle' | 'serve_started' | 'serve_ended' {
        const now = Date.now();

        // Track phase transitions
        if (currentPhase !== this.lastPhase) {
            // Only add if this is a forward or backward transition (not just noise)
            if (this.phaseSequence.length === 0 || currentPhase !== this.phaseSequence[this.phaseSequence.length - 1]) {
                this.phaseSequence.push(currentPhase);
            }
            this.phaseStartTime = now;
            this.lastPhase = currentPhase;
        }

        // Serve Start: Detect beginning of serve motion
        // Looking for transition from preparation to something else (usually ball_toss or trophy_position)
        if (this.state === 'idle') {
            if (
                currentPhase !== 'preparation' &&
                (this.phaseSequence.length === 0 || this.phaseSequence[0] === 'preparation')
            ) {
                // User moved away from preparation - serve is starting
                this.state = 'in_serve';
                this.serveStartTime = now;
                this.phaseSequence = ['preparation', currentPhase];
                return 'serve_started';
            }
        }

        // Serve End: Detect end of serve motion
        if (this.state === 'in_serve') {
            const serveDuration = now - this.serveStartTime;

            // Check if we've completed a full serve cycle
            // We need: preparation -> ... -> contact -> follow_through -> back to preparation
            const hasContactPhase = this.phaseSequence.includes('contact');
            const hasFollowThrough = this.phaseSequence.includes('follow_through');
            const backToPreparation =
                currentPhase === 'preparation' &&
                this.phaseSequence.length > 3 &&
                this.phaseSequence[this.phaseSequence.length - 1] !== 'preparation';

            // Valid serve: went through contact AND follow_through and returned to prep, OR timeout
            if (
                (hasContactPhase && hasFollowThrough && backToPreparation && serveDuration > this.SERVE_MIN_DURATION) ||
                serveDuration > this.SERVE_MAX_DURATION
            ) {
                this.state = 'idle';
                this.phaseSequence = [];
                this.lastPhase = 'preparation';
                return 'serve_ended';
            }

            // Still in serve, no state change
            return 'idle';
        }

        return 'idle';
    }

    /**
     * Check if currently in a serve
     */
    isInServe(): boolean {
        return this.state === 'in_serve';
    }

    /**
     * Get the phase sequence so far (for debugging)
     */
    getPhaseSequence(): string[] {
        return [...this.phaseSequence];
    }

    /**
     * Reset for new serve
     */
    reset(): void {
        this.state = 'idle';
        this.serveStartTime = 0;
        this.phaseSequence = [];
        this.lastPhase = 'preparation';
        this.phaseStartTime = 0;
    }
}

/**
 * Serve Analyzer
 * Accumulates errors across entire serve and generates comprehensive feedback
 */
export class ServeAnalyzer {
    private currentServeErrors: ServeError[] = [];
    private phaseErrors: Record<string, ServeError[]> = {};
    private allServeAttempts: ServeAttempt[] = [];

    /**
     * Add error from current frame
     */
    addError(error: ServeError): void {
        this.currentServeErrors.push(error);

        // Group by phase
        if (!this.phaseErrors[error.phase]) {
            this.phaseErrors[error.phase] = [];
        }
        this.phaseErrors[error.phase].push(error);
    }

    /**
     * Finalize serve and generate feedback
     */
    finalizeServe(): ServeAttempt | null {
        if (this.currentServeErrors.length === 0) {
            // Perfect serve!
            const serve: ServeAttempt = {
                startTime: Date.now(),
                endTime: Date.now(),
                allErrors: [],
                criticalErrors: [],
                phaseErrors: {},
                overallFeedback: 'Excellent serve! That was smooth and clean. Keep it up!'
            };
            this.reset();
            return serve;
        }

        // Categorize errors
        const criticalErrors = this.currentServeErrors.filter(
            e => e.severity === 'critical'
        );
        const importantErrors = this.currentServeErrors.filter(
            e => e.severity === 'important'
        );

        // Generate comprehensive feedback
        let feedback = '';

        if (criticalErrors.length > 0) {
            // Focus on most critical error
            const topCritical = criticalErrors.sort((a, b) => b.priority - a.priority)[0];
            feedback = `Good try. Let's work on this: ${topCritical.correction}`;
        } else if (importantErrors.length > 0) {
            const topImportant = importantErrors.sort((a, b) => b.priority - a.priority)[0];
            feedback = `Nice effort. One thing: ${topImportant.correction}`;
        } else {
            feedback = `Good swing! Keep working on the details.`;
        }

        // Add pattern suggestion
        const patterns = this.analyzeErrorPatterns();
        if (patterns.length > 0) {
            feedback += ` Also, ${patterns[0].toLowerCase()}`;
        }

        const serve: ServeAttempt = {
            startTime: Date.now(),
            endTime: Date.now(),
            allErrors: this.currentServeErrors,
            criticalErrors,
            phaseErrors: this.phaseErrors,
            overallFeedback: feedback
        };
        this.allServeAttempts.push(serve);
        this.reset();

        return serve;
    }

    /**
     * Detect error patterns from current serve
     */
    private analyzeErrorPatterns(): string[] {
        const patterns: string[] = [];
        const errorCounts: Record<string, number> = {};

        for (const error of this.currentServeErrors) {
            errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
        }

        // If same error type repeated multiple times
        for (const [type, count] of Object.entries(errorCounts)) {
            if (count >= 3) {
                if (type.includes('low_elbow')) {
                    patterns.push('focus on keeping your hitting-side elbow up throughout the motion (right elbow for right-handed players, left for left-handed players)');
                } else if (type.includes('low_toss')) {
                    patterns.push('remember to toss the ball higher');
                } else if (type.includes('rotation')) {
                    patterns.push('work on your shoulder rotation');
                }
            }
        }

        return patterns;
    }

    /**
     * Get all errors in current serve
     */
    getCurrentServeErrors(): ServeError[] {
        return this.currentServeErrors;
    }

    /**
     * Reset for new serve
     */
    reset(): void {
        this.currentServeErrors = [];
        this.phaseErrors = {};
    }

    /**
     * Get recent serves
     */
    getRecentServes(count: number = 5): ServeAttempt[] {
        return this.allServeAttempts.slice(-count);
    }
}

/**
 * Tennis Serve Error Detection Engine
 * Analyzes pose landmarks to detect common serving errors
 */
export type CoachProfileId = 'fundamentals' | 'competitive' | 'elite_reference';

export interface CoachingAnalysisOptions {
    detectionConfidence?: number;
    handedness?: 'right' | 'left';
    analysisMode?: 'shadow' | 'equipment';
    contactContext?: {
        ballToRacketDistance?: number;
        ballToWristDistance?: number;
        ballAheadOfWrist?: number;
        ballVerticalOffsetFromWrist?: number;
    };
}

export interface PhaseMetricSnapshot {
    shoulderWidth: number;
    elbowOffset: number;
    wristRelativeY: number;
    shoulderRotation: number;
    wristMinusElbowX: number;
    wristMinusShoulderX: number;
    kneeBend: number;
}

export interface ReferencePhaseTargets {
    preparation?: Partial<PhaseMetricSnapshot>;
    ball_toss?: Partial<PhaseMetricSnapshot>;
    loading?: Partial<PhaseMetricSnapshot>;
    contact?: Partial<PhaseMetricSnapshot>;
    finish?: Partial<PhaseMetricSnapshot>;
}

export interface PhaseMetricComparison {
    stage: string;
    metric: string;
    userValue: number;
    referenceValue: number;
    unit: 'percent' | 'degrees';
}

interface CoachProfile {
    id: CoachProfileId;
    label: string;
    toleranceScale: number;
    sensitivityThreshold: number;
    minConfidence: number;
}

export class TennisServeCoach {
    private static readonly PROFILES: Record<CoachProfileId, CoachProfile> = {
        fundamentals: {
            id: 'fundamentals',
            label: 'Fundamentals',
            toleranceScale: 1.25,
            sensitivityThreshold: 0.62,
            minConfidence: 0.45,
        },
        competitive: {
            id: 'competitive',
            label: 'Competitive',
            toleranceScale: 1.0,
            sensitivityThreshold: 0.5,
            minConfidence: 0.42,
        },
        elite_reference: {
            id: 'elite_reference',
            label: 'Elite Reference',
            toleranceScale: 0.75,
            sensitivityThreshold: 0.4,
            minConfidence: 0.38,
        },
    };

    private currentProfileId: CoachProfileId;
    private referenceTargets: ReferencePhaseTargets | null = null;
    private referenceLabel: string | null = null;

    constructor(initialProfile: CoachProfileId = 'competitive') {
        this.currentProfileId = initialProfile;
    }

    setProfile(profileId: CoachProfileId): void {
        this.currentProfileId = profileId;
    }

    getProfile(): CoachProfileId {
        return this.currentProfileId;
    }

    getProfileLabel(): string {
        return TennisServeCoach.PROFILES[this.currentProfileId].label;
    }

    setReferenceTargets(targets: ReferencePhaseTargets, label: string = 'Uploaded Pro Reference'): void {
        this.referenceTargets = targets;
        this.referenceLabel = label;
    }

    clearReferenceTargets(): void {
        this.referenceTargets = null;
        this.referenceLabel = null;
    }

    hasReferenceTargets(): boolean {
        return this.referenceTargets !== null;
    }

    getReferenceLabel(): string | null {
        return this.referenceLabel;
    }

    getPhaseMetricComparisons(landmarks: any[], stage: keyof ReferencePhaseTargets): PhaseMetricComparison[] {
        const snapshot = TennisServeCoach.extractPhaseMetricSnapshot(landmarks);
        if (!snapshot) return [];
        const reference = this.referenceTargets?.[stage];
        const referenceShoulderWidth = reference?.shoulderWidth;
        if (typeof referenceShoulderWidth !== 'number' || referenceShoulderWidth <= 1e-5) return [];

        const metricsByStage: Record<keyof ReferencePhaseTargets, Array<{
            key: keyof PhaseMetricSnapshot;
            label: string;
            fallback: number;
            unit: PhaseMetricComparison['unit'];
        }>> = {
            preparation: [
                { key: 'elbowOffset', label: 'Elbow height', fallback: 0, unit: 'percent' },
            ],
            ball_toss: [
                { key: 'wristRelativeY', label: 'Toss-arm height', fallback: -0.1, unit: 'percent' },
            ],
            loading: [
                { key: 'elbowOffset', label: 'Elbow height', fallback: 0, unit: 'percent' },
                { key: 'wristRelativeY', label: 'Hitting-wrist height', fallback: 0.05, unit: 'percent' },
                { key: 'kneeBend', label: 'Knee bend', fallback: 0.8, unit: 'percent' },
            ],
            contact: [
                { key: 'elbowOffset', label: 'Elbow height', fallback: 0.1, unit: 'percent' },
                { key: 'wristRelativeY', label: 'Contact reach', fallback: -0.12, unit: 'percent' },
                { key: 'wristMinusElbowX', label: 'Arm extension', fallback: 0.05, unit: 'percent' },
            ],
            finish: [
                { key: 'wristMinusShoulderX', label: 'Follow-through position', fallback: -0.05, unit: 'percent' },
            ],
        };

        const kneeLandmarksVisible = [24, 26, 28].every(
            (index) => (landmarks[index]?.visibility ?? 0) >= 0.3
        );

        return metricsByStage[stage]
            .filter(({ key }) => key !== 'kneeBend' || kneeLandmarksVisible)
            .flatMap(({ key, label, unit }) => {
                const referenceValue = reference[key];
                if (typeof referenceValue !== 'number' || !isFinite(referenceValue)) return [];

                const isBodyRatio = key !== 'kneeBend' && key !== 'shoulderRotation';
                return [{
                    stage,
                    metric: label,
                    userValue: isBodyRatio ? snapshot[key] / snapshot.shoulderWidth : snapshot[key],
                    referenceValue: isBodyRatio ? referenceValue / referenceShoulderWidth : referenceValue,
                    unit,
                }];
            });
    }

    static getAvailableProfiles(): Array<{ id: CoachProfileId; label: string }> {
        return Object.values(TennisServeCoach.PROFILES).map((profile) => ({
            id: profile.id,
            label: profile.label,
        }));
    }

    /**
     * Calculate angle between three points in radians
     */
    private calculateAngle(p1: any, p2: any, p3: any): number {
        const dx1 = p1.x - p2.x;
        const dy1 = p1.y - p2.y;
        const dx2 = p3.x - p2.x;
        const dy2 = p3.y - p2.y;

        const dot = dx1 * dx2 + dy1 * dy2;
        const mag1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const mag2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        return Math.acos(dot / (mag1 * mag2 + 1e-10)) * (180 / Math.PI);
    }

    /**
     * Get horizontal shoulder rotation angle (shoulder coil)
     */
    private getShoulderRotation(landmarks: any[], hittingShoulderIndex: number, nonHittingShoulderIndex: number): number {
        const shoulderLine = landmarks[hittingShoulderIndex].x - landmarks[nonHittingShoulderIndex].x;
        return Math.abs(shoulderLine * 90); // Simplified rotation metric
    }

    /**
     * Knee bend ratio from hip-knee-ankle angle. 1.0 = straight leg, 0 = fully bent.
     * Returns null when landmarks are missing/unreliable so callers can skip the check
     * instead of treating an occluded leg as "straight" (a false-positive fault).
     */
    private getKneeBend(hip: any, knee: any, ankle: any): number | null {
        const keyVisible = (landmark: any) => (landmark?.visibility ?? 0) >= 0.3;
        if (!keyVisible(hip) || !keyVisible(knee) || !keyVisible(ankle)) return null;

        const v1 = { x: knee.x - hip.x, y: knee.y - hip.y };
        const v2 = { x: ankle.x - knee.x, y: ankle.y - knee.y };
        const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
        const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);
        if (mag1 < 1e-6 || mag2 < 1e-6) return null;

        const cos = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
        return 1 - (angle / Math.PI);
    }

    /**
     * Average knee bend across both legs (uses whichever legs are visible).
     */
    private getAverageKneeBend(landmarks: any[]): number | null {
        const left = this.getKneeBend(landmarks[23], landmarks[25], landmarks[27]);
        const right = this.getKneeBend(landmarks[24], landmarks[26], landmarks[28]);
        if (left === null && right === null) return null;
        if (left === null) return right;
        if (right === null) return left;
        return (left + right) / 2;
    }

    static extractPhaseMetricSnapshot(landmarks: any[]): PhaseMetricSnapshot | null {
        const shoulder = landmarks[12];
        const elbow = landmarks[14];
        const wrist = landmarks[16];
        const leftShoulder = landmarks[11];

        const keyVisible = (landmark: any) => (landmark?.visibility || 0) > 0.45;
        if (!keyVisible(shoulder) || !keyVisible(elbow) || !keyVisible(wrist) || !keyVisible(leftShoulder)) {
            return null;
        }

        const shoulderWidth = Math.hypot(shoulder.x - leftShoulder.x, shoulder.y - leftShoulder.y);
        if (shoulderWidth < 1e-5) return null;

        const shoulderRotation = Math.abs((shoulder.x - leftShoulder.x) * 90);

        const kneeVisible = (landmark: any) => (landmark?.visibility ?? 0) >= 0.3;
        const rightHip = landmarks[24];
        const rightKnee = landmarks[26];
        const rightAnkle = landmarks[28];
        let kneeBend = 0.82; // Neutral fallback when legs aren't visible in the reference clip.
        if (keyVisible(rightHip) && kneeVisible(rightKnee) && kneeVisible(rightAnkle)) {
            const v1 = { x: rightKnee.x - rightHip.x, y: rightKnee.y - rightHip.y };
            const v2 = { x: rightAnkle.x - rightKnee.x, y: rightAnkle.y - rightKnee.y };
            const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
            const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);
            if (mag1 > 1e-6 && mag2 > 1e-6) {
                const cos = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
                const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
                kneeBend = 1 - (angle / Math.PI);
            }
        }

        return {
            shoulderWidth,
            elbowOffset: elbow.y - shoulder.y,
            wristRelativeY: wrist.y - shoulder.y,
            shoulderRotation,
            wristMinusElbowX: wrist.x - elbow.x,
            wristMinusShoulderX: wrist.x - shoulder.x,
            kneeBend,
        };
    }

    private getReferenceValue(
        phase: keyof ReferencePhaseTargets,
        metric: keyof PhaseMetricSnapshot,
        fallback: number
    ): number {
        const phaseTargets = this.referenceTargets?.[phase];
        const refValue = phaseTargets?.[metric];
        if (typeof refValue !== 'number' || !isFinite(refValue)) {
            return fallback;
        }

        // Blend ref style with foundational baseline to prevent overfitting to one clip.
        return (refValue * 0.72) + (fallback * 0.28);
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    private getLandmarkReliability(landmarks: any[]): number {
        const ids = [11, 12, 13, 14, 15, 16];
        const visibilities = ids
            .map((id) => landmarks[id]?.visibility)
            .filter((v) => typeof v === 'number');

        if (visibilities.length === 0) {
            return 0.35;
        }

        const avg = visibilities.reduce((sum: number, v: number) => sum + v, 0) / visibilities.length;
        return this.clamp01(avg);
    }

    private calculateImpactScore(
        deviation: number,
        tolerance: number,
        reliability: number,
        externalConfidence: number
    ): number {
        const normalizedDeviation = deviation / Math.max(tolerance, 1e-5);
        const deviationScore = this.clamp01(normalizedDeviation / 2.2);
        const confidenceScore = this.clamp01((reliability * 0.7) + (externalConfidence * 0.3));
        return this.clamp01(deviationScore * confidenceScore);
    }

    private buildError(
        phase: string,
        type: string,
        description: string,
        correction: string,
        basePriority: number,
        impactScore: number
    ): ServeError {
        const scaledPriority = Math.max(1, Math.round(basePriority * (1 + impactScore * 0.8)));
        let severity: ServeError['severity'] = 'minor';

        if (impactScore >= 0.78) {
            severity = 'critical';
        } else if (impactScore >= 0.52) {
            severity = 'important';
        }

        return {
            type,
            severity,
            phase,
            description,
            correction,
            priority: scaledPriority,
        };
    }

    /**
     * Analyze pose and detect errors at each phase
     */
    analyzePhase(landmarks: any[], currentPhase: string, options: CoachingAnalysisOptions = {}): ServeError[] {
        const errors: ServeError[] = [];
        const profile = TennisServeCoach.PROFILES[this.currentProfileId];
        const handedness = options.handedness ?? 'right';
        const hittingArm = handedness === 'right' ? 'right' : 'left';
        const nonHittingArm = handedness === 'right' ? 'left' : 'right';
        const hittingArmCap = handedness === 'right' ? 'Right' : 'Left';
        const nonHittingArmCap = handedness === 'right' ? 'Left' : 'Right';
        const analysisMode = options.analysisMode ?? 'shadow';

        const hittingShoulderIndex = handedness === 'right' ? 12 : 11;
        const hittingElbowIndex = handedness === 'right' ? 14 : 13;
        const hittingWristIndex = handedness === 'right' ? 16 : 15;
        const nonHittingShoulderIndex = handedness === 'right' ? 11 : 12;
        const nonHittingWristIndex = handedness === 'right' ? 15 : 16;

        const shoulder = landmarks[hittingShoulderIndex];
        const elbow = landmarks[hittingElbowIndex];
        const wrist = landmarks[hittingWristIndex];
        const nonHittingShoulder = landmarks[nonHittingShoulderIndex];
        const nonHittingWrist = landmarks[nonHittingWristIndex];

        const keyVisible = (landmark: any) => (landmark?.visibility || 0) > 0.55;
        if (!keyVisible(shoulder) || !keyVisible(elbow) || !keyVisible(wrist)) {
            return [];
        }

        const landmarkReliability = this.getLandmarkReliability(landmarks);
        const externalConfidence = this.clamp01(options.detectionConfidence ?? 0.8);
        const confidence = this.clamp01((landmarkReliability * 0.75) + (externalConfidence * 0.25));
        if (confidence < profile.minConfidence) {
            return [];
        }

        const sensitivityThreshold = profile.sensitivityThreshold;
        const pushIfSignificant = (
            phase: string,
            type: string,
            description: string,
            correction: string,
            basePriority: number,
            deviation: number,
            baseTolerance: number
        ) => {
            const adjustedTolerance = Math.max(0.01, baseTolerance * profile.toleranceScale);
            const impact = this.calculateImpactScore(deviation, adjustedTolerance, landmarkReliability, externalConfidence);

            if (impact >= sensitivityThreshold) {
                errors.push(this.buildError(phase, type, description, correction, basePriority, impact));
            }
        };

        switch (currentPhase) {
            case 'preparation':
                const prepElbowTarget = this.getReferenceValue('preparation', 'elbowOffset', 0);
                const relaxedPrepWindow = wrist.y <= shoulder.y + 0.08;
                if (relaxedPrepWindow && elbow.y > shoulder.y) {
                    const deviation = (elbow.y - shoulder.y) - prepElbowTarget;
                    pushIfSignificant(
                        'preparation',
                        'low_elbow_prep',
                        `${hittingArmCap} elbow is dropping. Keep it up and relaxed.`,
                        `Raise your ${hittingArm} elbow to shoulder height.`,
                        8,
                        deviation,
                        0.05
                    );
                }
                break;

            case 'ball_toss':
                const tossWristTarget = this.getReferenceValue('ball_toss', 'wristRelativeY', -0.1);
                if (keyVisible(nonHittingShoulder) && keyVisible(nonHittingWrist) && (nonHittingWrist.y - nonHittingShoulder.y) > tossWristTarget) {
                    const targetY = nonHittingShoulder.y + tossWristTarget;
                    const deviation = nonHittingWrist.y - targetY;
                    pushIfSignificant(
                        'ball_toss',
                        'low_toss',
                        'Toss is too low. Reach up!',
                        `Extend your ${nonHittingArm} arm fully upward (${nonHittingArmCap} arm). Toss should be at or above your head.`,
                        10,
                        deviation,
                        0.04
                    );
                }
                break;

            case 'loading':
                const loadingWristTarget = this.getReferenceValue('loading', 'wristRelativeY', 0.05);
                const loadingElbowTarget = this.getReferenceValue('loading', 'elbowOffset', 0);
                const loadingRotationTarget = this.getReferenceValue('loading', 'shoulderRotation', 25);

                if ((wrist.y - shoulder.y) > loadingWristTarget) {
                    const targetY = shoulder.y + loadingWristTarget;
                    const deviation = wrist.y - targetY;
                    pushIfSignificant(
                        'loading',
                        'low_wrist_loading',
                        `${hittingArmCap} wrist is dropping. Trophy position needs work.`,
                        `Cock your ${hittingArm} wrist back and up. Keep your ${hittingArm} elbow high in trophy position.`,
                        9,
                        deviation,
                        0.04
                    );
                }

                if ((elbow.y - shoulder.y) > loadingElbowTarget) {
                    const deviation = (elbow.y - shoulder.y) - loadingElbowTarget;
                    pushIfSignificant(
                        'loading',
                        'low_elbow_loading',
                        `${hittingArmCap} elbow has dropped below shoulder level!`,
                        `Raise your ${hittingArm} elbow to form trophy position. Keep it slightly above shoulder level.`,
                        10,
                        deviation,
                        0.045
                    );
                }

                const rotation = this.getShoulderRotation(landmarks, hittingShoulderIndex, nonHittingShoulderIndex);
                if (rotation < loadingRotationTarget) {
                    const deviation = loadingRotationTarget - rotation;
                    pushIfSignificant(
                        'loading',
                        'insufficient_rotation',
                        'Not enough shoulder coil. Turn your shoulders away from the net before you drive forward.',
                        'Coil your shoulders 40-60 degrees like winding a spring — you should feel your back to the net before you uncoil into the ball.',
                        11,
                        deviation,
                        7
                    );
                }

                const kneeBendTarget = this.getReferenceValue('loading', 'kneeBend', 0.80);
                const kneeBend = this.getAverageKneeBend(landmarks);
                if (kneeBend !== null && kneeBend > kneeBendTarget) {
                    const deviation = kneeBend - kneeBendTarget;
                    pushIfSignificant(
                        'loading',
                        'insufficient_knee_bend',
                        'Legs are too straight in the loading phase.',
                        'Bend your knees more and load into your legs before you drive up into the ball.',
                        11,
                        deviation,
                        0.09
                    );
                }
                break;

            case 'contact':
                const contactExtensionTarget = this.getReferenceValue('contact', 'wristMinusElbowX', 0.05);
                const contactElbowTarget = this.getReferenceValue('contact', 'elbowOffset', 0.1);
                const contactReachTarget = this.getReferenceValue('contact', 'wristRelativeY', -0.12);
                const elbowAngle = this.calculateAngle(shoulder, elbow, wrist);

                if (elbowAngle < 145) {
                    pushIfSignificant(
                        'contact',
                        'incomplete_extension',
                        `${hittingArmCap} elbow is still too bent at contact.`,
                        `Reach up through contact: let your ${hittingArm} elbow extend toward the ball.`,
                        8,
                        145 - elbowAngle,
                        18
                    );
                }

                if ((wrist.y - shoulder.y) > contactReachTarget) {
                    const targetY = shoulder.y + contactReachTarget;
                    pushIfSignificant(
                        'contact',
                        'low_contact_reach',
                        'Your contact point is not high enough above the hitting shoulder.',
                        `Reach upward to contact the ball above your ${hittingArm} shoulder, not beside your head.`,
                        10,
                        wrist.y - targetY,
                        0.045
                    );
                }

                if ((elbow.y - shoulder.y) > contactElbowTarget) {
                    const targetY = shoulder.y + contactElbowTarget;
                    const deviation = elbow.y - targetY;
                    pushIfSignificant(
                        'contact',
                        'elbow_drop_contact',
                        `${hittingArmCap} elbow is dropping at contact!`,
                        `Stay tall through the shot and keep your ${hittingArm} elbow high at contact.`,
                        10,
                        deviation,
                        0.04
                    );
                }

                // Deeper contact-point diagnostics when ball+racket are present.
                if (analysisMode === 'equipment' && options.contactContext) {
                    const {
                        ballToRacketDistance,
                        ballToWristDistance,
                        ballAheadOfWrist,
                        ballVerticalOffsetFromWrist,
                    } = options.contactContext;

                    if (typeof ballToRacketDistance === 'number' && ballToRacketDistance > 0.11) {
                        pushIfSignificant(
                            'contact',
                            'contact_point_miss',
                            'Contact point is too far from the racket head.',
                            'Track the ball earlier and meet it at full extension slightly in front.',
                            10,
                            ballToRacketDistance - 0.11,
                            0.03
                        );
                    }

                    if (typeof ballAheadOfWrist === 'number' && ballAheadOfWrist < -0.015) {
                        pushIfSignificant(
                            'contact',
                            'late_contact_point',
                            `Ball is too far behind your ${hittingArm} hand at contact.`,
                            `Contact the ball earlier, slightly in front of your ${hittingArm} shoulder.`,
                            9,
                            Math.abs(ballAheadOfWrist + 0.015),
                            0.025
                        );
                    }

                    if (typeof ballVerticalOffsetFromWrist === 'number' && Math.abs(ballVerticalOffsetFromWrist) > 0.07) {
                        pushIfSignificant(
                            'contact',
                            'off_center_contact_height',
                            'Ball height is off your ideal strike window.',
                            'Adjust your toss so contact happens in your comfortable strike zone above shoulder level.',
                            7,
                            Math.abs(ballVerticalOffsetFromWrist) - 0.07,
                            0.025
                        );
                    }

                    if (typeof ballToWristDistance === 'number' && ballToWristDistance > 0.17) {
                        pushIfSignificant(
                            'contact',
                            'contact_window_timing',
                            'Ball is drifting away from your contact window.',
                            'Start your upward swing a touch earlier to hit in your ideal contact window.',
                            8,
                            ballToWristDistance - 0.17,
                            0.03
                        );
                    }
                }
                break;

            case 'finish':
                const finishTarget = this.getReferenceValue('finish', 'wristMinusShoulderX', -0.05);
                if ((wrist.x - shoulder.x) > finishTarget) {
                    const targetX = shoulder.x + finishTarget;
                    const deviation = wrist.x - targetX;
                    pushIfSignificant(
                        'finish',
                        'no_followthrough',
                        'Limited follow-through. Let it flow naturally.',
                        'Follow through across your body. Racket should finish on the left side (for righties).',
                        5,
                        deviation,
                        0.06
                    );
                }
                break;
        }

        return errors;
    }

    /**
     * Select the most important error to communicate
     * Prioritizes based on severity and phase
     */
    selectPrimaryError(errors: ServeError[]): ServeError | null {
        if (errors.length === 0) return null;
        if (errors.length === 1) return errors[0];

        // Sort by priority (higher first), then by severity
        const severityScore = { critical: 3, important: 2, minor: 1 };
        return errors.sort((a, b) => {
            const scoreA = a.priority + severityScore[a.severity];
            const scoreB = b.priority + severityScore[b.severity];
            return scoreB - scoreA;
        })[0];
    }

    /**
     * Generate natural, patient coaching feedback
     */
    generateFeedback(analysis: {
        phase: string;
        errors: ServeError[];
        primaryError: ServeError | null;
    }): string {
        const { phase, errors, primaryError } = analysis;

        if (!primaryError) {
            // Positive feedback for good phases
            const phaseMessages: Record<string, string> = {
                preparation: "Good ready position. Now let's toss it up.",
                ball_toss: 'Nice toss. Now load up.',
                loading: 'Good trophy position. You ready?',
                contact: 'Solid contact!',
                finish: 'Nice swing!'
            };
            return phaseMessages[phase] || "You're doing well. Keep it up!";
        }

        // Constructive feedback on the primary error
        return primaryError.correction;
    }

    /**
     * Check if error patterns suggest systemic issues
     */
    analyzePattern(recentErrors: ServeError[]): string[] {
        const patterns: string[] = [];
        const errorCounts: Record<string, number> = {};

        for (const error of recentErrors) {
            errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
        }

        // Identify patterns
        if ((errorCounts['low_elbow_loading'] || 0) > 2) {
            patterns.push(
                'I notice your hitting-side elbow keeps dropping in the loading phase. This is your main area to work on.'
            );
        }
        if ((errorCounts['low_toss'] || 0) > 1) {
            patterns.push('Focus on tossing the ball higher and more consistently.');
        }
        if ((errorCounts['insufficient_rotation'] || 0) > 2) {
            patterns.push(
                'You need more shoulder coil. Really turn your back to the net before you uncoil into the ball.'
            );
        }
        if ((errorCounts['insufficient_knee_bend'] || 0) > 2) {
            patterns.push(
                'Your legs are staying too straight during loading. Bend your knees more to load into the court.'
            );
        }
        return patterns;
    }
}

/**
 * Phase Detector for Tennis Serve
 * Uses pose sequence to identify which phase of serve the user is in
 * Phases: preparation -> ball_toss -> trophy_position -> loading -> contact -> follow_through
 */
export class ServePhaseDetector {
    private poseHistory: any[] = [];
    private currentPhase: string = 'preparation';
    private phaseStartTime: number = 0;
    private phaseSequence: string[] = []; // Track detected phases for debugging
    private readonly PHASE_DURATION_MIN = 200; // Min ms per phase to confirm transition
    private readonly PHASE_SEQUENCE_ORDER = [
        'preparation',
        'ball_toss',
        'trophy_position',
        'loading',
        'contact',
        'follow_through'
    ];

    /**
     * Get the detected phase sequence (for debugging)
     */
    getPhaseSequence(): string[] {
        return [...this.phaseSequence];
    }

    /**
     * Add a new pose to the history and detect current phase
     */
    updatePhase(landmarks: any[]): string {
        this.poseHistory.push(landmarks);
        if (this.poseHistory.length > 60) {
            this.poseHistory.shift();
        }

        const detectedPhase = this.detectPhase();
        const now = Date.now();

        // Only transition to new phase if enough time has passed
        if (detectedPhase !== this.currentPhase) {
            if (now - this.phaseStartTime > this.PHASE_DURATION_MIN) {
                if (this.phaseSequence.length === 0 || detectedPhase !== this.phaseSequence[this.phaseSequence.length - 1]) {
                    this.phaseSequence.push(detectedPhase);
                }
                this.currentPhase = detectedPhase;
                this.phaseStartTime = now;
            }
        } else if (this.phaseStartTime === 0) {
            this.phaseStartTime = now;
        }

        return this.currentPhase;
    }

    /**
     * Detect which phase of the serve we're in based on arm positions
     * Returns the phase that best matches current pose
     */
    private detectPhase(): string {
        if (this.poseHistory.length === 0) return 'preparation';

        const latest = this.poseHistory[this.poseHistory.length - 1];
        const RIGHT_SHOULDER = 12;
        const RIGHT_ELBOW = 14;
        const RIGHT_WRIST = 16;
        const LEFT_SHOULDER = 11;
        const LEFT_WRIST = 15;
        const LEFT_ELBOW = 13;
        const LEFT_HIP = 23;
        const RIGHT_HIP = 24;

        const rShoulder = latest[RIGHT_SHOULDER];
        const rElbow = latest[RIGHT_ELBOW];
        const rWrist = latest[RIGHT_WRIST];
        const lShoulder = latest[LEFT_SHOULDER];
        const lWrist = latest[LEFT_WRIST];
        const lElbow = latest[LEFT_ELBOW];

        if (!rShoulder || !rElbow || !rWrist) return 'preparation';

        // Score each phase match
        const phases: Record<string, number> = {
            preparation: 0,
            ball_toss: 0,
            trophy_position: 0,
            loading: 0,
            contact: 0,
            follow_through: 0
        };

        // 1. Preparation: arms at rest, hands near hips/waist (baseline position)
        const armsResting =
            rElbow.y > rShoulder.y - 0.15 &&
            rWrist.y > rShoulder.y - 0.05 &&
            lWrist.y > lShoulder.y - 0.05;
        if (armsResting) {
            phases.preparation = 10;
        }

        // 2. Ball Toss: left arm is extended upward, hand above head/shoulder
        if (lWrist && lWrist.y < lShoulder.y - 0.2) {
            phases.ball_toss = 9;
        }

        // 3. Trophy Position: right arm in L-shape, elbow up and back, wrist at ear level
        // This is the pre-backswing loaded position
        if (
            rElbow.y < rShoulder.y - 0.1 &&
            rWrist.y > rShoulder.y - 0.05 &&
            rWrist.y < rShoulder.y + 0.2 &&
            rWrist.x > rShoulder.x - 0.15
        ) {
            phases.trophy_position = 8;
        }

        // 4. Loading: full backswing, arm extended up but not fully stretched
        // Wrist should be above elbow, creating the "cocked" position
        if (
            rWrist.y < rElbow.y - 0.08 &&
            rElbow.y < rShoulder.y - 0.15 &&
            rWrist.x > rShoulder.x - 0.1
        ) {
            phases.loading = 7;
        }

        // 5. Contact: arm fully extended upward, wrist well above head
        // This is the peak of the serve, arm stretched to hit the ball
        if (
            rWrist.y < rShoulder.y - 0.35 &&
            rWrist.y < rElbow.y - 0.15
        ) {
            phases.contact = 6;
        }

        // 6. Follow Through: arm coming down and across body after contact
        // Wrist crossing toward opposite hip, elbow bent
        if (
            rWrist.x < rShoulder.x - 0.2 &&
            rWrist.y > rShoulder.y - 0.1
        ) {
            phases.follow_through = 5;
        }

        // Get highest scoring phase
        let bestPhase = 'preparation';
        let bestScore = 0;
        for (const [phase, score] of Object.entries(phases)) {
            if (score > bestScore) {
                bestScore = score;
                bestPhase = phase;
            }
        }

        return bestPhase;
    }

    /**
     * Get progress within current phase (0-1)
     * Based on time in phase
     */
    getPhaseProgress(): number {
        if (this.phaseStartTime === 0) return 0;
        const elapsed = Date.now() - this.phaseStartTime;

        // Different phases have different expected durations
        const phaseDurations: Record<string, number> = {
            preparation: 2000,
            ball_toss: 800,
            trophy_position: 500,
            loading: 600,
            contact: 400,
            follow_through: 800
        };

        const maxDuration = phaseDurations[this.currentPhase] || 1500;
        return Math.min(1, elapsed / maxDuration);
    }

    /**
     * Reset for new serve attempt
     */
    reset(): void {
        this.poseHistory = [];
        this.currentPhase = 'preparation';
        this.phaseStartTime = Date.now();
        this.phaseSequence = [];
    }
}

/**
 * Smart Feedback Scheduler
 * Manages when to deliver feedback to avoid overwhelming user
 */
export class FeedbackScheduler {
    private lastFeedbackTime: number = 0;
    private lastPhase: string = '';
    private feedbackCooldown: Record<string, number> = {};
    private readonly PHASE_FEEDBACK_DELAY = 300; // ms - wait for phase stabilization
    private readonly ERROR_FEEDBACK_COOLDOWN = 2000; // ms - min between feedback on same error

    /**
     * Should we deliver feedback now?
     */
    shouldFeedback(phase: string, error: ServeError | null): boolean {
        const now = Date.now();

        // Changed phase?
        if (phase !== this.lastPhase) {
            this.lastPhase = phase;
            this.lastFeedbackTime = now;
            return false; // Wait for phase to stabilize
        }

        // Too soon after last feedback?
        if (now - this.lastFeedbackTime < this.PHASE_FEEDBACK_DELAY) {
            return false;
        }

        if (!error) return false;

        // Already gave feedback on this error type recently?
        const lastFeedback = this.feedbackCooldown[error.type] || 0;
        if (now - lastFeedback < this.ERROR_FEEDBACK_COOLDOWN) {
            return false;
        }

        // OK to give feedback
        this.lastFeedbackTime = now;
        this.feedbackCooldown[error.type] = now;
        return true;
    }

    /**
     * Reset for new serve
     */
    reset(): void {
        this.lastFeedbackTime = 0;
        this.lastPhase = '';
    }
}
