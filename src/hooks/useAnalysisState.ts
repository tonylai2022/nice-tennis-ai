import { useState, useCallback } from 'react';
import type { ServeFeedback, VideoTutorService as VideoTutorServiceType } from '../services/VideoTutor';
import { VideoTutorService } from '../services/VideoTutor';
import { MotionAnalysisService } from '../services/MotionAnalysisRouter';
import { CalibrationService } from '../services/CalibrationService';
import type { StrokeType } from '../services/CalibrationService';
import { ReportDataCollectorService } from '../services/ReportDataCollector';
import type { FrameSnapshot } from '../services/ReportGenerator';
import type { SkillType, TrimRange } from '../types/app';
import { FreeTennisCoach } from '../services/coaching/FreeTennisCoach';
import type { FreeFeedback } from '../services/coaching/FreeTennisCoach';
import type { PoseResult } from '../services/MotionAnalysisRouter';

export interface AnalysisStateOptions {
  referenceUrl: string | null;
  userUrl: string | null;
  userFile: File | null;
  motionType: SkillType;
  referenceDuration: number;
  userDuration: number;
  referenceTrim: TrimRange;
  userTrim: TrimRange;
  /** Admin-set phase timestamps for the reference video (seconds per phase key) */
  referencePhaseTimestamps?: Record<string, number> | null;
  /** User-set manual phase timestamps for their own video (seconds per phase key) */
  userManualPhaseTimestamps?: Record<string, number> | null;
  /** Called with the feedback once analysis succeeds so the caller can navigate */
  onAnalysisComplete: (feedback: ServeFeedback) => void;
  userVideoRef: React.RefObject<HTMLVideoElement | null>;
}

export interface AnalysisState {
  isAnalyzing: boolean;
  feedback: ServeFeedback | null;
  setFeedback: (f: ServeFeedback | null) => void;
  capturedFrames: FrameSnapshot[];
  setCapturedFrames: (f: FrameSnapshot[]) => void;
  phaseSyncEnabled: boolean;
  setPhaseSyncEnabled: (v: boolean) => void;
  userPhaseTimestamps: number[] | null;
  setUserPhaseTimestamps: (ts: number[] | null) => void;
  refPhaseTimestamps: number[] | null;
  setRefPhaseTimestamps: (ts: number[] | null) => void;
  isAnalyzingPhases: boolean;
  analyzeMotion: () => Promise<void>;
  analyzeMotionFree: (userPoseFrames: PoseResult[], refPoseFrames: PoseResult[]) => Promise<void>;
  freeFeedback: FreeFeedback | null;
  clearFreeFeedback: () => void;
  analyzeVideosForPhaseSync: () => Promise<void>;
  captureVideoFrames: () => Promise<FrameSnapshot[]>;
  resetAnalysisState: () => void;
}

// Ordered phase keys per motion type — used to convert Record<string,number> → number[]
const PHASE_KEYS_ORDER: Record<string, string[]> = {
  serve: ['prep', 'tossPeak', 'loading', 'contact', 'finish'],
  forehand: ['unitTurn', 'racketDrop', 'contact', 'followThrough'],
  backhand: ['unitTurn', 'racketDrop', 'contact', 'followThrough'],
  forehand_drive: ['unitTurn', 'racketDrop', 'contact', 'followThrough'],
  backhand_drive: ['unitTurn', 'racketDrop', 'contact', 'followThrough'],
  forehand_volley: ['contact', 'followThrough'],
  backhand_volley: ['contact', 'followThrough'],
  overhead: ['contact', 'followThrough'],
  overhead_smash: ['contact', 'followThrough'],
  lob: ['contact', 'followThrough'],
  drop: ['contact', 'followThrough'],
  dink: ['contact', 'followThrough'],
};

function recordToOrderedArray(ts: Record<string, number>, motionType: string): number[] | null {
  const keys = PHASE_KEYS_ORDER[motionType];
  if (!keys) return null;
  const arr = keys.map(k => ts[k]).filter((t): t is number => t != null && isFinite(t));
  return arr.length > 0 ? arr : null;
}

export function useAnalysisState(opts: AnalysisStateOptions): AnalysisState {
  const {
    referenceUrl,
    userUrl,
    userFile,
    motionType,
    referenceDuration,
    userDuration,
    referenceTrim,
    userTrim,
    referencePhaseTimestamps,
    userManualPhaseTimestamps,
    onAnalysisComplete,
    userVideoRef,
  } = opts;

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState<ServeFeedback | null>(null);
  const [freeFeedback, setFreeFeedback] = useState<FreeFeedback | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<FrameSnapshot[]>([]);
  const [phaseSyncEnabled, setPhaseSyncEnabled] = useState(true);
  const [userPhaseTimestamps, setUserPhaseTimestamps] = useState<number[] | null>(null);
  const [refPhaseTimestamps, setRefPhaseTimestamps] = useState<number[] | null>(null);
  const [isAnalyzingPhases, setIsAnalyzingPhases] = useState(false);

  const analyzeMotion = async () => {
    if (!referenceUrl || !userUrl) return;
    setIsAnalyzing(true);
    try {
      await MotionAnalysisService.initialize();
      const result = await VideoTutorService.analyzeSkill(motionType, referenceUrl, userUrl, {
        referenceTrim:
          referenceDuration > 0
            ? { startSec: referenceTrim.start * referenceDuration, endSec: referenceTrim.end * referenceDuration }
            : undefined,
        userTrim:
          userDuration > 0
            ? { startSec: userTrim.start * userDuration, endSec: userTrim.end * userDuration }
            : undefined,
        phaseTimestamps: referencePhaseTimestamps ?? undefined,
        userPhaseTimestamps: userManualPhaseTimestamps ?? undefined,
      });
      setFeedback(result);
      onAnalysisComplete(result);
    } catch (error) {
      console.error('Analysis failed', error);
      const demoFeedback = VideoTutorService.generateDemoFeedback(motionType);
      setFeedback(demoFeedback);
      onAnalysisComplete(demoFeedback);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzeMotionFree = async (userPoseFrames: PoseResult[], refPoseFrames: PoseResult[]) => {
    setIsAnalyzing(true);
    try {
      const result = FreeTennisCoach.analyze(userPoseFrames, refPoseFrames, motionType);
      setFreeFeedback(result);
      // Stay on compare step — feedback appears as canvas overlay, no navigation
    } catch (error) {
      console.error('Free analysis failed', error);
      const fallback = FreeTennisCoach.analyze([], [], motionType);
      setFreeFeedback(fallback);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzeVideosForPhaseSync = useCallback(async () => {
    if (!referenceUrl || !userUrl) return;

    // ── Fast path: use manually-set timestamps (skip YOLO entirely or partially) ──
    const manualUserTs = userManualPhaseTimestamps
      ? recordToOrderedArray(userManualPhaseTimestamps, motionType as string)
      : null;
    const manualRefTs = referencePhaseTimestamps
      ? recordToOrderedArray(referencePhaseTimestamps, motionType as string)
      : null;

    if (manualUserTs) {
      setUserPhaseTimestamps(manualUserTs);
      if (manualRefTs) {
        // Both sides manually calibrated — no AI needed for sync
        setRefPhaseTimestamps(manualRefTs);
        console.log('[PhaseSync] Using manual timestamps for both ref and user — skipping YOLO');
        return;
      }
    }

    if (!CalibrationService.hasEnoughExamples(motionType as StrokeType)) {
      console.log('Phase sync: No calibration data for', motionType);
      if (!manualUserTs) setUserPhaseTimestamps(null);
      setRefPhaseTimestamps(null);
      return;
    }

    setIsAnalyzingPhases(true);
    try {
      console.log('Analyzing videos for phase sync using calibration...');
      await MotionAnalysisService.reset({ clearMemoryCache: true });

      if (!manualUserTs) {
        // Need to detect user phases via AI
        console.log('Analyzing user video...');
        const userVideoId =
          userFile?.name + '_' + userFile?.lastModified || Date.now().toString();
        (window as any).currentUserVideoId = userVideoId;
        const userPoses = await MotionAnalysisService.analyzeVideo(userUrl);
        (window as any).currentUserVideoId = null;
        const userPhases = CalibrationService.findPhasesWithCalibration(
          motionType as StrokeType,
          userPoses
        );
        if (userPhases) {
          const userTimestamps = userPhases.map((p) => userPoses[p.frameIndex]?.timestamp || 0);
          setUserPhaseTimestamps(userTimestamps);
        }
      }

      if (!manualRefTs) {
        // Need to detect ref phases via AI
        console.log('Analyzing reference video...');
        const refPoses = await MotionAnalysisService.analyzeVideo(referenceUrl);
        const refPhases = CalibrationService.findPhasesWithCalibration(
          motionType as StrokeType,
          refPoses
        );
        if (refPhases) {
          const refTimestamps = refPhases.map((p) => refPoses[p.frameIndex]?.timestamp || 0);
          setRefPhaseTimestamps(refTimestamps);
        }
      }
    } catch (error) {
      console.error('Phase sync analysis failed:', error);
    } finally {
      setIsAnalyzingPhases(false);
    }
  }, [referenceUrl, userUrl, motionType, userFile, userManualPhaseTimestamps, referencePhaseTimestamps]);

  const captureVideoFrames = async (): Promise<FrameSnapshot[]> => {
    if (!feedback) {
      console.log('Cannot capture frames: feedback missing');
      return [];
    }
    if (!userUrl) {
      console.log('[ReportFrames] Cannot capture: no userUrl');
      return [];
    }
    try {
      console.log('[ReportFrames] Using offscreen capture for PHASE-BASED frames');
      const frames = await ReportDataCollectorService.capturePhaseFramesFromUrl(
        userUrl,
        feedback,
        motionType
      );
      console.log('[ReportFrames] Captured phase frames:', frames.length);
      return frames;
    } catch (error) {
      console.error('Failed to capture frames:', error);
      return [];
    }
  };

  const resetAnalysisState = () => {
    setFeedback(null);
    setFreeFeedback(null);
    setCapturedFrames([]);
    setUserPhaseTimestamps(null);
    setRefPhaseTimestamps(null);
    setIsAnalyzingPhases(false);
  };

  return {
    isAnalyzing,
    feedback,
    setFeedback,
    capturedFrames,
    setCapturedFrames,
    phaseSyncEnabled,
    setPhaseSyncEnabled,
    userPhaseTimestamps,
    setUserPhaseTimestamps,
    refPhaseTimestamps,
    setRefPhaseTimestamps,
    isAnalyzingPhases,
    analyzeMotion,
    analyzeMotionFree,
    freeFeedback,
    clearFreeFeedback: () => setFreeFeedback(null),
    analyzeVideosForPhaseSync,
    captureVideoFrames,
    resetAnalysisState,
  };
}
