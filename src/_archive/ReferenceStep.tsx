import React, { useRef, useState } from 'react';
import { CameraRecorder } from './CameraRecorder';
import { ReferenceLibrary } from './ReferenceLibrary';
import { VideoPhaseCalibrator } from './VideoPhaseCalibrator';
import type { ReferenceVideo } from '../services/ReferenceVideoService';
import type { TrimRange } from '../types/app';

const PHASE_FIELDS_BY_TYPE: Record<string, { key: string; label: string }[]> = {
    serve: [
        { key: 'prep', label: 'Preparation' },
        { key: 'tossPeak', label: 'Ball Toss' },
        { key: 'loading', label: 'Trophy Position' },
        { key: 'contact', label: 'Contact' },
        { key: 'finish', label: 'Follow Through' },
    ],
    forehand: [
        { key: 'unitTurn', label: 'Unit Turn' },
        { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    backhand: [
        { key: 'unitTurn', label: 'Unit Turn' },
        { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    forehand_drive: [
        { key: 'unitTurn', label: 'Unit Turn' },
        { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    backhand_drive: [
        { key: 'unitTurn', label: 'Unit Turn' },
        { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    forehand_volley: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    backhand_volley: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    overhead: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    overhead_smash: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    lob: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    drop: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    dink: [
        { key: 'contact', label: 'Contact' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
};

interface ReferenceStepProps {
    refMethod: 'library' | 'upload';
    setRefMethod: (m: 'library' | 'upload') => void;
    motionType: string;
    sport: 'tennis';
    referenceUrl: string | null;
    userUrl: string | null;
    userDuration: number;
    setUserDuration: (d: number) => void;
    userTrim: TrimRange;
    setUserTrim: (r: TrimRange) => void;
    userVideoRef: React.RefObject<HTMLVideoElement>;
    recordingTarget: string | null;
    setRecordingTarget: (t: string | null) => void;
    handleReferenceLibrarySelect: (video: ReferenceVideo) => void;
    handleReferenceSelect: (file: File) => void;
    handleReferenceDelete: (url: string) => void;
    handleUserSelect: (file: File) => void;
    onBack: () => void;
    onContinue: () => void;
    onReport?: () => void;
    userManualPhaseTimestamps: Record<string, number> | null;
    onManualCalibrationSave: (ts: Record<string, number>) => void;
    uploadError?: string | null;
    showSkeleton?: boolean;
    onSkeletonToggle?: (v: boolean) => void;
    exportLang?: 'en' | 'zhSimp' | 'zhTrad';
    onExportLangChange?: (l: 'en' | 'zhSimp' | 'zhTrad') => void;
}

export function ReferenceStep({
    motionType,
    sport,
    referenceUrl,
    userUrl,
    userDuration,
    setUserDuration,
    userTrim,
    setUserTrim,
    userVideoRef,
    recordingTarget,
    setRecordingTarget,
    handleReferenceLibrarySelect,
    handleReferenceSelect,
    handleReferenceDelete,
    handleUserSelect,
    onBack,
    onContinue,
    onReport,
    userManualPhaseTimestamps,
    onManualCalibrationSave,
    uploadError,
    showSkeleton = true,
    onSkeletonToggle,
    exportLang = 'en',
    onExportLangChange,
}: ReferenceStepProps) {
    const referenceInputRef = useRef<HTMLInputElement | null>(null);
    const userInputRef = useRef<HTMLInputElement | null>(null);
    const [showCalibrator, setShowCalibrator] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showPlayButton, setShowPlayButton] = useState(true);
    const phaseFields = PHASE_FIELDS_BY_TYPE[motionType] ?? null;
    const calibratedCount = userManualPhaseTimestamps
        ? Object.keys(userManualPhaseTimestamps).length
        : 0;

    const handleSelect = (video: ReferenceVideo) => {
        handleReferenceLibrarySelect(video);
    };

    const handlePlayTrimmed = () => {
        if (!userVideoRef.current) return;
        const startTime = 0;
        const endTime = userDuration;

        userVideoRef.current.currentTime = startTime;
        userVideoRef.current.play();
        setIsPlaying(true);
        setShowPlayButton(false);

        const checkEnd = setInterval(() => {
            if (userVideoRef.current && userVideoRef.current.currentTime >= endTime) {
                userVideoRef.current.pause();
                userVideoRef.current.currentTime = startTime;
                setIsPlaying(false);
                setShowPlayButton(true);
                clearInterval(checkEnd);
            }
        }, 100);
    };

    return (
        <>
            {showCalibrator && phaseFields && userUrl && (
                <VideoPhaseCalibrator
                    videoUrl={userUrl}
                    phaseFields={phaseFields}
                    initialTimestamps={userManualPhaseTimestamps ?? {}}
                    onSave={(ts) => { onManualCalibrationSave(ts); setShowCalibrator(false); }}
                    onClose={() => setShowCalibrator(false)}
                    title="Your Video — Mark Key Phases"
                />
            )}

            <div className="flex flex-col min-h-0">

                <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
                    <section className="min-h-0 flex-1 flex flex-col gap-1.5 overflow-hidden">
                        <h3 className="text-base font-semibold text-white">1. Choose Reference Video</h3>

                        <ReferenceLibrary
                            onSelect={handleSelect}
                            selectedVideoUrl={referenceUrl}
                            onDeleteSuccess={handleReferenceDelete}
                            filterCategory={motionType}
                            filterSport={sport}
                        />
                    </section>

                    <section className="shrink-0 space-y-1.5 border-t border-slate-800/70 pt-2">
                        <h3 className="text-sm font-semibold text-white sm:text-base">2. Upload/Take Video</h3>

                        <div className="flex flex-col gap-2">
                            {userUrl && (
                                <div className="h-fit">
                                    <div className="card overflow-hidden rounded-2xl border border-slate-800 p-0 bg-black relative group">
                                        <video
                                            ref={userVideoRef}
                                            className="block aspect-video h-auto w-full object-contain bg-black"
                                            src={userUrl}
                                            playsInline
                                            muted
                                            preload="auto"
                                            onClick={() => {
                                                if (userVideoRef.current) {
                                                    if (isPlaying) {
                                                        userVideoRef.current.pause();
                                                        setIsPlaying(false);
                                                        setShowPlayButton(true);
                                                    } else {
                                                        handlePlayTrimmed();
                                                    }
                                                }
                                            }}
                                            onLoadedData={(e) => {
                                                const v = e.currentTarget;
                                                console.debug('[userVideo] loadeddata readyState=', v.readyState, 'duration=', v.duration);
                                                // iOS Safari: blob URL videos show black until seeked.
                                                if (v.paused && v.currentTime === 0) {
                                                    v.currentTime = 0.001;
                                                }
                                            }}
                                            onError={(e) => {
                                                const v = e.currentTarget;
                                                const err = v.error;
                                                console.error('[userVideo] error code=', err?.code, 'message=', err?.message, 'src=', v.src?.slice(0, 60));
                                            }}
                                            onLoadedMetadata={(e) => {
                                                const v = e.currentTarget;
                                                const d = v.duration;
                                                if (isFinite(d) && d > 0) {
                                                    setUserDuration(d);
                                                } else if (!isFinite(d)) {
                                                    // Android WebM: no duration header — seek to end to force browser to scan the file
                                                    (v as any).__fixingDuration = true;
                                                    v.currentTime = 1e101;
                                                }
                                            }}
                                            onSeeked={(e) => {
                                                const v = e.currentTarget;
                                                if ((v as any).__fixingDuration) {
                                                    (v as any).__fixingDuration = false;
                                                    // duration is now resolved; record it then seek back to start
                                                    if (isFinite(v.duration) && v.duration > 0) setUserDuration(v.duration);
                                                    v.currentTime = 0;
                                                }
                                            }}
                                            onEnded={() => {
                                                setIsPlaying(false);
                                                setShowPlayButton(true);
                                            }}
                                        />
                                        {showPlayButton && !isPlaying && (
                                            <div
                                                className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer group-hover:bg-black/30 transition-all"
                                                onClick={handlePlayTrimmed}
                                            >
                                                <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-accent/90 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                                                    <svg className="w-7 h-7 sm:w-10 sm:h-10 text-slate-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            )}

                            <div className="card !p-2.5 sm:!p-3">
                                {recordingTarget === 'user' ? (
                                    <CameraRecorder
                                        onCapture={(file) => {
                                            handleUserSelect(file);
                                            setRecordingTarget(null);
                                        }}
                                        onCancel={() => setRecordingTarget(null)}
                                        overlayVideoUrl={referenceUrl}
                                    />
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {/* Row 1: Camera + Upload */}
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                className="w-full rounded-xl border border-sky-400/40 bg-sky-500 text-slate-950 transition-colors hover:bg-sky-400 active:scale-[0.98] py-2.5 text-sm font-semibold"
                                                onClick={() => setRecordingTarget('user')}
                                            >
                                                📷 Camera
                                            </button>
                                            <button
                                                className="w-full rounded-xl border border-violet-400/40 bg-violet-500 text-white transition-colors hover:bg-violet-400 active:scale-[0.98] py-2.5 text-sm font-semibold"
                                                onClick={() => userInputRef.current?.click()}
                                            >
                                                ⬆ Upload
                                            </button>
                                        </div>

                                        {/* Row 2: Language + Skeleton (always visible) */}
                                        <div className="grid grid-cols-2 gap-2">
                                            {/* Language picker */}
                                            <div className="flex rounded-xl overflow-hidden border border-slate-600">
                                                {(['en', 'zhSimp', 'zhTrad'] as const).map((l) => (
                                                    <button
                                                        key={l}
                                                        className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${exportLang === l
                                                            ? 'bg-slate-500 text-white'
                                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                                            }`}
                                                        onClick={() => onExportLangChange?.(l)}
                                                    >
                                                        {l === 'en' ? 'EN' : l === 'zhSimp' ? '简' : '繁'}
                                                    </button>
                                                ))}
                                            </div>
                                            {/* Skeleton toggle */}
                                            <button
                                                className={`w-full rounded-xl border py-2.5 text-sm font-semibold transition-colors ${showSkeleton
                                                    ? 'border-emerald-500/50 bg-emerald-600 text-white'
                                                    : 'border-slate-600 bg-slate-800 text-slate-400'
                                                    }`}
                                                onClick={() => onSkeletonToggle?.(!showSkeleton)}
                                            >
                                                🦴 {showSkeleton ? 'Skeleton On' : 'Skeleton Off'}
                                            </button>
                                        </div>

                                        {/* Row 3: Compare (only when both videos ready) */}
                                        {referenceUrl && userUrl && (
                                            <div className="flex gap-2">
                                                <button
                                                    className="flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-900 font-bold py-3 text-sm transition-colors shadow-lg shadow-emerald-900/30"
                                                    onClick={onContinue}
                                                >
                                                    ▶ Compare
                                                </button>
                                            </div>
                                        )}

                                        <input
                                            ref={userInputRef}
                                            type="file"
                                            accept="video/*"
                                            className="hidden"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                if (file) handleUserSelect(file);
                                                event.currentTarget.value = '';
                                            }}
                                        />
                                        {uploadError && (
                                            <p className="text-xs text-red-400 text-center col-span-2">{uploadError}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
