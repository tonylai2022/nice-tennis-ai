// Service for Tennis Serve coaching - AI-powered feedback
// This file is the public entry point. All logic lives in ./videoTutor/

import { MotionAnalysisService, AlignmentIssue, PoseResult } from './MotionAnalysisRouter';

// Re-export all public types so existing importers need no changes
export type {
  SkillType,
  AnalysisFeedback,
  ServeFeedback,
  AnalyzeTrimWindow,
  AnalyzeVideoOptions,
  RichTip,
} from './videoTutor/types';

import type { SkillType, AnalysisFeedback, AnalyzeVideoOptions } from './videoTutor/types';
import { generateDemoFeedback, generateFallbackFeedback } from './videoTutor/feedback';
import { analyzeMotionWithAI, extractTipsFromFeedback } from './videoTutor/aiAnalysis';
import { applyTrimWindow, applyUserPhaseTimestampsToIssues } from './videoTutor/helpers';
import { analyzeServe, analyzeForehand, analyzeBackhand } from './videoTutor/analyzeStrokes';

export class VideoTutorService {

  static async warmup() {
    console.log("Warming up Vision AI...");
    try {
      await MotionAnalysisService.initialize();
    } catch (e) {
      console.warn("Warmup failed (can retry later):", e);
    }
  }

  // Delegate to standalone module functions
  static generateDemoFeedback = generateDemoFeedback;
  static generateFallbackFeedback = generateFallbackFeedback;
  static analyzeMotionWithAI = analyzeMotionWithAI;
  static extractTipsFromFeedback = extractTipsFromFeedback;

  static async analyzeServe(refVideoUri: string, userVideoUri: string, options?: AnalyzeVideoOptions): Promise<AnalysisFeedback> {
    return analyzeServe(refVideoUri, userVideoUri, options);
  }

  static async analyzeForehand(refVideoUri: string, userVideoUri: string, options?: AnalyzeVideoOptions): Promise<AnalysisFeedback> {
    return analyzeForehand(refVideoUri, userVideoUri, options);
  }

  static async analyzeBackhand(refVideoUri: string, userVideoUri: string, options?: AnalyzeVideoOptions): Promise<AnalysisFeedback> {
    return analyzeBackhand(refVideoUri, userVideoUri, options);
  }

  /**
   * Generic analysis function that handles all skills
   */
  static async analyzeSkill(skillType: SkillType, refVideoUri: string, userVideoUri: string, options?: AnalyzeVideoOptions): Promise<AnalysisFeedback> {
    // Route to existing specific methods where available
    if (skillType === 'serve') {
      return this.analyzeServe(refVideoUri, userVideoUri, options);
    } else if (skillType === 'forehand') {
      return this.analyzeForehand(refVideoUri, userVideoUri, options);
    } else if (skillType === 'backhand') {
      return this.analyzeBackhand(refVideoUri, userVideoUri, options);
    }

    // For new skills, create a generic analysis
    try {
      // 1. Analyze both videos
      const refRawPoses = await MotionAnalysisService.analyzeVideo(refVideoUri);
      const userRawPoses = await MotionAnalysisService.analyzeVideo(userVideoUri);

      const refPoses = applyTrimWindow(refRawPoses, options?.referenceTrim);
      const userPoses = applyTrimWindow(userRawPoses, options?.userTrim);

      if (!userPoses?.length) {
        const demo = generateDemoFeedback(skillType);
        demo.encouragement = `⚠️ Could not detect poses in your video. Make sure you're fully visible in frame.`;
        return demo;
      }

      // 2. Detect issues for the specific skill
      let visualIssues: AlignmentIssue[] = [];

      switch (skillType) {
        case 'volley':
        case 'forehand_volley':
        case 'backhand_volley':
          visualIssues = await MotionAnalysisService.detectVolleyIssues(userPoses, refPoses, refVideoUri);
          break;
        case 'overhead':
          visualIssues = await MotionAnalysisService.detectOverheadIssues(userPoses, refPoses, refVideoUri);
          break;
        default:
          visualIssues = [];
      }
      applyUserPhaseTimestampsToIssues(visualIssues, options?.userPhaseTimestamps);

      // 3. Compare performances if reference poses available
      const comparison = refPoses?.length ? MotionAnalysisService.comparePerformances(refPoses, userPoses) : null;

      // 4. Create feedback structure with scores derived from actual analysis
      const overall = comparison?.overallScore != null ? Math.min(100, comparison.overallScore) : 75;
      const frameScores = comparison?.frameScores ?? [];

      const sliceMean = (arr: number[], startFrac: number, endFrac: number): number => {
        if (arr.length === 0) return overall;
        const s = Math.floor(arr.length * startFrac);
        const e = Math.floor(arr.length * endFrac);
        const slice = arr.slice(s, e);
        if (slice.length === 0) return overall;
        return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
      };

      const prepPhaseLabels = ['Preparation', 'Body Position', 'Footwork', 'setup'];
      const contactPhaseLabels = ['Paddle Face', 'Contact Point', 'Touch & Control', 'Arm Mechanics', 'Contact', 'Technique'];
      const followPhaseLabels = ['Follow Through', 'Transition', 'follow_through'];

      const issueCount = (labels: string[]) =>
        visualIssues.filter(i => labels.some(l => i.phase?.toLowerCase().includes(l.toLowerCase()))).length;

      const prepIssues = issueCount(prepPhaseLabels);
      const contactIssues = issueCount(contactPhaseLabels);
      const followIssues = issueCount(followPhaseLabels);

      const basePrep = sliceMean(frameScores, 0, 0.3);
      const baseContact = sliceMean(frameScores, 0.3, 0.7);
      const baseFollow = sliceMean(frameScores, 0.7, 1.0);

      const deductPerIssue = 4;
      const prepScore = Math.max(0, Math.min(100, basePrep - prepIssues * deductPerIssue));
      const contactScore = Math.max(0, Math.min(100, baseContact - contactIssues * deductPerIssue));
      const followScore = Math.max(0, Math.min(100, baseFollow - followIssues * deductPerIssue));

      const phaseFeedback = (score: number, phase: string) => {
        if (score >= 90) return `Excellent ${phase} — matches reference closely.`;
        if (score >= 75) return `Good ${phase}. Minor adjustments will improve consistency.`;
        if (score >= 60) return `${phase} needs attention — review the visual comparison below.`;
        return `Focus on ${phase} — significant deviation from reference detected.`;
      };

      const feedback: AnalysisFeedback = {
        overallScore: overall,
        phases: {
          preparation: { score: prepScore, feedback: phaseFeedback(prepScore, 'preparation') },
          execution: { score: contactScore, feedback: phaseFeedback(contactScore, 'execution') },
          follow_through: { score: followScore, feedback: phaseFeedback(followScore, 'follow_through') }
        },
        tips: visualIssues.length === 0
          ? [`Great form! Keep practicing ${skillType} to build consistency.`]
          : visualIssues.slice(0, 3).map(i => i.issue.split(':')[0] || i.issue),
        encouragement: overall >= 95
          ? `Outstanding! Your ${skillType} closely matches the reference.`
          : overall >= 80
            ? `Good ${skillType}! A few refinements will take it to the next level.`
            : `Keep working on your ${skillType} — focus on the highlighted corrections.`,
        visualIssues
      };

      return feedback;

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error in analyze${skillType}:`, msg);

      const demo = generateDemoFeedback(skillType);
      demo.encouragement = `⚠️ Analysis Failed: ${msg}`;
      return demo;
    }
  }
}
