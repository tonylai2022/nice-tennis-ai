// analyzeServe, analyzeForehand, analyzeBackhand — standalone async functions

import { MotionAnalysisService, AlignmentIssue } from '../MotionAnalysisRouter';
import { CalibrationService } from '../CalibrationService';
import type { StrokeType } from '../CalibrationService';
import type { AnalysisFeedback, AnalyzeVideoOptions } from './types';
import { generateDemoFeedback } from './feedback';
import { analyzeMotionWithAI } from './aiAnalysis';
import { applyTrimWindow, realignGroundstrokeScores, applyCoachRubricScores, applyUserPhaseTimestampsToIssues } from './helpers';

export async function analyzeServe(
    refVideoUri: string,
    userVideoUri: string,
    options?: AnalyzeVideoOptions
): Promise<AnalysisFeedback> {
    try {
        console.log('Starting serve analysis...');
        await MotionAnalysisService.reset({ clearMemoryCache: true });

        console.log('Analyzing reference video...');
        const refRawPoses = await MotionAnalysisService.analyzeVideo(refVideoUri);

        console.log('Analyzing user video...');
        const userRawPoses = await MotionAnalysisService.analyzeVideo(userVideoUri);

        const refPoses = applyTrimWindow(refRawPoses, options?.referenceTrim);
        const userPoses = applyTrimWindow(userRawPoses, options?.userTrim);

        console.log(`Analysis complete. Ref frames: ${refPoses.length}, User frames: ${userPoses.length}`);

        if (refPoses.length === 0 || userPoses.length === 0) {
            console.warn("No poses detected in one or both videos");
            return {
                ...generateDemoFeedback(),
                encouragement: "⚠️ No motion detected. Please ensure your full body is visible in the video.",
                overallScore: 0
            };
        }

        const comparison = MotionAnalysisService.comparePerformances(refPoses, userPoses);

        const subtleMovement = MotionAnalysisService.computeSubtleMovement(
            refPoses,
            userPoses,
            'serve' as StrokeType
        );

        let visualIssues: AlignmentIssue[] = [];
        try {
            const rawIssues = await MotionAnalysisService.detectServeIssues(userPoses, refPoses);
            const userStart = await MotionAnalysisService.generateErrorImages(userVideoUri, rawIssues, false, userPoses, 'serve');
            visualIssues = await MotionAnalysisService.generateErrorImages(refVideoUri, userStart, true, refPoses, 'serve');
        } catch (e) {
            console.warn('Visual analysis error', e);
        }
        applyUserPhaseTimestampsToIssues(visualIssues, options?.userPhaseTimestamps);

        const prompt = `
        I have compared a user's tennis serve video with a reference pro serve using Computer Vision.
        
        DATA:
        - Frame-by-frame similarity scores (0-100) for 50 sampled frames across the serve motion:
        [${comparison.frameScores.join(', ')}]
        
        - Overall similarity score: ${comparison.overallScore}
        
        - DETECTED BIO-MECHANICAL ISSUES:
        ${visualIssues.map(i => `- ${i.phase}: ${i.issue}`).join('\n')}

        ${subtleMovement.summary}
        
        TIMELINE:
        - Frames 0-10: Preparation/Stance
        - Frames 10-20: Ball Toss & Trophy Pose
        - Frames 20-30: Racquet Drop & Leg Drive (Backswing)
        - Frames 30-40: Swing to Contact (Acceleration)
        - Frames 40-50: Follow Through & Landing
        
        INSTRUCTIONS:
        1. Identify the phase with the LOWEST scores. This is the "Primary Fault".
        2. For the Primary Fault, assume common amateur errors (e.g., if Toss score is low, they likely tossed too low or behind head; if Contact is low, they likely didn't extend fully).
        3. Provide specific, actionable correction drills (e.g., "Toss against a wall", "Throw a football").
        4. Be constructive but direct.
    `;

        const result = await analyzeMotionWithAI('serve', prompt, comparison);
        result.visualIssues = visualIssues;
        result.subtleMovement = subtleMovement;
        return result;

    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in analyzeServe:', msg);
        const demo = generateDemoFeedback();
        demo.encouragement = `⚠️ Analyis Failed: ${msg}`;
        return demo;
    }
}

export async function analyzeForehand(
    refVideoUri: string,
    userVideoUri: string,
    options?: AnalyzeVideoOptions
): Promise<AnalysisFeedback> {
    try {
        console.log('Starting forehand analysis...');
        await MotionAnalysisService.reset({ clearMemoryCache: true });

        console.log('Analyzing reference video...');
        const refRawPoses = await MotionAnalysisService.analyzeVideo(refVideoUri);

        console.log('Analyzing user video...');
        const userRawPoses = await MotionAnalysisService.analyzeVideo(userVideoUri);

        const refPoses = applyTrimWindow(refRawPoses, options?.referenceTrim);
        const userPoses = applyTrimWindow(userRawPoses, options?.userTrim);

        if (refPoses.length === 0 || userPoses.length === 0) {
            return {
                ...generateDemoFeedback('forehand'),
                encouragement: "⚠️ No motion detected. Please ensure your full body is visible.",
                overallScore: 0
            };
        }

        const comparison = MotionAnalysisService.comparePerformances(refPoses, userPoses);

        const subtleMovement = MotionAnalysisService.computeSubtleMovement(
            refPoses,
            userPoses,
            'forehand' as StrokeType
        );

        // Load admin-calibrated phase timestamps from localStorage
        const _fhRefPhaseTs = (() => {
            try {
                const all = JSON.parse(localStorage.getItem('motiontutor_phase_timestamps_v1') ?? '{}');
                const ts: Record<string, number> = all[refVideoUri] ?? {};
                if (Object.keys(ts).length > 0) {
                    console.log('[analyzeForehand] Using admin phase timestamps for ref comparison:', ts);
                }
                return Object.keys(ts).length > 0 ? ts : undefined;
            } catch { return undefined; }
        })();

        let visualIssues: AlignmentIssue[] = [];
        try {
            const rawIssues = await MotionAnalysisService.detectForehandIssues(userPoses, refPoses, refVideoUri, _fhRefPhaseTs);
            const userStart = await MotionAnalysisService.generateErrorImages(userVideoUri, rawIssues, false, userPoses, 'forehand');
            visualIssues = await MotionAnalysisService.generateErrorImages(refVideoUri, userStart, true, refPoses, 'forehand');
        } catch (e) {
            console.warn('Visual analysis error', e);
        }
        applyUserPhaseTimestampsToIssues(visualIssues, options?.userPhaseTimestamps);

        let phaseComparison = comparison;
        const userIssueTs = {
            unitTurn: visualIssues.find(i => i.phase === 'Unit Turn')?.timestamp ?? null,
            racketDrop: visualIssues.find(i => i.phase === 'Racket Drop')?.timestamp ?? null,
            contact: visualIssues.find(i => i.phase === 'Contact Point')?.timestamp ?? null,
            followThrough: visualIssues.find(i => i.phase === 'Follow Through')?.timestamp ?? null,
        };
        const refIssueTs = {
            unitTurn: visualIssues.find(i => i.phase === 'Unit Turn')?.refTimestamp ?? null,
            racketDrop: visualIssues.find(i => i.phase === 'Racket Drop')?.refTimestamp ?? null,
            contact: visualIssues.find(i => i.phase === 'Contact Point')?.refTimestamp ?? null,
            followThrough: visualIssues.find(i => i.phase === 'Follow Through')?.refTimestamp ?? null,
        };

        const hasUserTs = Object.values(userIssueTs).every(v => v !== null);
        const hasRefTs = Object.values(refIssueTs).every(v => v !== null);

        try {
            if (hasUserTs && hasRefTs) {
                const phaseResult = MotionAnalysisService.comparePerformancesByPhase(
                    refPoses, userPoses,
                    userIssueTs as { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
                    refIssueTs as { unitTurn: number; racketDrop: number; contact: number; followThrough: number }
                );
                phaseComparison = { overallScore: phaseResult.overallScore, frameScores: phaseResult.frameScores };
            }

            if (hasUserTs && userIssueTs.contact !== null) {
                const addCal = (phase: string, ts: number | null) => {
                    if (ts === null) return;
                    let best = userPoses[0]; let bestD = Infinity;
                    for (const p of userPoses) { const d = Math.abs(p.timestamp - ts); if (d < bestD) { bestD = d; best = p; } }
                    const prev = userPoses[Math.max(0, userPoses.indexOf(best) - 1)];
                    CalibrationService.addExample(
                        'forehand' as StrokeType, phase as Parameters<typeof CalibrationService.addExample>[1],
                        best, prev, best.timestamp ?? 0, 'auto-capture', undefined, true
                    );
                };
                try {
                    addCal('unit_turn', userIssueTs.unitTurn);
                    addCal('racket_drop', userIssueTs.racketDrop);
                    addCal('contact', userIssueTs.contact);
                    addCal('follow_through', userIssueTs.followThrough);
                    console.log('[CalibrationService] Auto-captured forehand training examples');
                } catch (calErr) { console.warn('Calibration auto-capture failed:', calErr); }
            }
        } catch (e) {
            console.warn('Phase-anchored comparison failed, using global DTW:', e);
        }

        const prompt = `
        I have compared a user's tennis forehand (back view) with a reference pro stroke.
        
        DATA:
        - Frame-by-frame similarity scores (0-100): [${phaseComparison.frameScores.join(', ')}]
        - Overall similarity score: ${phaseComparison.overallScore}
        - DETECTED ISSUES: ${visualIssues.map(i => `- ${i.phase}: ${i.issue}`).join('\n')}

        ${subtleMovement.summary}
        
        PHASES:
        1. Unit Turn
        2. Racket Drop
        3. Contact Point
        4. Follow Through

        INSTRUCTIONS:
        1. Identify the Primary Fault.
        2. Provide specific corrections.
      `;

        const result = await analyzeMotionWithAI('forehand', prompt, phaseComparison);
        result.visualIssues = visualIssues;
        result.subtleMovement = subtleMovement;
        realignGroundstrokeScores(result, phaseComparison.frameScores, userPoses, visualIssues);
        if (hasUserTs) {
            applyCoachRubricScores(result, userPoses,
                userIssueTs as { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
                true
            );
        }
        return result;

    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in analyzeForehand:', msg);
        const demo = generateDemoFeedback('forehand');
        demo.encouragement = `⚠️ Analyis Failed: ${msg}`;
        return demo;
    }
}

export async function analyzeBackhand(
    refVideoUri: string,
    userVideoUri: string,
    options?: AnalyzeVideoOptions
): Promise<AnalysisFeedback> {
    try {
        console.log('Starting backhand analysis...');
        await MotionAnalysisService.reset({ clearMemoryCache: true });

        console.log('Analyzing reference video...');
        const refRawPoses = await MotionAnalysisService.analyzeVideo(refVideoUri);

        await new Promise(r => setTimeout(r, 500));

        console.log('Analyzing user video...');
        const userRawPoses = await MotionAnalysisService.analyzeVideo(userVideoUri);

        const refPoses = applyTrimWindow(refRawPoses, options?.referenceTrim);
        const userPoses = applyTrimWindow(userRawPoses, options?.userTrim);

        if (refPoses.length === 0 || userPoses.length === 0) {
            return {
                ...generateDemoFeedback('backhand'),
                encouragement: "⚠️ No motion detected. Please ensure your full body is visible.",
                overallScore: 0
            };
        }

        const comparison = MotionAnalysisService.comparePerformances(refPoses, userPoses);

        const subtleMovement = MotionAnalysisService.computeSubtleMovement(
            refPoses,
            userPoses,
            'backhand' as StrokeType
        );

        let visualIssues: AlignmentIssue[] = [];
        try {
            const rawIssues = await MotionAnalysisService.detectBackhandIssues(userPoses, refPoses, refVideoUri);
            const userStart = await MotionAnalysisService.generateErrorImages(userVideoUri, rawIssues, false, userPoses, 'backhand');
            visualIssues = await MotionAnalysisService.generateErrorImages(refVideoUri, userStart, true, refPoses, 'backhand');
        } catch (e) {
            console.warn('Visual analysis error', e);
        }
        applyUserPhaseTimestampsToIssues(visualIssues, options?.userPhaseTimestamps);

        let phaseComparison = comparison;
        const userIssueTsBH = {
            unitTurn: visualIssues.find(i => i.phase === 'Unit Turn')?.timestamp ?? null,
            racketDrop: visualIssues.find(i => i.phase === 'Racket Drop')?.timestamp ?? null,
            contact: visualIssues.find(i => i.phase === 'Contact Point')?.timestamp ?? null,
            followThrough: visualIssues.find(i => i.phase === 'Follow Through')?.timestamp ?? null,
        };
        const refIssueTsBH = {
            unitTurn: visualIssues.find(i => i.phase === 'Unit Turn')?.refTimestamp ?? null,
            racketDrop: visualIssues.find(i => i.phase === 'Racket Drop')?.refTimestamp ?? null,
            contact: visualIssues.find(i => i.phase === 'Contact Point')?.refTimestamp ?? null,
            followThrough: visualIssues.find(i => i.phase === 'Follow Through')?.refTimestamp ?? null,
        };
        const hasUserTsBH = Object.values(userIssueTsBH).every(v => v !== null);
        const hasRefTsBH = Object.values(refIssueTsBH).every(v => v !== null);

        try {
            if (hasUserTsBH && hasRefTsBH) {
                const phaseResult = MotionAnalysisService.comparePerformancesByPhase(
                    refPoses, userPoses,
                    userIssueTsBH as { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
                    refIssueTsBH as { unitTurn: number; racketDrop: number; contact: number; followThrough: number }
                );
                phaseComparison = { overallScore: phaseResult.overallScore, frameScores: phaseResult.frameScores };
            }

            if (hasUserTsBH && userIssueTsBH.contact !== null) {
                const addCal = (phase: string, ts: number | null) => {
                    if (ts === null) return;
                    let best = userPoses[0]; let bestD = Infinity;
                    for (const p of userPoses) { const d = Math.abs(p.timestamp - ts); if (d < bestD) { bestD = d; best = p; } }
                    const prev = userPoses[Math.max(0, userPoses.indexOf(best) - 1)];
                    CalibrationService.addExample(
                        'backhand' as StrokeType, phase as Parameters<typeof CalibrationService.addExample>[1],
                        best, prev, best.timestamp ?? 0, 'auto-capture', undefined, true
                    );
                };
                try {
                    addCal('unit_turn', userIssueTsBH.unitTurn);
                    addCal('racket_drop', userIssueTsBH.racketDrop);
                    addCal('contact', userIssueTsBH.contact);
                    addCal('follow_through', userIssueTsBH.followThrough);
                    console.log('[CalibrationService] Auto-captured backhand training examples');
                } catch (calErr) { console.warn('Calibration auto-capture failed:', calErr); }
            }
        } catch (e) {
            console.warn('Phase-anchored comparison failed, using global DTW:', e);
        }

        const prompt = `
        I have compared a user's tennis backhand (back view) with a reference pro stroke.
        
        DATA:
        - Frame-by-frame similarity scores (0-100): [${phaseComparison.frameScores.join(', ')}]
        - Overall similarity score: ${phaseComparison.overallScore}
        - DETECTED ISSUES: ${visualIssues.map(i => `- ${i.phase}: ${i.issue}`).join('\n')}

        ${subtleMovement.summary}
        
        PHASES:
        1. Unit Turn
        2. Racket Drop
        3. Contact Point
        4. Follow Through

        INSTRUCTIONS:
        1. Identify the Primary Fault.
        2. Provide specific corrections.
      `;

        const result = await analyzeMotionWithAI('backhand', prompt, phaseComparison);
        result.visualIssues = visualIssues;
        result.subtleMovement = subtleMovement;
        realignGroundstrokeScores(result, phaseComparison.frameScores, userPoses, visualIssues);
        if (hasUserTsBH) {
            applyCoachRubricScores(result, userPoses,
                userIssueTsBH as { unitTurn: number; racketDrop: number; contact: number; followThrough: number },
                false
            );
        }
        return result;

    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in analyzeBackhand:', msg);
        const demo = generateDemoFeedback('backhand');
        demo.encouragement = `⚠️ Analyis Failed: ${msg}`;
        return demo;
    }
}
