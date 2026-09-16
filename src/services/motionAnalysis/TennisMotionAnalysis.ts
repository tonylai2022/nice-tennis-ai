// â”€â”€â”€ TennisMotionAnalysis.ts â€” thin shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All analysis logic lives in the tennis/* sub-modules.
// This file only re-exports types and attaches public method aliases.

import { TennisAnalysisCore } from './tennis/TennisAnalysisCore';
import type { PoseResult, AlignmentIssue, AnalysisOptions } from './BaseMotionAnalysis';

// â”€â”€â”€ Public function imports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { trimStaticFrames as _trimStaticFrames, findClosestFrameWithData as _findClosestFrameWithData, findClosestFrame as _findClosestFrame } from './tennis/poseUtils';
import { getUserPhasesWithCalibration as _getUserPhasesWithCalibration } from './tennis/phaseEnsemble';
import { compareWithOverlay as _compareWithOverlay, overlayToIssues as _overlayToIssues, analyzeStrokeWithOverlay as _analyzeStrokeWithOverlay, compareFramePair as _compareFramePair } from './tennis/overlayComparison';
import { detectForehandPhases as _detectForehandPhases, detectForehandIssues as _detectForehandIssues } from './tennis/strokes/forehand';
import { detectBackhandPhases as _detectBackhandPhases, detectBackhandIssues as _detectBackhandIssues } from './tennis/strokes/backhand';
import { detectServeIssues as _detectServeIssues } from './tennis/strokes/serve';
import { detectVolleyIssues as _detectVolleyIssues } from './tennis/strokes/volley';
import { detectOverheadIssues as _detectOverheadIssues } from './tennis/strokes/overhead';
import { computeCoachRubricScores as _computeCoachRubricScores, comparePerformances as _comparePerformances, comparePerformancesByPhase as _comparePerformancesByPhase } from './tennis/coachRubric';
import { computeSubtleMovement as _computeSubtleMovement, generateSubtleMovementSummary as _generateSubtleMovementSummary } from './tennis/subtleMovement';
import { generateErrorImages as _generateErrorImages, captureRawFrameAtTime as _captureRawFrameAtTime, captureRawFramesAtTimes as _captureRawFramesAtTimes, captureAnnotatedFrameAtTime as _captureAnnotatedFrameAtTime, captureAnnotatedFramesAtTimes as _captureAnnotatedFramesAtTimes } from './tennis/frameAnnotation';

// â”€â”€â”€ Re-exports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type { FrameComparisonResult, OverlayComparisonResult, SubtleMovementMetrics, SubtleMovementSeries, SubtleMovementResult, HandednessPreference } from './tennis/types';
export type { PoseResult, AlignmentIssue, AnalysisOptions };

export class TennisMotionAnalysisService extends TennisAnalysisCore {
  private static readonly JOINT_NAMES: Record<number, string> = {
    0: 'nose', 1: 'left_eye_inner', 2: 'left_eye', 3: 'left_eye_outer',
    4: 'right_eye_inner', 5: 'right_eye', 6: 'right_eye_outer',
    7: 'left_ear', 8: 'right_ear', 9: 'mouth_left', 10: 'mouth_right',
    11: 'left_shoulder', 12: 'right_shoulder', 13: 'left_elbow', 14: 'right_elbow',
    15: 'left_wrist', 16: 'right_wrist', 17: 'left_pinky', 18: 'right_pinky',
    19: 'left_index', 20: 'right_index', 21: 'left_thumb', 22: 'right_thumb',
    23: 'left_hip', 24: 'right_hip', 25: 'left_knee', 26: 'right_knee',
    27: 'left_ankle', 28: 'right_ankle', 29: 'left_heel', 30: 'right_heel',
    31: 'left_foot_index', 32: 'right_foot_index',
  };
  private static readonly KEY_TENNIS_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

  // â”€â”€â”€ Public aliases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static trimStaticFrames = _trimStaticFrames;
  static findClosestFrameWithData = _findClosestFrameWithData;
  static findClosestFrame = _findClosestFrame;
  static getUserPhasesWithCalibration = _getUserPhasesWithCalibration;
  static compareWithOverlay = _compareWithOverlay;
  static overlayToIssues = _overlayToIssues;
  static analyzeStrokeWithOverlay = _analyzeStrokeWithOverlay;
  static compareFramePair = _compareFramePair;
  static detectForehandPhases = _detectForehandPhases;
  static detectForehandIssues = _detectForehandIssues;
  static detectBackhandPhases = _detectBackhandPhases;
  static detectBackhandIssues = _detectBackhandIssues;
  static detectServeIssues = _detectServeIssues;
  static detectVolleyIssues = _detectVolleyIssues;
  static detectOverheadIssues = _detectOverheadIssues;
  static computeCoachRubricScores = _computeCoachRubricScores;
  static comparePerformances = _comparePerformances;
  static comparePerformancesByPhase = _comparePerformancesByPhase;
  static computeSubtleMovement = _computeSubtleMovement;
  static generateSubtleMovementSummary = _generateSubtleMovementSummary;
  static generateErrorImages = _generateErrorImages;
  static captureRawFrameAtTime = _captureRawFrameAtTime;
  static captureRawFramesAtTimes = _captureRawFramesAtTimes;
  static captureAnnotatedFrameAtTime = _captureAnnotatedFrameAtTime;
  static captureAnnotatedFramesAtTimes = _captureAnnotatedFramesAtTimes;
}
