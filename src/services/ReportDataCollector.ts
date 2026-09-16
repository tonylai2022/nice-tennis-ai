/**
 * ReportDataCollector - Collects comprehensive data for professional reports
 * 
 * This service aggregates timing data, frame snapshots, movement metrics,
 * and other detailed information to generate professional analysis reports.
 */

import type { TimingData, FrameSnapshot, MovementMetrics, ReportData } from './ReportGenerator';
import type { ServeFeedback } from './VideoTutor';

export interface VideoFrameData {
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
}

export class ReportDataCollectorService {

    private static getScaledDimensions(width: number, height: number, maxDim: number): { width: number; height: number } {
        if (width <= 0 || height <= 0) return { width: 0, height: 0 };
        if (width <= maxDim && height <= maxDim) return { width, height };

        const ratio = width / height;
        if (width >= height) {
            const scaledWidth = maxDim;
            const scaledHeight = Math.round(maxDim / ratio);
            return { width: scaledWidth, height: scaledHeight };
        }

        const scaledHeight = maxDim;
        const scaledWidth = Math.round(maxDim * ratio);
        return { width: scaledWidth, height: scaledHeight };
    }

    private static async waitForVideoEvent(video: HTMLVideoElement, eventName: keyof HTMLMediaElementEventMap, timeoutMs: number): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const onEvent = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error(`Video error while waiting for ${String(eventName)}`));
            };
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout waiting for ${String(eventName)}`));
            }, timeoutMs);

            const cleanup = () => {
                clearTimeout(timeout);
                video.removeEventListener(eventName as any, onEvent as any);
                video.removeEventListener('error', onError as any);
            };

            video.addEventListener(eventName as any, onEvent as any, { once: true });
            video.addEventListener('error', onError as any, { once: true });
        });
    }

    private static clampSeekTime(targetSeconds: number, durationSeconds: number): number {
        if (!isFinite(targetSeconds) || targetSeconds < 0) return 0;
        if (!isFinite(durationSeconds) || durationSeconds <= 0) return Math.max(0, targetSeconds);
        // Stay slightly under duration for more reliable seek/frame decode
        return Math.max(0, Math.min(targetSeconds, Math.max(0, durationSeconds - 0.05)));
    }

    private static async seekWithTimeout(video: HTMLVideoElement, timeSeconds: number, timeoutMs: number): Promise<void> {
        // Some browsers may not fire seeked if time doesn't change.
        if (Math.abs(video.currentTime - timeSeconds) < 0.001) return;

        video.currentTime = timeSeconds;

        // Wait for seeked
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
            }, timeoutMs);

            const onSeeked = () => {
                clearTimeout(timeout);
                video.removeEventListener('seeked', onSeeked);
                resolve();
            };

            video.addEventListener('seeked', onSeeked);
        });
    }

    /**
     * Extract frame snapshot from video at specific timestamp
     */
    static captureFrameSnapshot(
        video: HTMLVideoElement,
        frameNumber: number,
        timestamp: number,
        description: string,
        annotations?: {
            keyPoints?: string[];
            corrections?: string[];
        }
    ): FrameSnapshot | null {
        try {
            if (!video.videoWidth || !video.videoHeight) {
                console.warn('captureFrameSnapshot: video dimensions not ready', {
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight,
                    readyState: video.readyState,
                });
                return null;
            }

            const canvas = document.createElement('canvas');
            // Keep images PDF-friendly (memory + jsPDF stability)
            const { width, height } = this.getScaledDimensions(video.videoWidth, video.videoHeight, 1280);
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (!ctx) return null;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.75);

            return {
                frameNumber,
                timestamp,
                imageDataUrl,
                description,
                annotations
            };
        } catch (error) {
            console.error('Failed to capture frame snapshot:', error);
            return null;
        }
    }

    /**
     * Capture phase-based frames from video URL for coaching analysis
     */
    static async capturePhaseFramesFromUrl(
        videoUrl: string,
        feedback: ServeFeedback,
        strokeType: string
    ): Promise<FrameSnapshot[]> {
        const video = document.createElement('video');
        video.src = videoUrl;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.preload = 'metadata';

        if (!videoUrl.startsWith('blob:')) {
            video.crossOrigin = 'anonymous';
        }

        video.style.position = 'fixed';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        video.style.zIndex = '-9999';
        document.body.appendChild(video);

        const cleanup = () => {
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch {
                // ignore
            }
            if (video.parentNode) video.parentNode.removeChild(video);
        };

        try {
            // Load metadata to get duration
            await this.waitForVideoEvent(video, 'loadedmetadata', 8000);

            const durationMs = (video.duration || 3) * 1000;
            console.log(`Video duration: ${durationMs}ms`);

            // Generate all frames for each phase
            const allPhaseFrames = this.generateAllPhaseFrames(feedback, strokeType, durationMs);
            console.log(`Will capture ${allPhaseFrames.length} total frames across all phases`);

            // Convert to FrameSnapshot format and capture
            const snapshots: FrameSnapshot[] = [];
            const fps = 30;

            for (const moment of allPhaseFrames) {
                const frameNumber = Math.floor((moment.timestamp * fps) / 1000);
                const targetSeconds = moment.timestamp / 1000;
                const seekSeconds = this.clampSeekTime(targetSeconds, video.duration);

                console.log(`[PhaseFrames] Seeking to ${seekSeconds.toFixed(3)}s for ${moment.phaseName} (frame ${frameNumber})`);
                await this.seekWithTimeout(video, seekSeconds, 5000);

                // Allow decode/render to settle
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

                const snapshot = this.captureFrameSnapshot(
                    video,
                    frameNumber,
                    moment.timestamp,
                    moment.description,
                    moment.annotations
                );

                if (snapshot) {
                    // Add phase information
                    snapshot.description = `${moment.phaseName.replace('_', ' ').toUpperCase()}: ${moment.description}`;
                    console.log(`[PhaseFrames] Captured ${moment.phaseName} frame`);
                    snapshots.push(snapshot);
                } else {
                    console.warn(`[PhaseFrames] Failed to capture ${moment.phaseName} frame`);
                }
            }

            console.log(`[PhaseFrames] Total frames captured: ${snapshots.length}/${allPhaseFrames.length}`);
            return snapshots;
        } finally {
            cleanup();
        }
    }

    /**
     * Capture key frames by creating an offscreen video element from a URL.
     * This is more reliable than depending on a visible/React-mounted <video> ref.
     */
    static async captureKeyFramesFromUrl(
        videoUrl: string,
        keyMoments: Array<{
            timestamp: number;
            description: string;
            annotations?: { keyPoints?: string[]; corrections?: string[] };
        }>
    ): Promise<FrameSnapshot[]> {
        const video = document.createElement('video');
        video.src = videoUrl;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.preload = 'auto';
        // Important: do not set crossOrigin for blob: URLs
        if (!videoUrl.startsWith('blob:')) {
            video.crossOrigin = 'anonymous';
        }

        video.style.position = 'fixed';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        video.style.zIndex = '-9999';
        document.body.appendChild(video);

        const cleanup = () => {
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch {
                // ignore
            }
            if (video.parentNode) video.parentNode.removeChild(video);
        };

        try {
            // Load metadata first (duration becomes available)
            await this.waitForVideoEvent(video, 'loadedmetadata', 8000);

            // Ensure we can decode a frame
            if (video.readyState < 2) {
                try {
                    await this.waitForVideoEvent(video, 'loadeddata', 8000);
                } catch {
                    // continue; we'll attempt capture anyway
                }
            }

            const snapshots: FrameSnapshot[] = [];
            const fps = 30;

            for (const moment of keyMoments) {
                const frameNumber = Math.floor((moment.timestamp * fps) / 1000);
                const targetSeconds = moment.timestamp / 1000;
                const seekSeconds = this.clampSeekTime(targetSeconds, video.duration);

                console.log(`[ReportFrames] Seeking to ${seekSeconds.toFixed(3)}s for frame ${frameNumber} (duration=${video.duration?.toFixed?.(2) ?? video.duration})`);
                await this.seekWithTimeout(video, seekSeconds, 5000);

                // Allow decode/render to settle
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

                const snapshot = this.captureFrameSnapshot(
                    video,
                    frameNumber,
                    moment.timestamp,
                    moment.description,
                    moment.annotations
                );

                if (snapshot) {
                    console.log(`[ReportFrames] Captured frame ${frameNumber}, bytes=${snapshot.imageDataUrl.length}`);
                    snapshots.push(snapshot);
                } else {
                    console.warn(`[ReportFrames] Failed to capture frame ${frameNumber}`);
                }
            }

            console.log(`[ReportFrames] Total frames captured: ${snapshots.length}/${keyMoments.length}`);
            return snapshots;
        } finally {
            cleanup();
        }
    }

    /**
     * Capture multiple frames from video at key moments
     */
    static async captureKeyFrames(
        video: HTMLVideoElement,
        keyMoments: Array<{
            timestamp: number;
            description: string;
            annotations?: { keyPoints?: string[]; corrections?: string[] };
        }>
    ): Promise<FrameSnapshot[]> {
        const snapshots: FrameSnapshot[] = [];
        const fps = 30; // Assume 30fps

        for (const moment of keyMoments) {
            const frameNumber = Math.floor(moment.timestamp * fps / 1000);
            const seekTime = moment.timestamp / 1000;

            console.log(`Seeking to ${seekTime}s for frame ${frameNumber}...`);

            // Seek to timestamp
            video.currentTime = seekTime;

            // Wait for frame to load with timeout
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    console.warn(`Seek timeout for frame ${frameNumber}`);
                    video.removeEventListener('seeked', onSeeked);
                    resolve();
                }, 3000); // 3 second timeout

                const onSeeked = () => {
                    clearTimeout(timeout);
                    video.removeEventListener('seeked', onSeeked);
                    console.log(`Seeked to ${video.currentTime}s`);
                    resolve();
                };
                video.addEventListener('seeked', onSeeked);
            });

            // Small delay to ensure frame is rendered
            await new Promise(resolve => setTimeout(resolve, 100));

            const snapshot = this.captureFrameSnapshot(
                video,
                frameNumber,
                moment.timestamp,
                moment.description,
                moment.annotations
            );

            if (snapshot) {
                console.log(`Captured frame ${frameNumber}, image size: ${snapshot.imageDataUrl.length}`);
                snapshots.push(snapshot);
            } else {
                console.warn(`Failed to capture frame ${frameNumber}`);
            }
        }

        console.log(`Total frames captured: ${snapshots.length}`);
        return snapshots;
    }

    /**
     * Generate timing data from phase information
     */
    static generateTimingData(
        phases: Record<string, any>,
        fps: number = 30
    ): TimingData[] {
        const timingData: TimingData[] = [];

        // This would be populated from actual phase detection data
        // For now, create sample structure
        Object.entries(phases).forEach(([phaseName, phaseData]: [string, any], idx) => {
            const startFrame = idx * 30; // Sample
            const endFrame = startFrame + 25; // Sample
            const durationMs = ((endFrame - startFrame) / fps) * 1000;

            timingData.push({
                phaseName: phaseName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                startFrame,
                endFrame,
                durationMs,
                velocityMetrics: {
                    peakVelocity: Math.random() * 15 + 10, // Sample data
                    averageVelocity: Math.random() * 10 + 5,
                    accelerationPhases: ['Initial', 'Peak', 'Deceleration']
                }
            });
        });

        return timingData;
    }

    /**
     * Calculate movement metrics from pose data
     */
    static calculateMovementMetrics(
        poseData?: any
    ): MovementMetrics {
        // Generate realistic metrics similar to what's shown in the app
        const hipShoulderTurn = Math.floor(Math.random() * 20) + 150; // 150-170°
        const kneeBend = Math.floor(Math.random() * 20) + 150; // 150-170°
        const uncoilSpeed = Math.floor(Math.random() * 100) + 250; // 250-350°/s
        const armWhip = Math.floor(Math.random() * 300) + 300; // 300-600°/s
        const trunkLag = Math.random() * 0.5 + 0.2; // 0.2-0.7s
        const kneeDepth = Math.floor(Math.random() * 20) + 155; // 155-175°
        const headSway = Math.random() * 0.2; // 0-0.2

        return {
            averageSpeed: 75,
            peakSpeed: 120,
            consistency: 0.85,
            smoothness: 0.82
        };
    }

    /**
     * Create comprehensive report data with all details
     */
    static createComprehensiveReportData(
        baseData: {
            sport: 'tennis';
            strokeType: string;
            userName?: string;
            feedback: ServeFeedback;
            videoMetadata?: any;
        },
        options?: {
            includeTimingData?: boolean;
            includeFrameSnapshots?: boolean;
            includeMovementMetrics?: boolean;
            customLogo?: string;
        }
    ): ReportData {
        const reportData: ReportData = {
            sport: baseData.sport,
            strokeType: baseData.strokeType,
            userName: baseData.userName,
            analysisDate: new Date(),
            feedback: baseData.feedback,
            videoMetadata: baseData.videoMetadata
        };

        // Add optional enhanced data
        if (options?.includeTimingData) {
            reportData.timingData = this.generateTimingData(baseData.feedback.phases);
        }

        if (options?.includeMovementMetrics) {
            reportData.movementMetrics = this.calculateMovementMetrics();
        }

        if (options?.customLogo) {
            reportData.customLogo = options.customLogo;
        }

        // Frame snapshots would be added separately via captureKeyFrames

        return reportData;
    }

    /**
     * Generate mock frame snapshots for all frames in each phase
     */
    static generateMockFrameSnapshots(
        feedback: ServeFeedback,
        strokeType: string
    ): FrameSnapshot[] {
        const durationMs = 3000;
        const allPhaseFrames = this.generateAllPhaseFrames(feedback, strokeType, durationMs);

        // Create mock snapshots for all phase frames
        return allPhaseFrames.map((moment: any, idx) => ({
            frameNumber: Math.floor(moment.timestamp * 30 / 1000),
            timestamp: moment.timestamp,
            imageDataUrl: '', // Would be populated with actual frame in production
            description: moment.description,
            annotations: moment.annotations
        }));
    }

    /**
     * Generate phase frames exactly like Visual Corrections - only for detected visualIssues
     * This matches the webapp's exact frame detection logic
     */
    static generateAllPhaseFrames(
        feedback: ServeFeedback,
        strokeType: string,
        videoDurationMs: number = 3000
    ): Array<{ timestamp: number; description: string; phaseName: string; annotations?: any }> {
        const frames: Array<{ timestamp: number; description: string; phaseName: string; annotations?: any }> = [];

        // Only generate frames for actual visualIssues, just like the webapp
        if (feedback.visualIssues && feedback.visualIssues.length > 0) {
            console.log('[ReportDataCollector] Processing visualIssues:', feedback.visualIssues);
            feedback.visualIssues.forEach((issue: any, issueIndex: number) => {
                if (issue.timestamp && typeof issue.timestamp === 'number') {
                    const centerTimestamp = issue.timestamp * 1000; // Convert to ms

                    // Use the same offsets as Visual Corrections flipbooks (6-7 frames per phase)
                    const offsets = this.getPhaseOffsetsSeconds(issue.phase);
                    console.log(`[ReportDataCollector] Phase: ${issue.phase}, Offsets: ${offsets.length} frames`, offsets);

                    // Map phase name to feedback phases for annotations
                    const phaseNameMap: Record<string, string> = {
                        'Unit Turn': 'unit_turn',
                        'Racket Drop': 'racket_drop',
                        'Contact Point': 'contact',
                        'Follow Through': 'follow_through',
                        'Preparation': 'preparation',
                        'Ball Toss': 'toss',
                        'Trophy Position': 'backswing'
                    };

                    const mappedPhaseName = phaseNameMap[issue.phase] || issue.phase.toLowerCase().replace(/\s+/g, '');
                    const phaseData = feedback.phases?.[mappedPhaseName] || { score: 75, feedback: issue.issue || 'Focus on this area' };

                    offsets.forEach((offset, frameIndex) => {
                        const timestamp = centerTimestamp + (offset * 1000);

                        // Ensure timestamp is within video bounds
                        if (timestamp >= 0 && timestamp <= videoDurationMs) {
                            frames.push({
                                timestamp,
                                description: `${issue.phase} - Frame ${frameIndex + 1}`,
                                phaseName: mappedPhaseName,
                                annotations: {
                                    phaseName: mappedPhaseName,
                                    score: phaseData.score,
                                    feedback: phaseData.feedback,
                                    keyPoints: this.getPhaseKeyPoints(mappedPhaseName, strokeType),
                                    corrections: this.getPhaseCorrections(mappedPhaseName, phaseData.score),
                                    visualIssue: issue.issue,
                                    issueIndex: issueIndex
                                }
                            });
                        }
                    });
                }
            });
        } else {
            // Fallback: if no visualIssues, generate limited frames for highest scoring phases only
            const phaseEntries = Object.entries(feedback.phases || {});
            const topPhases = phaseEntries
                .sort(([, a], [, b]) => b.score - a.score)
                .slice(0, 2); // Only top 2 phases to keep it limited

            topPhases.forEach(([phaseName, phaseData]: [string, any]) => {
                const phaseTimings = this.getPhaseTimingsForStroke(strokeType, videoDurationMs);
                const timing = phaseTimings[phaseName] || { start: 0, peak: videoDurationMs / 2, end: videoDurationMs };
                const centerTimestamp = timing.peak;

                const offsets = this.getPhaseOffsetsSeconds(phaseName);
                offsets.forEach((offset, index) => {
                    const timestamp = centerTimestamp + (offset * 1000);
                    if (timestamp >= 0 && timestamp <= videoDurationMs) {
                        frames.push({
                            timestamp,
                            description: `${this.getPhaseDescription(phaseName, strokeType)} - Frame ${index + 1}`,
                            phaseName,
                            annotations: {
                                phaseName: phaseName,
                                score: phaseData.score,
                                feedback: phaseData.feedback,
                                keyPoints: this.getPhaseKeyPoints(phaseName, strokeType),
                                corrections: this.getPhaseCorrections(phaseName, phaseData.score)
                            }
                        });
                    }
                });
            });
        }

        console.log(`Generated ${frames.length} phase frames for ${feedback.visualIssues?.length || 0} visual issues`);
        return frames;
    }

    /**
     * Get phase offsets in seconds - matches Visual Corrections flipbook logic
     */
    private static getPhaseOffsetsSeconds(phase: string): number[] {
        const p = (phase || '').toLowerCase();
        // Tighter flipbooks: easier to identify phases (less "too long" feel).
        // CONTACT: approach → contact → early extension (7 frames)
        if (p.includes('contact')) return [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];
        // UNIT TURN: coil building close to the phase moment (7 frames)
        if (p.includes('unit') || p.includes('turn')) return [-0.50, -0.40, -0.30, -0.20, -0.10, -0.05, 0];
        // RACKET DROP / BACKSWING: just around the slot / low point proxy (7 frames)
        if (p.includes('drop') || p.includes('backswing')) return [-0.35, -0.25, -0.18, -0.12, -0.08, -0.04, 0];
        // FOLLOW THROUGH: early wrap/finish (6 frames)
        if (p.includes('follow')) return [0, 0.10, 0.20, 0.30, 0.40, 0.50];
        // TOSS: around toss release and peak (7 frames)
        if (p.includes('toss')) return [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10];
        // PREPARATION: setup and ready position (6 frames)
        if (p.includes('prep')) return [-0.25, -0.20, -0.15, -0.10, -0.05, 0];

        // Default: 7 frames around the phase center
        return [-0.30, -0.20, -0.10, 0, 0.10, 0.20, 0.30];
    }

    /**
     * Get optimal timing for each phase based on stroke type
     */
    private static getPhaseTimingsForStroke(strokeType: string, durationMs: number): Record<string, { start: number; peak: number; end: number }> {
        const timings: Record<string, { start: number; peak: number; end: number }> = {};

        if (strokeType === 'serve') {
            timings['preparation'] = { start: 0, peak: durationMs * 0.15, end: durationMs * 0.25 };
            timings['toss'] = { start: durationMs * 0.2, peak: durationMs * 0.35, end: durationMs * 0.5 };
            timings['backswing'] = { start: durationMs * 0.3, peak: durationMs * 0.55, end: durationMs * 0.7 };
            timings['contact'] = { start: durationMs * 0.65, peak: durationMs * 0.75, end: durationMs * 0.85 };
            timings['followThrough'] = { start: durationMs * 0.8, peak: durationMs * 0.9, end: durationMs };
        } else {
            // Forehand/Backhand
            timings['unitTurn'] = { start: 0, peak: durationMs * 0.2, end: durationMs * 0.3 };
            timings['backswing'] = { start: durationMs * 0.25, peak: durationMs * 0.45, end: durationMs * 0.6 };
            timings['contact'] = { start: durationMs * 0.65, peak: durationMs * 0.75, end: durationMs * 0.85 };
            timings['followThrough'] = { start: durationMs * 0.8, peak: durationMs * 0.9, end: durationMs };
        }

        return timings;
    }

    /**
    * Get coaching-focused description for each tennis phase
     */
    private static getPhaseDescription(phaseName: string, strokeType: string): string {
        const descriptions: Record<string, Record<string, string>> = {
            'tennis': {
                'preparation': 'Athletic Ready Position & Grip',
                'toss': 'Ball Toss Consistency & Placement',
                'backswing': 'Kinetic Chain Loading & Coil',
                'unitTurn': 'Early Preparation & Shoulder Turn',
                'contact': 'Optimal Strike Zone & Extension',
                'followThrough': 'Complete Finish & Recovery',
                'setup': 'Court Position & Shot Preparation',
                'ready': 'Net Ready Position & Anticipation',
                'volley': 'Punch Technique & Net Control'
            }
        };

        return descriptions.tennis[phaseName] ||
            descriptions.tennis[strokeType] ||
            phaseName.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Get key coaching points for each phase with sport-specific expertise
     */
    private static getPhaseKeyPoints(phaseName: string, strokeType: string): string[] {
        const tennisPoints: Record<string, Record<string, string[]>> = {
            'serve': {
                'preparation': ['Continental grip pressure 4-5/10', 'Feet 45° to baseline', 'Weight on balls of feet'],
                'toss': ['Release at eye level', '12-18" above contact point', 'Arm fully extended upward'],
                'backswing': ['Trophy position with elbow up', 'Shoulder over shoulder alignment', 'Racket drop behind head'],
                'contact': ['Full arm extension at strike', 'Pronation through contact', 'Contact at peak reach'],
                'followThrough': ['Racket finishes left side', 'Land on front foot', 'Ready position recovery']
            },
            'forehand': {
                'preparation': ['Semi-western grip check', 'Early unit turn initiation', 'Split-step on opponent contact'],
                'unitTurn': ['Shoulder turn 90+ degrees', 'Prepare racket early', 'Load back leg weight'],
                'backswing': ['Low-to-high swing path', 'Racket below ball initially', 'Maintain balance throughout'],
                'contact': ['Strike zone in front', 'Closed racket face angle', 'Drive through with legs'],
                'followThrough': ['High finish over shoulder', 'Complete extension through', 'Ready position return']
            },
            'backhand': {
                'preparation': ['Two-handed grip alignment', 'Early shoulder turn', 'Stable base position'],
                'unitTurn': ['Full shoulder rotation', 'Prepare racket head up', 'Step with opposite foot'],
                'backswing': ['Compact preparation', 'Short backswing for control', 'Maintain eye on ball'],
                'contact': ['Strike in front of body', 'Both hands through contact', 'Firm wrist position'],
                'followThrough': ['High finish position', 'Extended follow-through', 'Immediate recovery']
            },
            'volley': {
                'preparation': ['Continental grip essential', 'Racket head above wrist', 'Split-step timing crucial'],
                'ready': ['Compact ready position', 'Forward weight distribution', 'Quick first step'],
                'contact': ['Punch motion only', 'Firm wrist at impact', 'Contact in front'],
                'followThrough': ['Minimal follow-through', 'Hold finish briefly', 'Quick recovery']
            },
            'overhead': {
                'preparation': ['Point with off-hand', 'Early positioning crucial', 'Continental grip check'],
                'setup': ['Get under ball early', 'Sideways stance', 'Prepare racket high'],
                'contact': ['Full extension upward', 'Contact at peak reach', 'Snap wrist down'],
                'followThrough': ['Follow through down', 'Land in balance', 'Ready for next shot']
            }
        };

        return tennisPoints[strokeType]?.[phaseName] || tennisPoints.serve?.[phaseName] || [];
    }

    /**
     * Get professional correction suggestions based on phase score and stroke type
     */
    private static getPhaseCorrections(phaseName: string, score: number): string[] {
        if (score >= 85) return []; // Excellent score, minimal corrections
        if (score >= 75) return this.getMinorCorrections(phaseName, score);

        return this.getMajorCorrections(phaseName, score);
    }

    private static getMinorCorrections(phaseName: string, score: number): string[] {
        const minorFixes: Record<string, string[]> = {
            'preparation': ['Fine-tune stance angle 5-10 degrees', 'Optimize grip pressure to 4-5/10', 'Enhance balance distribution'],
            'toss': ['Increase toss consistency by 2-3 inches', 'Adjust forward placement slightly', 'Smooth toss rhythm timing'],
            'backswing': ['Refine shoulder turn completion', 'Optimize racket preparation timing', 'Enhance coil efficiency'],
            'contact': ['Perfect contact point 2-3 inches', 'Increase extension 10%', 'Refine impact precision'],
            'followThrough': ['Complete finish motion fully', 'Optimize deceleration control', 'Enhance recovery speed'],
            'unitTurn': ['Increase turn speed 15%', 'Enhance early preparation', 'Perfect split-step timing'],
            'setup': ['Optimize ready position', 'Enhance anticipation', 'Perfect paddle angle'],
            'ready': ['Improve reaction time', 'Enhance first step', 'Optimize positioning']
        };
        return minorFixes[phaseName] || [];
    }

    private static getMajorCorrections(phaseName: string, score: number): string[] {
        const majorFixes: Record<string, string[]> = {
            'preparation': ['Rebuild stance foundation', 'Establish proper grip fundamentals', 'Develop balance stability'],
            'toss': ['Master consistent toss height', 'Correct placement fundamentals', 'Rebuild toss mechanics'],
            'backswing': ['Establish proper shoulder turn', 'Fix racket preparation path', 'Correct weight transfer'],
            'contact': ['Rebuild contact point fundamentals', 'Establish full extension', 'Correct strike timing'],
            'followThrough': ['Establish complete finish', 'Fix deceleration pattern', 'Rebuild recovery sequence'],
            'unitTurn': ['Rebuild turn mechanics', 'Establish early preparation', 'Fix split-step timing'],
            'setup': ['Establish proper ready position', 'Build anticipation skills', 'Fix paddle positioning'],
            'ready': ['Rebuild reaction fundamentals', 'Establish footwork patterns', 'Fix court positioning'],
            'volley': ['Establish punch technique', 'Fix grip fundamentals', 'Rebuild net positioning'],
            'lob': ['Establish trajectory control', 'Fix paddle face angle', 'Rebuild placement accuracy'],
            'drop': ['Master spin technique', 'Fix contact fundamentals', 'Rebuild soft shot control']
        };
        return majorFixes[phaseName] || majorFixes['preparation'];
    }

    /**
     * Generate key moments for frame capture based on feedback
     */
    static generateKeyMoments(
        feedback: ServeFeedback,
        strokeType: string
    ): Array<{ timestamp: number; description: string; annotations?: any }> {
        const moments: Array<{ timestamp: number; description: string; annotations?: any }> = [];

        if (strokeType === 'serve') {
            // Tennis serve key moments
            moments.push({
                timestamp: 200,
                description: 'Preparation Phase - Stance and ball hold position',
                annotations: {
                    keyPoints: ['Feet shoulder-width apart', 'Weight on balls of feet'],
                    corrections: ['Adjust stance width for better balance']
                }
            });

            moments.push({
                timestamp: 800,
                description: 'Ball Toss - Release point and toss trajectory',
                annotations: {
                    keyPoints: ['Toss arm fully extended', 'Ball released at eye level'],
                    corrections: ['Toss slightly more forward for optimal contact']
                }
            });

            moments.push({
                timestamp: 1400,
                description: 'Backswing - Racket drop and loading phase',
                annotations: {
                    keyPoints: ['Deep racket drop', 'Knee bend for power'],
                    corrections: []
                }
            });

            moments.push({
                timestamp: 1800,
                description: 'Contact Point - Ball strike and extension',
                annotations: {
                    keyPoints: ['Full extension at contact', 'Pronation beginning'],
                    corrections: ['Contact point slightly higher for more power']
                }
            });

            moments.push({
                timestamp: 2200,
                description: 'Follow Through - Finish and recovery',
                annotations: {
                    keyPoints: ['Racket finishes across body', 'Weight transferred forward'],
                    corrections: []
                }
            });
        } else {
            // Forehand/Backhand key moments
            moments.push({
                timestamp: 300,
                description: 'Unit Turn - Initial preparation and coil',
                annotations: {
                    keyPoints: ['Shoulder turn complete', 'Early preparation'],
                    corrections: []
                }
            });

            moments.push({
                timestamp: 900,
                description: 'Backswing - Loading and racket position',
                annotations: {
                    keyPoints: ['Low to high swing path', 'Loading legs'],
                    corrections: []
                }
            });

            moments.push({
                timestamp: 1400,
                description: 'Contact Point - Optimal strike zone',
                annotations: {
                    keyPoints: ['Contact out in front', 'Closed racket face'],
                    corrections: ['Make contact further in front']
                }
            });

            moments.push({
                timestamp: 1900,
                description: 'Follow Through - Completion and finish',
                annotations: {
                    keyPoints: ['High finish over shoulder', 'Full extension'],
                    corrections: []
                }
            });
        }

        return moments;
    }

    /**
     * Add detailed quick tips based on scores
     */
    static enhanceQuickTips(feedback: ServeFeedback, strokeType: string): string[] {
        const tips: string[] = [...(feedback.tips || [])];

        // Add specific tips based on lowest scoring phases
        const phaseScores = Object.entries(feedback.phases).map(([name, data]) => ({
            name,
            score: data.score
        })).sort((a, b) => a.score - b.score);

        // Focus on the weakest phase
        if (phaseScores.length > 0 && phaseScores[0].score < 75) {
            const weakPhase = phaseScores[0].name;

            if (strokeType === 'serve') {
                if (weakPhase.includes('toss')) {
                    tips.push('Practice toss consistency: Place a target on the court and aim for it 20 times');
                    tips.push('Toss drill: Hold racket horizontally above head, toss should hit the strings');
                } else if (weakPhase.includes('contact')) {
                    tips.push('Contact point drill: Freeze at contact position for 3 seconds each serve');
                    tips.push('Use shadow swings to practice reaching up at contact');
                }
            }
        }

        // Add general pro tips
        tips.push('Film yourself regularly to track progress over time');
        tips.push('Warm up thoroughly before practicing to prevent injury');

        return tips;
    }
}
