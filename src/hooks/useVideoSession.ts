import { useState, useEffect, useRef } from 'react';
import type { TrimRange, Step } from '../types/app';
import { referenceVideoService, type ReferenceVideo } from '../services/ReferenceVideoService';

export interface VideoSessionState {
  referenceFile: File | null;
  setReferenceFile: (f: File | null) => void;
  userFile: File | null;
  setUserFile: (f: File | null) => void;
  referenceUrl: string | null;
  setReferenceUrl: (url: string | null) => void;
  userUrl: string | null;
  setUserUrl: (url: string | null) => void;
  referenceDuration: number;
  setReferenceDuration: (d: number) => void;
  userDuration: number;
  setUserDuration: (d: number) => void;
  referenceTrim: TrimRange;
  setReferenceTrim: (r: TrimRange) => void;
  userTrim: TrimRange;
  setUserTrim: (r: TrimRange) => void;
  refVideoRef: React.RefObject<HTMLVideoElement>;
  userVideoRef: React.RefObject<HTMLVideoElement>;
  refMethod: 'upload' | 'library';
  setRefMethod: (m: 'upload' | 'library') => void;
  recordingTarget: 'reference' | 'user' | null;
  setRecordingTarget: (t: 'reference' | 'user' | null) => void;
  /** Admin-set phase timestamps for the selected reference video (seconds per phase key) */
  referencePhaseTimestamps: Record<string, number> | null;
  /** Revoke a blob URL, no-op for remote URLs */
  revokeUrl: (url: string | null) => void;
  handleReferenceSelect: (file: File) => void;
  handleReferenceLibrarySelect: (video: ReferenceVideo) => void;
  /** Notify that a reference video was deleted; clears state if it was selected.
   *  @param deletedVideoUrl the URL of the deleted video
   *  @param onCleared called when the state was cleared so callers can setStep */
  handleReferenceDelete: (deletedVideoUrl: string, onCleared?: () => void) => void;
  handleUserSelect: (file: File, onSelected?: () => void) => void;
  /** Reset all video session state */
  resetVideoSession: () => void;
}

export function useVideoSession(
  step: Step,
): VideoSessionState {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [userFile, setUserFile] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [userUrl, setUserUrl] = useState<string | null>(null);
  const [referenceDuration, setReferenceDuration] = useState(0);
  const [userDuration, setUserDuration] = useState(0);
  const [referenceTrim, setReferenceTrim] = useState<TrimRange>({ start: 0, end: 1 });
  const [userTrim, setUserTrim] = useState<TrimRange>({ start: 0, end: 1 });
  const [refMethod, setRefMethod] = useState<'upload' | 'library'>('library');
  const [recordingTarget, setRecordingTarget] = useState<'reference' | 'user' | null>(null);
  const [referencePhaseTimestamps, setReferencePhaseTimestamps] = useState<Record<string, number> | null>(null);

  const refVideoRef = useRef<HTMLVideoElement>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);

  const revokeUrl = (url: string | null) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  // Scrub user video to trim start when trim changes on the user step
  useEffect(() => {
    if (step === 'user' && userVideoRef.current && userDuration > 0) {
      const startTime = userTrim.start * userDuration;
      if (Math.abs(userVideoRef.current.currentTime - startTime) > 0.05) {
        userVideoRef.current.currentTime = startTime;
      }
    }
  }, [userTrim, step, userDuration]);

  // Scrub reference video when trim changes on reference or compare step
  useEffect(() => {
    if (
      refVideoRef.current &&
      referenceDuration > 0 &&
      (step === 'reference' || step === 'compare')
    ) {
      const startTime = referenceTrim.start * referenceDuration;
      if (Math.abs(refVideoRef.current.currentTime - startTime) > 0.05) {
        refVideoRef.current.currentTime = startTime;
      }
    }
  }, [referenceTrim, step, referenceDuration]);

  const handleReferenceSelect = (file: File) => {
    revokeUrl(referenceUrl);
    const url = URL.createObjectURL(file);
    setReferenceFile(file);
    setReferenceUrl(url);
    setReferenceDuration(0);
    setReferenceTrim({ start: 0, end: 1 });
    setReferencePhaseTimestamps(null); // uploaded file has no preset timestamps
  };

  const handleReferenceLibrarySelect = (video: ReferenceVideo) => {
    revokeUrl(referenceUrl);
    setReferenceFile(null);
    setReferenceUrl(video.url);
    setReferenceDuration(0);
    setReferenceTrim({ start: 0, end: 1 });
    setReferencePhaseTimestamps(video.phaseTimestamps ?? null);
    referenceVideoService.setLiveTennisServeReference(video);
  };

  const handleReferenceDelete = (deletedVideoUrl: string, onCleared?: () => void) => {
    if (referenceUrl === deletedVideoUrl) {
      console.log(`[useVideoSession] Clearing state for deleted reference video: ${deletedVideoUrl}`);
      revokeUrl(referenceUrl);
      setReferenceUrl(null);
      setReferenceFile(null);
      onCleared?.();
    }
  };

  const handleUserSelect = (file: File, onSelected?: () => void) => {
    revokeUrl(userUrl);
    const url = URL.createObjectURL(file);
    setUserFile(file);
    setUserUrl(url);
    setUserDuration(0);
    setUserTrim({ start: 0, end: 1 });
    onSelected?.();
  };

  const resetVideoSession = () => {
    revokeUrl(referenceUrl);
    revokeUrl(userUrl);
    setReferenceFile(null);
    setUserFile(null);
    setReferenceUrl(null);
    setUserUrl(null);
    setReferenceDuration(0);
    setUserDuration(0);
    setReferenceTrim({ start: 0, end: 1 });
    setUserTrim({ start: 0, end: 1 });
    setRefMethod('library');
    setRecordingTarget(null);
    setReferencePhaseTimestamps(null);
  };

  return {
    referenceFile,
    setReferenceFile,
    userFile,
    setUserFile,
    referenceUrl,
    setReferenceUrl,
    userUrl,
    setUserUrl,
    referenceDuration,
    setReferenceDuration,
    userDuration,
    setUserDuration,
    referenceTrim,
    setReferenceTrim,
    userTrim,
    setUserTrim,
    refVideoRef,
    userVideoRef,
    refMethod,
    setRefMethod,
    recordingTarget,
    setRecordingTarget,
    revokeUrl,
    handleReferenceSelect,
    handleReferenceLibrarySelect,
    handleReferenceDelete,
    handleUserSelect,
    resetVideoSession,
    referencePhaseTimestamps,
  };
}
