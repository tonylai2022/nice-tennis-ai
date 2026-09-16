/**
 * useCalibrationState.ts
 * SRP: Manages CalibrationService read-state (examples, profiles, counts, save time).
 * Provides refreshCalibrationState so children can trigger a reload.
 */

import { useState, useEffect, useCallback } from 'react';
import { CalibrationService, CalibrationExample, CalibrationProfile, StrokeType, PhaseType } from '../services/CalibrationService';

interface UseCalibrationStateReturn {
    examples: CalibrationExample[];
    setExamples: React.Dispatch<React.SetStateAction<CalibrationExample[]>>;
    exampleCounts: Record<string, number>;
    setExampleCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    profiles: CalibrationProfile[];
    activeProfileName: string | null;
    lastSaved: Date | null;
    setLastSaved: React.Dispatch<React.SetStateAction<Date | null>>;
    isComplete: boolean;
    refreshCalibrationState: () => void;
    markPhase: (
        selectedPhase: PhaseType | null,
        currentTime: number,
        poseSequence: any[],
        localVideoName: string,
        captureFrameImage: () => string | undefined,
        isUserVideo?: boolean,
        videoId?: string
    ) => string | null;
    removeExampleById: (id: string) => void;
    handleSaveAsProfile: (name: string) => { ok: boolean; profile?: CalibrationProfile };
    handleQuickSave: () => { saved: boolean; profileName: string };
    handleLoadProfile: (profileId: string) => boolean;
    handleDeleteProfile: (profileId: string, profileName: string) => void;
    formatLastSaved: () => string | null;
}

export function useCalibrationState(
    strokeType: StrokeType,
    onCalibrationComplete?: () => void
): UseCalibrationStateReturn {
    const [examples, setExamples] = useState<CalibrationExample[]>([]);
    const [exampleCounts, setExampleCounts] = useState<Record<string, number>>({});
    const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
    const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);

    const refreshCalibrationState = useCallback(() => {
        setExamples(CalibrationService.getExamples(strokeType));
        setExampleCounts(CalibrationService.getExampleCounts(strokeType));
        setProfiles(CalibrationService.getProfiles());
        setActiveProfileName(CalibrationService.getActiveProfileName());
        setLastSaved(CalibrationService.getLastSaveTime());
        onCalibrationComplete?.();
    }, [strokeType, onCalibrationComplete]);

    // Load on mount + auto-pull from cloud
    useEffect(() => {
        setExamples(CalibrationService.getExamples(strokeType));
        setExampleCounts(CalibrationService.getExampleCounts(strokeType));
        setProfiles(CalibrationService.getProfiles());
        setActiveProfileName(CalibrationService.getActiveProfileName());
        setLastSaved(CalibrationService.getLastSaveTime());

        CalibrationService.loadFromCloud()
            .then(result => {
                if (result.ok && result.imported && result.imported > 0) {
                    setExamples(CalibrationService.getExamples(strokeType));
                    setExampleCounts(CalibrationService.getExampleCounts(strokeType));
                }
            })
            .catch(() => { /* silent — Supabase may not be configured */ });
    }, [strokeType]);

    const isComplete = CalibrationService.hasEnoughExamples(strokeType);

    const markPhase = useCallback((
        selectedPhase: PhaseType | null,
        currentTime: number,
        poseSequence: any[],
        localVideoName: string,
        captureFrameImage: () => string | undefined,
        isUserVideo?: boolean,
        videoId?: string
    ): string | null => {
        if (!selectedPhase || poseSequence.length === 0) return null;

        let closestPose: any = null;
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < poseSequence.length; i++) {
            const diff = Math.abs(poseSequence[i].timestamp - currentTime);
            if (diff < minDiff) { minDiff = diff; closestPose = poseSequence[i]; closestIdx = i; }
        }
        if (!closestPose) return 'No pose found at this time';

        const prevPose = closestIdx > 0 ? poseSequence[closestIdx - 1] : undefined;
        const frameImage = captureFrameImage();
        const example = CalibrationService.addExample(
            strokeType, selectedPhase, closestPose, prevPose,
            currentTime, localVideoName, frameImage, isUserVideo, videoId, closestIdx
        );
        setExamples(prev => [...prev, example]);
        setExampleCounts(CalibrationService.getExampleCounts(strokeType));
        setLastSaved(new Date());
        return null; // no error
    }, [strokeType]);

    const removeExampleById = useCallback((id: string) => {
        CalibrationService.removeExample(id);
        setExamples(prev => prev.filter(e => e.id !== id));
        setExampleCounts(CalibrationService.getExampleCounts(strokeType));
    }, [strokeType]);

    const handleSaveAsProfile = useCallback((name: string) => {
        const profile = CalibrationService.saveAsProfile(name.trim(), strokeType);
        if (profile) {
            setProfiles(CalibrationService.getProfiles());
            setActiveProfileName(profile.name);
            setLastSaved(new Date());
            return { ok: true, profile };
        }
        return { ok: false };
    }, [strokeType]);

    const handleQuickSave = useCallback(() => {
        const result = CalibrationService.quickSave(strokeType);
        if (result.saved) {
            setProfiles(CalibrationService.getProfiles());
            setActiveProfileName(result.profileName);
            setLastSaved(new Date());
        }
        return result;
    }, [strokeType]);

    const handleLoadProfile = useCallback((profileId: string) => {
        if (CalibrationService.loadProfile(profileId)) {
            setExamples(CalibrationService.getExamples(strokeType));
            setExampleCounts(CalibrationService.getExampleCounts(strokeType));
            setActiveProfileName(CalibrationService.getActiveProfileName());
            return true;
        }
        return false;
    }, [strokeType]);

    const handleDeleteProfile = useCallback((profileId: string, profileName: string) => {
        if (confirm(`Delete profile "${profileName}"?`)) {
            CalibrationService.deleteProfile(profileId);
            setProfiles(CalibrationService.getProfiles());
        }
    }, []);

    const formatLastSaved = useCallback((): string | null => {
        if (!lastSaved) return null;
        const diffMs = Date.now() - lastSaved.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        return lastSaved.toLocaleTimeString();
    }, [lastSaved]);

    return {
        examples, setExamples,
        exampleCounts, setExampleCounts,
        profiles, activeProfileName,
        lastSaved, setLastSaved,
        isComplete,
        refreshCalibrationState,
        markPhase, removeExampleById,
        handleSaveAsProfile, handleQuickSave,
        handleLoadProfile, handleDeleteProfile,
        formatLastSaved,
    };
}
