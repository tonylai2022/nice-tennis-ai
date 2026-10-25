import { TennisMotionAnalysisService } from './motionAnalysis/TennisMotionAnalysis';
import type { PoseResult, AlignmentIssue, AnalysisOptions } from './motionAnalysis/BaseMotionAnalysis';
import type { ISportAnalyzer } from './motionAnalysis/ISportAnalyzer';

export type { ISportAnalyzer };

// Re-export types
export type { PoseResult, AlignmentIssue, AnalysisOptions };

// Re-export for backward compatibility
export type { SubtleMovementResult, SubtleMovementSeries, SubtleMovementMetrics, FrameComparisonResult } from './motionAnalysis/TennisMotionAnalysis';

type Sport = 'tennis';

export class MotionAnalysisService {
    private static currentSport: Sport = 'tennis';

    /**
     * Set the active sport for analysis
     */
    static setSport(sport: Sport): void {
        this.currentSport = sport;
        console.log(`[MotionAnalysisService] Sport set to: ${sport}`);
    }

    /**
     * Get the current sport
     */
    static getSport(): Sport {
        return this.currentSport;
    }

    /**
     * Get the appropriate analyzer for the current sport.
     * Return type is ISportAnalyzer — the router depends on the abstraction, not
     * the concrete class (Dependency Inversion Principle).
     */
    private static getAnalyzer(): ISportAnalyzer {
        return TennisMotionAnalysisService;
    }

    /**
     * Initialize the pose detection system
     */
    static async initialize(): Promise<void> {
        const analyzer = this.getAnalyzer();
        return analyzer.initialize();
    }

    /**
     * Reset analysis state
     */
    static async reset(options?: { clearMemoryCache?: boolean }): Promise<void> {
        const analyzer = this.getAnalyzer();
        return analyzer.reset(options);
    }

    /**
     * Warmup the analysis engine
     */
    static async warmup(): Promise<void> {
        await TennisMotionAnalysisService.warmup();
    }

    /**
     * Analyze video and extract pose sequences
     */
    static async analyzeVideo(videoUrl: string, sparseTimestamps?: number[] | null): Promise<PoseResult[]> {
        const analyzer = this.getAnalyzer();
        return analyzer.analyzeVideo(videoUrl, sparseTimestamps);
    }

    /**
     * Compare reference and user performances
     */
    static comparePerformances(refPoses: PoseResult[], userPoses: PoseResult[]): any {
        const analyzer = this.getAnalyzer();
        return analyzer.comparePerformances(refPoses, userPoses);
    }

    /**
     * Phase-anchored comparison for tennis groundstrokes.
     */
    static comparePerformancesByPhase(
        refPoses: PoseResult[],
        userPoses: PoseResult[],
        userPhaseTimestamps: { unitTurn: number; racketDrop: number; contact: number; followThrough: number } | null,
        refPhaseTimestamps: { unitTurn: number; racketDrop: number; contact: number; followThrough: number } | null
    ): { overallScore: number; frameScores: number[]; phaseScores: Record<string, number> } {
        return TennisMotionAnalysisService.comparePerformancesByPhase(refPoses, userPoses, userPhaseTimestamps, refPhaseTimestamps);
    }

    /**
     * Detect forehand phases (tennis only)
     */
    static detectForehandPhases(sequence: PoseResult[]): {
        unitTurnIdx: number; racketDropIdx: number; contactIdx: number; followThroughIdx: number; detectedIsRightHanded: boolean;
    } {
        return TennisMotionAnalysisService.detectForehandPhases(sequence);
    }

    /**
     * Detect backhand phases (tennis only)
     */
    static detectBackhandPhases(sequence: PoseResult[]): {
        unitTurnIdx: number; racketDropIdx: number; contactIdx: number; followThroughIdx: number; detectedIsRightHanded: boolean;
    } {
        return TennisMotionAnalysisService.detectBackhandPhases(sequence);
    }

    /**
     * Real tennis coach angle-based scoring rubric (tennis only).
     * Scores each phase on joint angles a coach would check, invariant to
     * camera distance, player height, and screen position.
     */
    static computeCoachRubricScores(
        sequence: PoseResult[],
        phaseTimestamps: { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
        isRightHanded: boolean
    ): { unit_turn: number; racket_drop: number; contact: number; follow_through: number; overall: number } {
        return TennisMotionAnalysisService.computeCoachRubricScores(sequence, phaseTimestamps, isRightHanded);
    }

    /**
     * Generate error images with visual annotations.
     */
    static async generateErrorImages(
        videoUrl: string,
        issues: AlignmentIssue[],
        isReference: boolean,
        poses: PoseResult[],
        strokeType: string
    ): Promise<AlignmentIssue[]> {
        return TennisMotionAnalysisService.generateErrorImages(videoUrl, issues, isReference, poses, strokeType as any);
    }

    /**
     * Detect serve issues
     */
    static async detectServeIssues(
        userPoses: PoseResult[],
        refPoses?: PoseResult[],
        refVideoUrl?: string,
        phaseTimestamps?: Record<string, number>
    ): Promise<AlignmentIssue[]> {
        return TennisMotionAnalysisService.detectServeIssues(userPoses, refPoses, refVideoUrl, phaseTimestamps) as any;
    }

    /**
     * Detect forehand issues
     */
    static async detectForehandIssues(
        userPoses: PoseResult[],
        refPoses?: PoseResult[],
        refVideoUrl?: string,
        phaseTimestamps?: Record<string, number>
    ): Promise<AlignmentIssue[]> {
        return TennisMotionAnalysisService.detectForehandIssues(userPoses, refPoses, refVideoUrl, phaseTimestamps) as any;
    }

    /**
     * Detect backhand issues
     */
    static async detectBackhandIssues(
        userPoses: PoseResult[],
        refPoses?: PoseResult[],
        refVideoUrl?: string,
        phaseTimestamps?: Record<string, number>
    ): Promise<AlignmentIssue[]> {
        return TennisMotionAnalysisService.detectBackhandIssues(userPoses, refPoses, refVideoUrl, phaseTimestamps) as any;
    }

    /**
     * Detect volley issues
     */
    static async detectVolleyIssues(
        userPoses: PoseResult[],
        refPoses?: PoseResult[],
        refVideoUrl?: string
    ): Promise<AlignmentIssue[]> {
        return TennisMotionAnalysisService.detectVolleyIssues(userPoses, refPoses, refVideoUrl) as any;
    }

    /**
     * Detect overhead issues (Tennis only)
     */
    static async detectOverheadIssues(
        userPoses: PoseResult[],
        refPoses?: PoseResult[],
        refVideoUrl?: string
    ): Promise<AlignmentIssue[]> {
        return TennisMotionAnalysisService.detectOverheadIssues(userPoses, refPoses, refVideoUrl) as any;
    }

    /**
     * Compute subtle movement metrics
     */
    static computeSubtleMovement(
        refPoses: PoseResult[],
        userPoses: PoseResult[],
        strokeType: string
    ): any {
        const analyzer = this.getAnalyzer();
        return analyzer.computeSubtleMovement(refPoses, userPoses, strokeType as any);
    }

    /**
     * Capture raw frames at specific timestamps
     */
    static async captureRawFramesAtTimes(
        videoUrl: string,
        timestamps: number[]
    ): Promise<{ [key: number]: string }> {
        const analyzer = this.getAnalyzer();
        return analyzer.captureRawFramesAtTimes(videoUrl, timestamps);
    }

    /**
     * Set pose backend (YOLO or MediaPipe)
     */
    static setPoseBackend(backend: 'yolo' | 'mediapipe'): void {
        TennisMotionAnalysisService.setPoseBackend(backend);
    }

    /**
     * Get current pose backend
     */
    static getPoseBackend(): 'yolo' | 'mediapipe' {
        return TennisMotionAnalysisService.getPoseBackend();
    }

    /**
     * Get last YOLO initialization error
     */
    static getLastYoloInitError(): string | null {
        return TennisMotionAnalysisService.getLastYoloInitError();
    }

    /**
     * Set analysis options
     */
    static setAnalysisOptions(options: Partial<AnalysisOptions>): void {
        TennisMotionAnalysisService.setAnalysisOptions(options);
    }

    /**
     * Get analysis options
     */
    static getAnalysisOptions(): Required<AnalysisOptions> {
        return TennisMotionAnalysisService.getAnalysisOptions();
    }
}

// Default export for convenience
export default MotionAnalysisService;
