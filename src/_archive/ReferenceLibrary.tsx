import React, { useEffect, useState } from 'react';
import { referenceVideoService, ReferenceVideo } from '../services/ReferenceVideoService';
import { VideoPhaseCalibrator } from './VideoPhaseCalibrator';

interface ReferenceLibraryProps {
    onSelect?: (video: ReferenceVideo) => void;
    selectionLabel?: string;
    isSelectable?: (video: ReferenceVideo) => boolean;
    selectedVideoUrl?: string | null;
    /** If true, show a delete button (intended for admins) */
    showAdminControls?: boolean;
    filterCategory?: string;
    filterSport?: 'tennis';
    /** Increment to force a re-fetch (e.g. after admin upload) */
    refreshTrigger?: number;
    /** Called when a video is successfully deleted with its URL */
    onDeleteSuccess?: (videoUrl: string) => void;
    /** Called when phase timestamps are updated for a video */
    onTimestampsUpdated?: () => void;
}

const SKILL_ORDER = ['serve', 'forehand_volley', 'backhand_volley', 'forehand', 'backhand', 'volley', 'overhead', 'drop', 'lob'];

const SKILL_LABEL: Record<string, string> = {
    volley: 'Volley', drop: 'Drop Shot',
    lob: 'Lob', serve: 'Serve', forehand: 'Forehand Groundstroke',
    backhand: 'Backhand Groundstroke', overhead: 'Forehand Overhead',
    forehand_volley: 'Forehand Volley', backhand_volley: 'Backhand Volley',
};

const NON_SKILL_TAGS = new Set(['tennis', 'pro', 'auto-discovered']);

function resolveSkill(tags: string[]): string {
    return tags.find(t => !NON_SKILL_TAGS.has(t)) ?? 'other';
}

// Phase fields per primary skill tag — same as in AdminVideoUpload
const LIB_PHASE_FIELDS: Record<string, { key: string; label: string }[]> = {
    forehand: [
        { key: 'unitTurn', label: 'Unit Turn' }, { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact' }, { key: 'followThrough', label: 'Follow Through' },
    ],
    backhand: [
        { key: 'unitTurn', label: 'Unit Turn' }, { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact' }, { key: 'followThrough', label: 'Follow Through' },
    ],
    serve: [
        { key: 'prep', label: 'Preparation' }, { key: 'tossPeak', label: 'Ball Toss' },
        { key: 'loading', label: 'Trophy Pos.' }, { key: 'contact', label: 'Contact' },
        { key: 'finish', label: 'Follow Through' },
    ],
};

const DEFAULT_PHASE_FIELDS = [
    { key: 'contact', label: 'Contact' }, { key: 'followThrough', label: 'Follow Through' },
];

function getPhaseFieldsForVideo(video: ReferenceVideo): { key: string; label: string }[] {
    const skillTag = video.tags.find(t => LIB_PHASE_FIELDS[t]) ?? null;
    return skillTag ? LIB_PHASE_FIELDS[skillTag] : DEFAULT_PHASE_FIELDS;
}

/** Strip leading unix-ms timestamp that Supabase filenames may include */
function cleanTitle(title: string): string {
    return title.replace(/^\d{10,}\s*/g, '').replace(/\s+/g, ' ').trim();
}

function getPreviewVideoSrc(url: string): string {
    return url.includes('#') ? url : `${url}#t=0.001`;
}

export const ReferenceLibrary: React.FC<ReferenceLibraryProps> = ({
    onSelect,
    selectionLabel = 'Select',
    isSelectable = () => true,
    selectedVideoUrl,
    showAdminControls,
    filterCategory,
    filterSport,
    refreshTrigger,
    onDeleteSuccess,
    onTimestampsUpdated,
}) => {
    const [videos, setVideos] = useState<ReferenceVideo[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [calibratingVideo, setCalibratingVideo] = useState<ReferenceVideo | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const videoRefs = React.useRef<Record<string, HTMLVideoElement | null>>({});
    const loadRequestId = React.useRef(0);

    useEffect(() => { loadVideos(); }, [filterCategory, filterSport, refreshTrigger]);

    const loadVideos = async () => {
        const requestId = ++loadRequestId.current;
        setLoading(true);
        try {
            const data = await referenceVideoService.getAllVideos();
            console.log('[ReferenceLibrary] Loaded videos:', data.length, 'videos', data);
            let filtered = data;
            if (filterSport) {
                console.log('[ReferenceLibrary] Filtering by sport:', filterSport);
                filtered = filtered.filter(v => {
                    // Resolve sport from field OR tags — either is enough.
                    // This handles old videos where one of the two may be missing.
                    const resolvedSport = v.sport ?? (v.tags.includes('tennis') ? 'tennis' : undefined);
                    return resolvedSport === filterSport;
                });
                console.log('[ReferenceLibrary] After sport filter:', filtered.length, 'videos');
            }
            if (filterCategory) {
                console.log('[ReferenceLibrary] Filtering by category:', filterCategory);
                filtered = filtered.filter(v =>
                    v.tags.some(t => t.toLowerCase() === filterCategory.toLowerCase()));
                console.log('[ReferenceLibrary] After category filter:', filtered.length, 'videos');
            }
            console.log('[ReferenceLibrary] Final videos to display:', filtered);
            if (requestId !== loadRequestId.current) {
                console.log('[ReferenceLibrary] Ignoring stale load result for', { filterSport, filterCategory, requestId });
                return;
            }
            setVideos(filtered);
        } catch (err) {
            console.error('Failed to load reference videos', err);
        } finally {
            if (requestId === loadRequestId.current) {
                setLoading(false);
            }
        }
    };

    const handleDelete = async (video: ReferenceVideo) => {
        if (!window.confirm(`Are you sure you want to delete "${video.title}"?`)) return;

        setIsDeleting(video.id);
        try {
            console.log('[ReferenceLibrary] Starting deletion of video:', video.title, 'URL:', video.url);
            const success = await referenceVideoService.deleteVideo(video);
            console.log('[ReferenceLibrary] Deletion result:', success);

            if (success) {
                // Add small delay to ensure Supabase has processed the deletion
                await new Promise(resolve => setTimeout(resolve, 500));

                // Refresh list locally
                setVideos(prev => prev.filter(v => v.id !== video.id));
                console.log('[ReferenceLibrary] Removed video from local list, total remaining:', videos.length - 1);

                // Notify parent to clear state if this video was selected
                // Pass the video URL so parent can match against stored reference URL
                onDeleteSuccess?.(video.url);
                console.log('[ReferenceLibrary] Called onDeleteSuccess callback with URL:', video.url);
            } else {
                alert('Failed to delete video. Please check browser console (F12) for detailed errors.');
            }
        } catch (err) {
            console.error('[ReferenceLibrary] Unexpected error during deletion:', err);
            alert('Unexpected error during deletion. Please check browser console (F12).');
        } finally {
            setIsDeleting(null);
        }
    };

    if (loading) return <div className="p-4 text-slate-400">Loading library...</div>;

    if (videos.length === 0) {
        return (
            <div className="p-6 bg-slate-900/50 rounded-xl border border-slate-800 text-center">
                <div className="py-8">
                    <p className="text-slate-400 mb-4">📹 No reference videos available</p>
                    <p className="text-sm text-slate-500 mb-6">
                        {filterSport && filterCategory
                            ? `No ${filterSport} ${filterCategory} videos found in library`
                            : 'No reference videos have been uploaded yet'}
                    </p>
                    <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
                        <p className="text-xs text-slate-400 mb-2">👨‍💼 For Admins:</p>
                        <p className="text-xs text-slate-500">
                            Go to the main page → "⚡ Admin: Upload Reference Videos" to add professional reference videos
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ---- Group by sport → skill ----
    type Group = {
        sport: string;
        skill: string;
        skillLabel: string;
        emoji: string;
        videos: ReferenceVideo[];
    };

    const groupMap = new Map<string, Group>();
    for (const video of videos) {
        const sportKey = video.sport ?? 'tennis';
        const skillKey = resolveSkill(video.tags);
        const key = `${sportKey}::${skillKey}`;
        if (!groupMap.has(key)) {
            groupMap.set(key, {
                sport: sportKey,
                skill: skillKey,
                skillLabel: SKILL_LABEL[skillKey]
                    || (skillKey.charAt(0).toUpperCase() + skillKey.slice(1)),
                emoji: '🎾',
                videos: [],
            });
        }
        groupMap.get(key)!.videos.push(video);
    }

    const groups = [...groupMap.values()].sort((a, b) => {
        const ord = SKILL_ORDER;
        return (ord.indexOf(a.skill) === -1 ? 99 : ord.indexOf(a.skill))
            - (ord.indexOf(b.skill) === -1 ? 99 : ord.indexOf(b.skill));
    });

    // If already narrowed to one sport+skill by props, skip section headers
    const singleGroup = groups.length === 1 && !!filterCategory;
    // Use carousel layout in user-facing mode (no admin controls)
    const isCarousel = !showAdminControls;

    return (
        <>
            <div className={isCarousel ? 'space-y-2 min-h-0 flex flex-col' : 'space-y-8 p-1'}>
                {!singleGroup && (
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        {filterSport
                            ? `🎾 Tennis — choose a reference`
                            : 'Reference Library'}
                    </p>
                )}

                {groups.map(group => (
                    <div key={`${group.sport}::${group.skill}`} className={isCarousel ? 'min-h-0 flex flex-col' : ''}>
                        {/* Section header — hidden when already filtered to one skill */}
                        {!singleGroup && (
                            <div className="flex items-center gap-2 mb-2">
                                <h3 className="text-sm font-semibold text-slate-300">
                                    {group.emoji} {group.skillLabel}
                                </h3>
                                <span className="text-xs text-slate-600">{group.videos.length} video{group.videos.length !== 1 ? 's' : ''}</span>
                                <div className="flex-1 h-px bg-slate-800" />
                            </div>
                        )}

                        {isCarousel ? (
                            /* ── Horizontal swipe carousel (user mode) ── */
                            <>
                                <div className="relative -mx-1">
                                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-1 text-xl font-bold text-white/55">
                                        &lt;
                                    </div>
                                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pr-1 text-xl font-bold text-white/55">
                                        &gt;
                                    </div>
                                    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-1 px-1">
                                        {group.videos.map(video => {
                                            const isPro = video.tags.includes('pro');
                                            const previewSrc = getPreviewVideoSrc(video.url);
                                            const isSelected = selectedVideoUrl === video.url;
                                            return (
                                                <div
                                                    key={video.id}
                                                    className={`snap-center shrink-0 w-[calc(100vw-2rem)] max-w-none sm:max-w-sm sm:w-52 rounded-xl border transition-all overflow-hidden flex flex-col ${isSelected ? 'border-accent ring-1 ring-accent/60 bg-slate-800' : 'border-slate-700 bg-slate-800 hover:border-accent/60 active:border-accent'}`}
                                                >
                                                    {/* Thumbnail — tap to preview */}
                                                    <div
                                                        className="relative aspect-video w-full bg-black cursor-pointer group sm:aspect-[9/16] sm:max-h-[200px]"
                                                        onClick={() => {
                                                            const el = videoRefs.current[video.id];
                                                            if (!el) return;
                                                            if (playingId === video.id) {
                                                                el.pause();
                                                                setPlayingId(null);
                                                            } else {
                                                                if (playingId && videoRefs.current[playingId]) {
                                                                    videoRefs.current[playingId]!.pause();
                                                                }
                                                                el.currentTime = 0;
                                                                el.play();
                                                                setPlayingId(video.id);
                                                            }
                                                        }}
                                                    >
                                                        <video
                                                            ref={el => { videoRefs.current[video.id] = el; }}
                                                            src={previewSrc}
                                                            className="w-full h-full object-cover"
                                                            poster={video.thumbnailUrl || undefined}
                                                            playsInline
                                                            muted
                                                            preload="auto"
                                                            onEnded={() => setPlayingId(null)}
                                                        />
                                                        {/* Play/Pause overlay */}
                                                        <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${playingId === video.id ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                                                            <div className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
                                                                {playingId === video.id ? (
                                                                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                                                                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                                                    </svg>
                                                                ) : (
                                                                    <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                                                        <path d="M8 5v14l11-7z" />
                                                                    </svg>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {isPro && (
                                                            <span className="absolute top-2 left-2 bg-accent text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                                                PRO
                                                            </span>
                                                        )}
                                                        {onSelect && isSelectable(video) && (
                                                            <button
                                                                type="button"
                                                                aria-label={isSelected ? 'Selected reference video' : 'Select reference video'}
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    onSelect(video);
                                                                }}
                                                                className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur transition-all ${isSelected ? 'border-accent bg-accent text-slate-950' : 'border-white/40 bg-black/70 text-white hover:border-accent/70 hover:bg-black/80'}`}
                                                            >
                                                                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                                    <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.2 7.2a1 1 0 01-1.415 0l-3-3a1 1 0 111.415-1.414l2.292 2.291 6.493-6.492a1 1 0 011.415 0z" clipRule="evenodd" />
                                                                </svg>
                                                                <span>{isSelected ? 'Selected' : selectionLabel}</span>
                                                            </button>
                                                        )}
                                                        {!!video.duration && (
                                                            <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                                                                {video.duration}s
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </>
                        ) : (
                            /* ── Grid layout (admin mode) ── */
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {group.videos.map(video => {
                                    const title = cleanTitle(video.title) || `${group.emoji} ${group.skillLabel}`;
                                    const isPro = video.tags.includes('pro');
                                    const previewSrc = getPreviewVideoSrc(video.url);
                                    const isSelected = selectedVideoUrl === video.url;
                                    return (
                                        <div key={video.id}
                                            className="bg-slate-800 rounded-xl border border-slate-700 hover:border-accent/60 transition-all overflow-hidden flex flex-col"
                                        >
                                            {/* Thumbnail */}
                                            <div
                                                className="relative aspect-video bg-black cursor-pointer group"
                                                onClick={() => {
                                                    const el = videoRefs.current[video.id];
                                                    if (!el) return;
                                                    if (playingId === video.id) {
                                                        el.pause();
                                                        setPlayingId(null);
                                                    } else {
                                                        if (playingId && videoRefs.current[playingId]) {
                                                            videoRefs.current[playingId]!.pause();
                                                        }
                                                        el.currentTime = 0;
                                                        el.play();
                                                        setPlayingId(video.id);
                                                    }
                                                }}
                                            >
                                                <video
                                                    ref={el => { videoRefs.current[video.id] = el; }}
                                                    src={previewSrc}
                                                    className="w-full h-full object-cover transition"
                                                    poster={video.thumbnailUrl || undefined}
                                                    playsInline
                                                    muted
                                                    preload="auto"
                                                    onEnded={() => setPlayingId(null)}
                                                />
                                                <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${playingId === video.id ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                                                    <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                                                        {playingId === video.id ? (
                                                            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                                            </svg>
                                                        ) : (
                                                            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                                                <path d="M8 5v14l11-7z" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                </div>
                                                {isPro && (
                                                    <span className="absolute top-2 left-2 bg-accent text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                                                        PRO
                                                    </span>
                                                )}
                                                {!!video.duration && (
                                                    <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-mono px-2 py-0.5 rounded">
                                                        {video.duration}s
                                                    </span>
                                                )}
                                            </div>

                                            {/* Card body */}
                                            <div className="p-3 flex flex-col flex-1">
                                                <div className="flex items-start justify-between gap-1 mb-1">
                                                    <p className="text-sm font-semibold text-white leading-tight">
                                                        {title}
                                                    </p>
                                                    <span className="shrink-0 text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded uppercase tracking-wide">
                                                        {group.sport}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-500 mb-3">{group.skillLabel}</p>

                                                <div className="mt-auto flex flex-col gap-2">
                                                    {onSelect && isSelectable(video) && (
                                                        <button
                                                            onClick={() => onSelect(video)}
                                                            className="w-full btn btn-primary text-xs py-1.5"
                                                            disabled={isDeleting === video.id}
                                                        >
                                                            {isSelected ? 'Selected' : selectionLabel}
                                                        </button>
                                                    )}
                                                    {showAdminControls && (
                                                        <>
                                                            <button
                                                                onClick={() => setCalibratingVideo(video)}
                                                                className="w-full text-xs py-1.5 rounded-lg border border-blue-900/40 text-blue-400 hover:bg-blue-500/10 transition-colors"
                                                                disabled={isDeleting === video.id}
                                                            >
                                                                {video.phaseTimestamps && Object.keys(video.phaseTimestamps).length > 0
                                                                    ? `✅ Edit Phase Timestamps (${Object.keys(video.phaseTimestamps).length})`
                                                                    : '⏱️ Set Phase Timestamps'}
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(video)}
                                                                className={`w-full text-xs py-1.5 rounded-lg border border-red-900/40 text-red-500 hover:bg-red-500/10 transition-colors ${isDeleting === video.id ? 'opacity-50' : ''}`}
                                                                disabled={isDeleting === video.id}
                                                            >
                                                                {isDeleting === video.id ? 'Deleting...' : '🗑️ Delete Reference'}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Phase calibration modal */}
            {calibratingVideo && (
                <VideoPhaseCalibrator
                    videoUrl={calibratingVideo.url}
                    phaseFields={getPhaseFieldsForVideo(calibratingVideo)}
                    initialTimestamps={calibratingVideo.phaseTimestamps ?? {}}
                    onSave={async (ts) => {
                        const ok = await referenceVideoService.updatePhaseTimestamps(calibratingVideo.id, ts, calibratingVideo.url);
                        const saved = calibratingVideo; // capture before setCalibratingVideo(null)
                        setCalibratingVideo(null);
                        if (ok) {
                            // Update in-place — avoids a re-fetch that can lose the video
                            // if the filter strips it due to missing sport metadata.
                            setVideos(prev => prev.map(v =>
                                v.id === saved.id ? { ...v, phaseTimestamps: ts } : v
                            ));
                            onTimestampsUpdated?.();
                        } else {
                            alert('Failed to save timestamps. Check console.');
                        }
                    }}
                    onClose={() => setCalibratingVideo(null)}
                    title={cleanTitle(calibratingVideo.title)}
                />
            )}
        </>
    );
};
