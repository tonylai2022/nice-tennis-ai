// Shared types and helpers for VideoTutorService

import type { AlignmentIssue, SubtleMovementResult } from '../MotionAnalysisRouter';

// Define all available skills
export type SkillType =
    | 'serve'
    | 'forehand' | 'backhand'
    | 'volley' | 'forehand_volley' | 'backhand_volley'
    | 'overhead'
    | 'lob'
    | 'drop';

export interface RichTip {
    label: string;
    abbr: string;
    score: number;
    detail: string;
    short?: string;     // compact actionable summary (≤8 words + numbers), e.g. for collapsed row
    icon: string;
    rawValue?: number;  // actual measured value (e.g. joint angle in °)
    rawUnit?: string;   // unit string (e.g. '°', '% torso')
}

export interface AnalysisFeedback {
    isDemo?: boolean;
    overallScore: number;
    phases: Record<string, { score: number; feedback: string }>;
    tips: string[];
    richTips?: RichTip[];
    encouragement: string;
    visualIssues?: AlignmentIssue[];
    subtleMovement?: SubtleMovementResult;
}

export type ServeFeedback = AnalysisFeedback;

export interface AnalyzeTrimWindow {
    startSec: number;
    endSec: number;
}

export interface AnalyzeVideoOptions {
    referenceTrim?: AnalyzeTrimWindow;
    userTrim?: AnalyzeTrimWindow;
    /** Admin-set phase timestamps for the reference video */
    phaseTimestamps?: Record<string, number>;
    /** User-set manual phase timestamps for their own video (seconds, keyed by calibration field names) */
    userPhaseTimestamps?: Record<string, number>;
}

export const getGoogleApiKey = (): string | null => {
    const raw = (import.meta.env.VITE_GOOGLE_API_KEY as unknown as string | undefined) ?? undefined;
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) return null;
    const lower = key.toLowerCase();
    if (lower === 'undefined' || lower === 'null' || lower === 'your-google-api-key') return null;
    if (!key.startsWith('AIza')) return null;
    return key;
};
