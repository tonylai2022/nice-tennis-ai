/**
 * PhaseCalibration.tsx  (root component — ~200 lines)
 * Composes all sub-components and hooks. Owns minimal shared state.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { CalibrationService, PHASE_DEFINITIONS, StrokeType, PhaseType } from '../services/CalibrationService';
import { ReferenceVideo } from '../services/ReferenceVideoService';
import { trainingVideoService } from '../services/TrainingVideoService';
import { useCalibrationState } from '../hooks/useCalibrationState';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { useSyncHandlers } from '../hooks/useSyncHandlers';
import { CalibrationHeader } from './calibration/CalibrationHeader';
import { VideoPlayer } from './calibration/VideoPlayer';
import { PhasePanel } from './calibration/PhasePanel';
import { SyncDialog } from './calibration/SyncDialog';
import { SaveProfileDialog } from './calibration/SaveProfileDialog';
import { TrainingLibraryModal } from './calibration/TrainingLibraryModal';

interface PhaseCalibrationProps {
    videoUrl?: string | null;
    strokeType: StrokeType;
    videoName?: string;
    onClose: () => void;
    onCalibrationComplete?: () => void;
    isUserVideo?: boolean;
    videoId?: string;
}

export const PhaseCalibration: React.FC<PhaseCalibrationProps> = ({
    videoUrl: initialVideoUrl,
    strokeType,
    videoName: initialVideoName,
    onClose,
    onCalibrationComplete,
    isUserVideo = false,
    videoId,
}) => {
    const [message, setMessage] = useState<string | null>(null);
    const [selectedPhase, setSelectedPhase] = useState<PhaseType | null>(null);
    const [mobilePanelOpen, setMobilePanelOpen] = useState(true);
    const [mobilePanelTab, setMobilePanelTab] = useState<'phases' | 'examples' | 'actions'>('phases');
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [newProfileName, setNewProfileName] = useState('');
    const [showLibrary, setShowLibrary] = useState(false);
    const [libraryVideos, setLibraryVideos] = useState<ReferenceVideo[]>([]);
    const [loadingLibrary, setLoadingLibrary] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    const cal = useCalibrationState(strokeType, onCalibrationComplete);
    const video = useVideoPlayer(initialVideoUrl, initialVideoName, strokeType, setMessage);
    const sync = useSyncHandlers(cal.refreshCalibrationState, setMessage);

    const phases = PHASE_DEFINITIONS[strokeType];

    // Collapse panel on mobile by default
    useEffect(() => {
        try { if (window.matchMedia('(max-width: 1023px)').matches) setMobilePanelOpen(false); } catch { /* ignore */ }
    }, []);

    // Track play state
    useEffect(() => {
        const el = video.videoRef.current;
        if (!el) return;
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        el.addEventListener('play', onPlay);
        el.addEventListener('pause', onPause);
        return () => { el.removeEventListener('play', onPlay); el.removeEventListener('pause', onPause); };
    }, [video.videoRef]);

    // ── Library ──────────────────────────────────────────────────────────────
    const filterVideosForStroke = useCallback((videos: ReferenceVideo[]) => {
        const filtered = videos.filter(v => v.tags.some(t => t.toLowerCase() === strokeType.toLowerCase()));
        return filtered.length > 0 ? filtered : videos;
    }, [strokeType]);

    const openTrainingLibrary = useCallback(() => {
        setShowLibrary(true);
        setLoadingLibrary(true);
        trainingVideoService.getAllVideos()
            .then(vids => setLibraryVideos(filterVideosForStroke(vids)))
            .catch(() => { /* ignore */ })
            .finally(() => setLoadingLibrary(false));
    }, [filterVideosForStroke]);

    const handleDeleteTrainingVideo = useCallback(async (e: React.MouseEvent<HTMLButtonElement>, v: ReferenceVideo) => {
        e.stopPropagation();
        if (!confirm(`Delete "${v.title}"? This cannot be undone.`)) return;
        const deleted = await trainingVideoService.deleteVideo(v);
        if (!deleted) { setMessage('Failed to delete training video'); return; }
        setLibraryVideos(cur => cur.filter(x => x.id !== v.id));
        setMessage(`Deleted "${v.title}"`);
        if (video.localVideoUrl === v.url) {
            video.setLocalVideoUrl(null);
            video.setLocalVideoName('video');
            video.setPoseSequence([]);
        }
    }, [video]);

    const handleLibrarySelect = useCallback((v: ReferenceVideo) => {
        if (video.localVideoUrl?.startsWith('blob:')) URL.revokeObjectURL(video.localVideoUrl);
        video.setLocalVideoUrl(v.url);
        video.setLocalVideoName(v.title);
        video.setPoseSequence([]);
        setMessage(null);
        setShowLibrary(false);
    }, [video]);

    // ── Phase actions ─────────────────────────────────────────────────────────
    const handleMarkPhase = useCallback(() => {
        const err = cal.markPhase(
            selectedPhase, video.currentTime, video.poseSequence,
            video.localVideoName, video.captureFrameImage, isUserVideo, videoId
        );
        if (err) { setMessage(err); return; }
        setMessage(`Marked "${selectedPhase}" at ${video.currentTime.toFixed(2)}s`);
        const idx = phases.indexOf(selectedPhase as any);
        if (idx < phases.length - 1) setSelectedPhase(phases[idx + 1] as PhaseType);
    }, [cal, selectedPhase, video, isUserVideo, videoId, phases]);

    const handleJumpToExample = useCallback((ts: number) => {
        if (video.videoRef.current) {
            video.videoRef.current.currentTime = ts;
            video.setCurrentTime(ts);
        }
    }, [video]);

    // ── Export/Import inline ──────────────────────────────────────────────────
    const handleExportData = useCallback(() => {
        const blob = new Blob([CalibrationService.exportData()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `tennis_calibration_${strokeType}.json`;
        a.click(); URL.revokeObjectURL(url);
    }, [strokeType]);

    const handleImportData = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                if (CalibrationService.importData(reader.result as string)) {
                    cal.refreshCalibrationState();
                    setMessage('Calibration data imported');
                } else {
                    setMessage('Failed to import data');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }, [cal]);

    const handleClearAll = useCallback(() => {
        if (!confirm('Clear all calibration data? This cannot be undone.')) return;
        CalibrationService.clearAll();
        cal.refreshCalibrationState();
        setMessage('All calibration data cleared');
    }, [cal]);

    // ── Profile actions ───────────────────────────────────────────────────────
    const handleSaveAsProfile = useCallback(() => {
        const result = cal.handleSaveAsProfile(newProfileName);
        if (result.ok && result.profile) {
            setNewProfileName('');
            setShowSaveDialog(false);
            setMessage(`Saved as "${result.profile.name}"`);
        } else {
            setMessage(!newProfileName.trim() ? 'Please enter a profile name' : 'Failed to save profile');
        }
    }, [cal, newProfileName]);

    const handleQuickSave = useCallback(() => {
        const result = cal.handleQuickSave();
        setMessage(result.saved ? `Saved to "${result.profileName}"` : 'Failed to save');
    }, [cal]);

    const handleLoadProfile = useCallback((id: string) => {
        setMessage(cal.handleLoadProfile(id) ? 'Profile loaded' : 'Failed to load profile');
    }, [cal]);

    const handleDeleteProfile = useCallback((id: string, name: string) => {
        cal.handleDeleteProfile(id, name);
        setMessage('Profile deleted');
    }, [cal]);

    const strokeExamples = cal.examples.filter(e => e.strokeType === strokeType);
    const strokeProfiles = cal.profiles.filter(p => p.strokeType === strokeType);

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
            <CalibrationHeader
                strokeType={strokeType}
                isComplete={cal.isComplete}
                lastSavedLabel={cal.formatLastSaved()}
                activeProfileName={cal.activeProfileName}
                strokeExampleCount={strokeExamples.length}
                onClose={onClose}
                onSync={() => sync.setShowSyncDialog(true)}
                onQuickSave={handleQuickSave}
                onSaveAs={() => setShowSaveDialog(true)}
            />

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                <VideoPlayer
                    videoRef={video.videoRef}
                    canvasRef={video.canvasRef}
                    fileInputRef={video.fileInputRef}
                    localVideoUrl={video.localVideoUrl}
                    currentTime={video.currentTime}
                    duration={video.duration}
                    isAnalyzing={video.isAnalyzing}
                    isUploading={video.isUploading}
                    poseSequence={video.poseSequence}
                    message={message}
                    onLoadedMetadata={video.handleLoadedMetadata}
                    onTimeUpdate={video.handleTimeUpdate}
                    onSeek={video.handleSeek}
                    onVideoSelect={video.handleVideoSelect}
                    onUploadClick={() => video.fileInputRef.current?.click()}
                    onOpenLibrary={openTrainingLibrary}
                    onFrameBack={() => { if (video.videoRef.current) video.videoRef.current.currentTime = Math.max(0, video.currentTime - 0.033); }}
                    onFrameForward={() => { if (video.videoRef.current) video.videoRef.current.currentTime = Math.min(video.duration, video.currentTime + 0.033); }}
                    onPlayPause={() => { const el = video.videoRef.current; if (el) { el.paused ? void el.play() : el.pause(); } }}
                    onSlowmo={() => { if (video.videoRef.current) video.videoRef.current.playbackRate = 0.25; }}
                    onNormalSpeed={() => { if (video.videoRef.current) video.videoRef.current.playbackRate = 1; }}
                    isPlaying={isPlaying}
                />

                <PhasePanel
                    phases={phases}
                    selectedPhase={selectedPhase}
                    setSelectedPhase={setSelectedPhase}
                    exampleCounts={cal.exampleCounts}
                    strokeExamples={strokeExamples}
                    strokeProfiles={strokeProfiles}
                    mobilePanelOpen={mobilePanelOpen}
                    setMobilePanelOpen={setMobilePanelOpen}
                    mobilePanelTab={mobilePanelTab}
                    setMobilePanelTab={setMobilePanelTab}
                    isComplete={cal.isComplete}
                    poseSequenceLength={video.poseSequence.length}
                    strokeType={strokeType}
                    onMarkPhase={handleMarkPhase}
                    onJumpToExample={handleJumpToExample}
                    onRemoveExample={id => { cal.removeExampleById(id); setMessage('Example removed'); }}
                    onLoadProfile={handleLoadProfile}
                    onDeleteProfile={handleDeleteProfile}
                    onCalibrationComplete={onCalibrationComplete}
                    onClose={onClose}
                    onExportData={handleExportData}
                    onImportData={handleImportData}
                    onClearAll={handleClearAll}
                />
            </div>

            <SyncDialog {...sync} />

            <SaveProfileDialog
                showSaveDialog={showSaveDialog}
                setShowSaveDialog={setShowSaveDialog}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                strokeType={strokeType}
                onSave={handleSaveAsProfile}
            />

            <TrainingLibraryModal
                showLibrary={showLibrary}
                setShowLibrary={setShowLibrary}
                libraryVideos={libraryVideos}
                loadingLibrary={loadingLibrary}
                onSelect={handleLibrarySelect}
                onDelete={handleDeleteTrainingVideo}
            />
        </div>
    );
};