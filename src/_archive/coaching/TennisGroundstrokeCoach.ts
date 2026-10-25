/**
 * Intelligent Tennis Groundstroke Coaching System
 * 
 * Provides pro-level feedback by:
 * 1. Tracking groundstroke phases (preparation → unit_turn → loading → contact → follow_through)
 * 2. Detecting multiple errors per phase
 * 3. Prioritizing feedback on the most critical error
 * 4. Using patient, natural coaching language
 * 5. Waiting for complete groundstroke before coaching feedback
 */

export interface GroundstrokeError {
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
    detectedErrors: GroundstrokeError[];
    primaryError: GroundstrokeError | null;
    feedback: string;
}

export interface GroundstrokeAttempt {
    startTime: number;
    endTime: number;
    allErrors: GroundstrokeError[];
    criticalErrors: GroundstrokeError[];
    phaseErrors: Record<string, GroundstrokeError[]>;
    overallFeedback: string;
}

/**
 * Groundstroke State Tracker
 * Detects when a groundstroke starts, completes, and provides end-of-groundstroke feedback
 */
export class GroundstrokeStateTracker {
    private state: 'idle' | 'in_groundstroke' = 'idle';
    private groundstrokeStartTime: number = 0;
    private lastPhase: string = 'preparation';
    private phaseSequence: string[] = []; // Track phases in order
    private readonly EXPECTED_PHASES = [
        'preparation',
        'unit_turn',
        'drop',
        'loading',
        'contact',
        'follow_through'
    ];
    private readonly GROUNDSTROKE_MIN_DURATION = 1000; // Min 1 second for valid groundstroke
    private readonly GROUNDSTROKE_MAX_DURATION = 5000; // Max 5 seconds
    private phaseStartTime: number = 0;

    /**
     * Update groundstroke state based on current phase
     * A complete groundstroke must progress through all phases: preparation -> unit_turn -> drop -> loading -> contact -> follow_through -> preparation
     */
    updateGroundstrokeState(currentPhase: string): 'idle' | 'groundstroke_started' | 'groundstroke_ended' {
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

        // Groundstroke Start: Detect beginning of groundstroke motion
        // Looking for transition from preparation to something else (usually unit_turn or drop)
        if (this.state === 'idle') {
            if (
                currentPhase !== 'preparation' &&
                (this.phaseSequence.length === 0 || this.phaseSequence[0] === 'preparation')
            ) {
                // User moved away from preparation - groundstroke is starting
                this.state = 'in_groundstroke';
                this.groundstrokeStartTime = now;
                this.phaseSequence = ['preparation', currentPhase];
                return 'groundstroke_started';
            }
        }

        // Groundstroke End: Detect end of groundstroke motion
        if (this.state === 'in_groundstroke') {
            const groundstrokeDuration = now - this.groundstrokeStartTime;

            // Check if we've completed a full groundstroke cycle
            // We need: preparation -> ... -> contact -> follow_through -> back to preparation
            const hasContactPhase = this.phaseSequence.includes('contact');
            const hasFollowThrough = this.phaseSequence.includes('follow_through');
            const backToPreparation =
                currentPhase === 'preparation' &&
                this.phaseSequence.length > 3 &&
                this.phaseSequence[this.phaseSequence.length - 1] !== 'preparation';

            // Valid groundstroke: went through contact AND follow_through and returned to prep, OR timeout
            if (
                (hasContactPhase && hasFollowThrough && backToPreparation && groundstrokeDuration > this.GROUNDSTROKE_MIN_DURATION) ||
                groundstrokeDuration > this.GROUNDSTROKE_MAX_DURATION
            ) {
                this.state = 'idle';
                this.phaseSequence = [];
                this.lastPhase = 'preparation';
                return 'groundstroke_ended';
            }

            // Still in groundstroke, no state change
            return 'idle';
        }

        return 'idle';
    }

    /**
     * Check if currently in a groundstroke
     */
    isInGroundstroke(): boolean {
        return this.state === 'in_groundstroke';
    }

    /**
     * Get the phase sequence so far (for debugging)
     */
    getPhaseSequence(): string[] {
        return [...this.phaseSequence];
    }

    /**
     * Reset for new groundstroke
     */
    reset(): void {
        this.state = 'idle';
        this.groundstrokeStartTime = 0;
        this.phaseSequence = [];
        this.lastPhase = 'preparation';
        this.phaseStartTime = 0;
    }
}

/**
 * Groundstroke Analyzer
 * Accumulates errors across entire groundstroke and generates comprehensive feedback
 */
export class GroundstrokeAnalyzer {
    private currentGroundstrokeErrors: GroundstrokeError[] = [];
    private phaseErrors: Record<string, GroundstrokeError[]> = {};
    private allGroundstrokeAttempts: GroundstrokeAttempt[] = [];

    /**
     * Add error from current frame
     */
    addError(error: GroundstrokeError): void {
        this.currentGroundstrokeErrors.push(error);

        // Group by phase
        if (!this.phaseErrors[error.phase]) {
            this.phaseErrors[error.phase] = [];
        }
        this.phaseErrors[error.phase].push(error);
    }

    /**
     * Finalize groundstroke and generate feedback
     */
    finalizeGroundstroke(): GroundstrokeAttempt | null {
        if (this.currentGroundstrokeErrors.length === 0) {
            // Perfect groundstroke!
            const groundstroke: GroundstrokeAttempt = {
                startTime: Date.now(),
                endTime: Date.now(),
                allErrors: [],
                criticalErrors: [],
                phaseErrors: {},
                overallFeedback: 'Excellent groundstroke! That was smooth and clean. Keep it up!'
            };
            this.reset();
            return groundstroke;
        }

        // Categorize errors
        const criticalErrors = this.currentGroundstrokeErrors.filter(
            e => e.severity === 'critical'
        );
        const importantErrors = this.currentGroundstrokeErrors.filter(
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

        const groundstroke: GroundstrokeAttempt = {
            startTime: Date.now(),
            endTime: Date.now(),
            allErrors: this.currentGroundstrokeErrors,
            criticalErrors,
            phaseErrors: this.phaseErrors,
            overallFeedback: feedback
        };
        this.allGroundstrokeAttempts.push(groundstroke);
        this.reset();

        return groundstroke;
    }

    /**
     * Detect error patterns from current groundstroke
     */
    private analyzeErrorPatterns(): string[] {
        const patterns: string[] = [];
        const errorCounts: Record<string, number> = {};

        for (const error of this.currentGroundstrokeErrors) {
            errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
        }

        // If same error type repeated multiple times
        for (const [type, count] of Object.entries(errorCounts)) {
            if (count >= 3) {
                if (type.includes('low_elbow')) {
                    patterns.push('focus on keeping your hitting-side elbow up throughout the motion (right elbow for right-handed players, left for left-handed players)');
                } else if (type.includes('low_turn')) {
                    patterns.push('remember to turn the ball higher');
                } else if (type.includes('rotation')) {
                    patterns.push('work on your shoulder rotation');
                }
            }
        }

        return patterns;
    }

    /**
     * Get all errors in current groundstroke
     */
    getCurrentGroundstrokeErrors(): GroundstrokeError[] {
        return this.currentGroundstrokeErrors;
    }

    /**
     * Reset for new groundstroke
     */
    reset(): void {
        this.currentGroundstrokeErrors = [];
        this.phaseErrors = {};
    }

    /**
     * Get recent groundstrokes
     */
    getRecentGroundstrokes(count: number = 5): GroundstrokeAttempt[] {
        return this.allGroundstrokeAttempts.slice(-count);
    }
}

/**
 * Tennis Groundstroke Error Detection Engine
 * Analyzes pose landmarks to detect common serving errors
 */
export type CoachProfileId = 'fundamentals' | 'competitive' | 'elite_reference';

export interface CoachingAnalysisOptions {
    detectionConfidence?: number;
    handedness?: 'right' | 'left';
}

export interface PhaseMetricSnapshot {
    elbowOffset: number;
    wristRelativeY: number;
    shoulderRotation: number;
    wristMinusElbowX: number;
    wristMinusShoulderX: number;
}

export interface ReferencePhaseTargets {
    preparation?: Partial<PhaseMetricSnapshot>;
    unit_turn?: Partial<PhaseMetricSnapshot>;
    loading?: Partial<PhaseMetricSnapshot>;
    contact?: Partial<PhaseMetricSnapshot>;
    follow_through?: Partial<PhaseMetricSnapshot>;
}

interface CoachProfile {
    id: CoachProfileId;
    label: string;
    toleranceScale: number;
    sensitivityThreshold: number;
    minConfidence: number;
}

export class TennisGroundstrokeCoach {
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
        return TennisGroundstrokeCoach.PROFILES[this.currentProfileId].label;
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

    static getAvailableProfiles(): Array<{ id: CoachProfileId; label: string }> {
        return Object.values(TennisGroundstrokeCoach.PROFILES).map((profile) => ({
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
     * Get horizontal shoulder rotation angle
     */
    private getShoulderRotation(landmarks: any[]): number {
        const LEFT_SHOULDER = 11;
        const RIGHT_SHOULDER = 12;
        const shoulderLine = landmarks[RIGHT_SHOULDER].x - landmarks[LEFT_SHOULDER].x;
        return Math.abs(shoulderLine * 90); // Simplified rotation metric
    }

    static extractPhaseMetricSnapshot(landmarks: any[]): PhaseMetricSnapshot | null {
        const RIGHT_SHOULDER = 12;
        const RIGHT_ELBOW = 14;
        const RIGHT_WRIST = 16;
        const LEFT_SHOULDER = 11;

        const shoulder = landmarks[RIGHT_SHOULDER];
        const elbow = landmarks[RIGHT_ELBOW];
        const wrist = landmarks[RIGHT_WRIST];
        const leftShoulder = landmarks[LEFT_SHOULDER];

        const keyVisible = (landmark: any) => (landmark?.visibility || 0) > 0.45;
        if (!keyVisible(shoulder) || !keyVisible(elbow) || !keyVisible(wrist) || !keyVisible(leftShoulder)) {
            return null;
        }

        const shoulderRotation = Math.abs((shoulder.x - leftShoulder.x) * 90);

        return {
            elbowOffset: elbow.y - shoulder.y,
            wristRelativeY: wrist.y - shoulder.y,
            shoulderRotation,
            wristMinusElbowX: wrist.x - elbow.x,
            wristMinusShoulderX: wrist.x - shoulder.x,
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
    ): GroundstrokeError {
        const scaledPriority = Math.max(1, Math.round(basePriority * (1 + impactScore * 0.8)));
        let severity: GroundstrokeError['severity'] = 'minor';

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
    analyzePhase(landmarks: any[], currentPhase: string, options: CoachingAnalysisOptions = {}): GroundstrokeError[] {
        const errors: GroundstrokeError[] = [];
        const profile = TennisGroundstrokeCoach.PROFILES[this.currentProfileId];
        const handedness = options.handedness ?? 'right';
        const hittingArm = handedness === 'right' ? 'right' : 'left';
        const nonHittingArm = handedness === 'right' ? 'left' : 'right';
        const hittingArmCap = handedness === 'right' ? 'Right' : 'Left';
        const nonHittingArmCap = handedness === 'right' ? 'Left' : 'Right';

        const RIGHT_SHOULDER = 12;
        const RIGHT_ELBOW = 14;
        const RIGHT_WRIST = 16;
        const LEFT_SHOULDER = 11;

        const shoulder = landmarks[RIGHT_SHOULDER];
        const elbow = landmarks[RIGHT_ELBOW];
        const wrist = landmarks[RIGHT_WRIST];
        const leftShoulder = landmarks[LEFT_SHOULDER];

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

            case 'unit_turn':
                const turnWristTarget = this.getReferenceValue('unit_turn', 'wristRelativeY', -0.1);
                if ((wrist.y - shoulder.y) > turnWristTarget) {
                    const targetY = shoulder.y + turnWristTarget;
                    const deviation = wrist.y - targetY;
                    pushIfSignificant(
                        'unit_turn',
                        'low_turn',
                        'Turn is too low. Reach up!',
                        `Extend your ${nonHittingArm} arm fully upward (${nonHittingArmCap} arm) during the turn.`,
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
                        `${hittingArmCap} wrist is dropping. Drop position needs work.`,
                        `Cock your ${hittingArm} wrist back and up. Keep your ${hittingArm} elbow high in the drop position.`,
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
                        `Raise your ${hittingArm} elbow to form the drop position. Keep it slightly above shoulder level.`,
                        10,
                        deviation,
                        0.045
                    );
                }

                const rotation = this.getShoulderRotation(landmarks);
                if (rotation < loadingRotationTarget) {
                    const deviation = loadingRotationTarget - rotation;
                    pushIfSignificant(
                        'loading',
                        'insufficient_rotation',
                        'Not enough shoulder rotation. Open up more.',
                        'Rotate your shoulders 40-60 degrees. You should feel your back to the net.',
                        7,
                        deviation,
                        7
                    );
                }
                break;

            case 'contact':
                const contactExtensionTarget = this.getReferenceValue('contact', 'wristMinusElbowX', 0.05);
                const contactElbowTarget = this.getReferenceValue('contact', 'elbowOffset', 0.1);

                if ((wrist.x - elbow.x) < contactExtensionTarget) {
                    const targetX = elbow.x + contactExtensionTarget;
                    const deviation = targetX - wrist.x;
                    pushIfSignificant(
                        'contact',
                        'incomplete_extension',
                        `${hittingArmCap} arm is not fully extended at contact.`,
                        `Fully extend your ${hittingArm} arm at contact.`,
                        8,
                        deviation,
                        0.04
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
                break;

            case 'follow_through':
                const follow_throughTarget = this.getReferenceValue('follow_through', 'wristMinusShoulderX', -0.05);
                if ((wrist.x - shoulder.x) > follow_throughTarget) {
                    const targetX = shoulder.x + follow_throughTarget;
                    const deviation = wrist.x - targetX;
                    pushIfSignificant(
                        'follow_through',
                        'no_followthrough',
                        'Limited follow-through. Let it flow naturally.',
                        'Follow through across your body. Racket should follow_through on the left side (for righties).',
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
    selectPrimaryError(errors: GroundstrokeError[]): GroundstrokeError | null {
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
        errors: GroundstrokeError[];
        primaryError: GroundstrokeError | null;
    }): string {
        const { phase, errors, primaryError } = analysis;

        if (!primaryError) {
            // Positive feedback for good phases
            const phaseMessages: Record<string, string> = {
                preparation: "Good ready position. Now let's turn it up.",
                unit_turn: 'Nice turn. Now load up.',
                loading: 'Good drop position. You ready?',
                contact: 'Solid contact!',
                follow_through: 'Nice swing!'
            };
            return phaseMessages[phase] || "You're doing well. Keep it up!";
        }

        // Constructive feedback on the primary error
        return primaryError.correction;
    }

    /**
     * Check if error patterns suggest systemic issues
     */
    analyzePattern(recentErrors: GroundstrokeError[]): string[] {
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
        if ((errorCounts['low_turn'] || 0) > 1) {
            patterns.push('Focus on turning the ball higher and more consistently.');
        }
        if ((errorCounts['insufficient_rotation'] || 0) > 2) {
            patterns.push(
                'You need more shoulder rotation. Really coil up before the groundstroke.'
            );
        }

        return patterns;
    }
}

/**
 * Phase Detector for Tennis Groundstroke
 * Uses pose sequence to identify which phase of groundstroke the user is in
 * Phases: preparation -> unit_turn -> drop -> loading -> contact -> follow_through
 */
export class GroundstrokePhaseDetector {
    private poseHistory: any[] = [];
    private currentPhase: string = 'preparation';
    private phaseStartTime: number = 0;
    private phaseSequence: string[] = []; // Track detected phases for debugging
    private readonly PHASE_DURATION_MIN = 200; // Min ms per phase to confirm transition
    private readonly PHASE_SEQUENCE_ORDER = [
        'preparation',
        'unit_turn',
        'drop',
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
     * Detect which phase of the groundstroke we're in based on arm positions
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
            unit_turn: 0,
            drop: 0,
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

        // 2. Ball Turn: left arm is extended upward, hand above head/shoulder
        if (lWrist && lWrist.y < lShoulder.y - 0.2) {
            phases.unit_turn = 9;
        }

        // 3. Drop Position: right arm in L-shape, elbow up and back, wrist at ear level
        // This is the pre-backswing loaded position
        if (
            rElbow.y < rShoulder.y - 0.1 &&
            rWrist.y > rShoulder.y - 0.05 &&
            rWrist.y < rShoulder.y + 0.2 &&
            rWrist.x > rShoulder.x - 0.15
        ) {
            phases.drop = 8;
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
        // This is the peak of the groundstroke, arm stretched to hit the ball
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
            unit_turn: 800,
            drop: 500,
            loading: 600,
            contact: 400,
            follow_through: 800
        };

        const maxDuration = phaseDurations[this.currentPhase] || 1500;
        return Math.min(1, elapsed / maxDuration);
    }

    /**
     * Reset for new groundstroke attempt
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
    shouldFeedback(phase: string, error: GroundstrokeError | null): boolean {
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
     * Reset for new groundstroke
     */
    reset(): void {
        this.lastFeedbackTime = 0;
        this.lastPhase = '';
    }
}
