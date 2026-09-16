/**
 * VideoPhaseCalibrator
 *
 * Full-screen modal for interactively setting phase timestamps:
 *  • Drag-and-drop a video file to load it (or pre-loaded via props)
 *  • Drag the timeline scrubber to seek precisely
 *  • Click a phase chip to make it active, then click "Mark" (or press M/Enter)
 *  • Keyboard: Space=play/pause  ←/→=frame-step  M/Enter=mark  Tab=next phase
 *  • Marked phases appear as colored dots on the timeline scrubber
 *  • Click a dot to jump + activate that phase; click × to clear it
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface PhaseField {
    key: string;
    label: string;
}

interface VideoPhaseCalibrationProps {
    /** Pre-loaded video URL (blob or remote). Can also drop a file inside. */
    videoUrl?: string | null;
    /** Phase definitions for this stroke type */
    phaseFields: PhaseField[];
    /** Existing timestamps to pre-populate */
    initialTimestamps?: Record<string, number>;
    /** Called when admin clicks Save — receives all marked timestamps */
    onSave: (timestamps: Record<string, number>) => void;
    onClose: () => void;
    /** Optional heading context, e.g. "Tennis Forehand" */
    title?: string;
}

// ─── Colour palette for phase markers ────────────────────────────────────────
const PHASE_HEX = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e', '#f43f5e'];
const PHASE_BG = ['bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-green-500', 'bg-rose-500'];
const PHASE_RING = ['ring-blue-500/60', 'ring-purple-500/60', 'ring-amber-500/60', 'ring-green-500/60', 'ring-rose-500/60'];

const hex = (i: number) => PHASE_HEX[i % PHASE_HEX.length];
const bg = (i: number) => PHASE_BG[i % PHASE_BG.length];
const ring = (i: number) => PHASE_RING[i % PHASE_RING.length];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(t: number) {
    if (!isFinite(t) || t < 0) return '0.000s';
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(3).padStart(6, '0');
    return m > 0 ? `${m}:${s}` : `${s}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export const VideoPhaseCalibrator: React.FC<VideoPhaseCalibrationProps> = ({
    videoUrl: initialVideoUrl,
    phaseFields,
    initialTimestamps = {},
    onSave,
    onClose,
    title,
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [videoSrc, setVideoSrc] = useState<string | null>(initialVideoUrl || null);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [activePhaseIdx, setActivePhaseIdx] = useState(0);
    const [timestamps, setTimestamps] = useState<Record<string, number>>(initialTimestamps);
    const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
    const [justMarked, setJustMarked] = useState<string | null>(null);   // flash feedback

    // ── Seeking ─────────────────────────────────────────────────────────────────
    const seekTo = useCallback((t: number) => {
        const v = videoRef.current;
        if (!v) return;
        const clamped = Math.max(0, Math.min(duration || 0, t));
        v.currentTime = clamped;
        setCurrentTime(clamped);
    }, [duration]);

    const seekFromClientX = useCallback((clientX: number) => {
        if (!timelineRef.current || !duration) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        seekTo(pct * duration);
    }, [duration, seekTo]);

    // ── Timeline drag (mouse) ────────────────────────────────────────────────────
    const handleTimelineMouseDown = (e: React.MouseEvent) => {
        setIsDraggingTimeline(true);
        seekFromClientX(e.clientX);
    };

    useEffect(() => {
        if (!isDraggingTimeline) return;
        const onMove = (e: MouseEvent) => seekFromClientX(e.clientX);
        const onUp = () => setIsDraggingTimeline(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isDraggingTimeline, seekFromClientX]);

    // ── Timeline drag (touch) ────────────────────────────────────────────────────
    const handleTimelineTouchStart = (e: React.TouchEvent) => {
        setIsDraggingTimeline(true);
        seekFromClientX(e.touches[0].clientX);
    };

    useEffect(() => {
        if (!isDraggingTimeline) return;
        const onMove = (e: TouchEvent) => { e.preventDefault(); seekFromClientX(e.touches[0].clientX); };
        const onUp = () => setIsDraggingTimeline(false);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
        return () => {
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };
    }, [isDraggingTimeline, seekFromClientX]);

    // ── Marking ──────────────────────────────────────────────────────────────────
    const markActivePhase = useCallback(() => {
        const phase = phaseFields[activePhaseIdx];
        if (!phase || !videoSrc) return;
        setTimestamps(prev => ({ ...prev, [phase.key]: currentTime }));
        setJustMarked(phase.key);
        setTimeout(() => setJustMarked(null), 800);
        // Advance to next un-marked phase
        const nextUnmarked = phaseFields.findIndex(
            (f, i) => i > activePhaseIdx && timestamps[f.key] == null,
        );
        const next = nextUnmarked !== -1 ? nextUnmarked
            : activePhaseIdx < phaseFields.length - 1 ? activePhaseIdx + 1
                : activePhaseIdx;
        setActivePhaseIdx(next);
    }, [activePhaseIdx, currentTime, phaseFields, timestamps, videoSrc]);

    // ── Keyboard shortcuts ───────────────────────────────────────────────────────
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (videoRef.current) {
                        if (isPlaying) videoRef.current.pause();
                        else videoRef.current.play();
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    seekTo(currentTime - (e.shiftKey ? 1 : 1 / 30));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    seekTo(currentTime + (e.shiftKey ? 1 : 1 / 30));
                    break;
                case 'KeyM':
                case 'Enter':
                    e.preventDefault();
                    markActivePhase();
                    break;
                case 'Tab':
                    e.preventDefault();
                    setActivePhaseIdx(i => (i + 1) % phaseFields.length);
                    break;
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [currentTime, isPlaying, seekTo, markActivePhase, phaseFields.length]);

    // ── Video events ─────────────────────────────────────────────────────────────
    const handleTimeUpdate = () => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); };
    const handleLoadedMetadata = () => { if (videoRef.current) setDuration(videoRef.current.duration); };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const togglePlay = () => {
        if (!videoRef.current) return;
        if (isPlaying) videoRef.current.pause(); else videoRef.current.play();
    };

    const setSpeed = (r: number) => {
        setPlaybackRate(r);
        if (videoRef.current) videoRef.current.playbackRate = r;
    };

    // ── File drop ────────────────────────────────────────────────────────────────
    const loadFile = (file: File) => {
        if (!file.type.startsWith('video/')) return;
        if (videoSrc?.startsWith('blob:')) URL.revokeObjectURL(videoSrc);
        setVideoSrc(URL.createObjectURL(file));
        setDuration(0);
        setCurrentTime(0);
        setIsPlaying(false);
    };

    const handleFileDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) loadFile(file);
        e.target.value = '';
    };

    const markedCount = phaseFields.filter(f => timestamps[f.key] != null).length;
    const activePct = duration > 0 ? (currentTime / duration) * 100 : 0;

    // ── Render ───────────────────────────────────────────────────────────────────
    return (
        <div className="fixed inset-0 z-[70] bg-black/96 flex flex-col select-none overflow-hidden" style={{ fontFamily: 'inherit' }}>

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-white leading-tight truncate">
                            Phase Calibration {title ? <span className="text-slate-400 font-normal">— {title}</span> : null}
                        </h2>
                        <p className="text-[11px] text-slate-500">
                            {markedCount}/{phaseFields.length} phases marked
                            {markedCount === phaseFields.length && <span className="ml-2 text-green-400">✓ All set</span>}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                    <span className="hidden sm:block text-[10px] text-slate-600">Space=play · ←/→=frame · M=mark · Tab=next</span>
                    <button onClick={onClose} className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(timestamps)}
                        disabled={markedCount === 0}
                        className="px-4 py-1.5 text-sm bg-green-500 hover:bg-green-400 text-black font-bold rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        Save{markedCount > 0 ? ` (${markedCount})` : ''}
                    </button>
                </div>
            </div>

            {/* ── Body: two columns ── */}
            <div className="flex-1 flex min-h-0 overflow-hidden">

                {/* ── Left column: video + scrubber + transport ── */}
                <div className="flex-1 flex flex-col min-h-0 p-3 gap-2 overflow-hidden">

                    {/* Video — capped height so controls always visible */}
                    <div
                        className={`relative w-full rounded-xl overflow-hidden bg-black border-2 transition-all cursor-pointer shrink-0 ${isDraggingFile ? 'border-green-400 shadow-[0_0_30px_rgba(34,197,94,0.25)]' : 'border-slate-800'
                            }`}
                        style={{ maxHeight: 'calc(100vh - 220px)', aspectRatio: '16/9' }}
                        onDragOver={e => { e.preventDefault(); setIsDraggingFile(true); }}
                        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingFile(false); }}
                        onDrop={handleFileDrop}
                        onClick={videoSrc ? togglePlay : () => fileInputRef.current?.click()}
                    >
                        {videoSrc ? (
                            <video
                                ref={videoRef}
                                src={videoSrc}
                                className="w-full h-full object-contain"
                                onTimeUpdate={handleTimeUpdate}
                                onLoadedMetadata={handleLoadedMetadata}
                                onPlay={handlePlay}
                                onPause={handlePause}
                            />
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 gap-3">
                                <div className="text-4xl opacity-60">🎬</div>
                                <p className="text-white font-semibold text-sm">Drop a video file here</p>
                                <p className="text-slate-500 text-xs">or click to browse</p>
                                <button
                                    onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                    className="mt-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-lg border border-slate-600 transition-colors"
                                >
                                    Browse…
                                </button>
                            </div>
                        )}

                        {isDraggingFile && (
                            <div className="absolute inset-0 bg-green-500/10 flex items-center justify-center pointer-events-none">
                                <div className="text-green-400 text-xl font-bold drop-shadow">Drop video here ↓</div>
                            </div>
                        )}

                        {videoSrc && (
                            <div className="absolute top-2 right-2">
                                <button
                                    onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                    className="px-2 py-1 bg-black/60 hover:bg-black/80 text-slate-300 text-xs rounded-lg backdrop-blur-sm border border-slate-700 transition-colors"
                                    title="Load different video"
                                >
                                    📁 Change
                                </button>
                            </div>
                        )}

                        {videoSrc && !isPlaying && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center text-xl backdrop-blur-sm">▶</div>
                            </div>
                        )}
                    </div>

                    {/* ── Scrubber + transport — always visible, shrink-0 ── */}
                    <div className="bg-slate-900 rounded-xl p-3 shrink-0 space-y-2">

                        {/* Time + scrubber row */}
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-white shrink-0 w-16 text-right">{fmtTime(currentTime)}</span>

                            {/* Timeline */}
                            <div
                                ref={timelineRef}
                                className={`relative flex-1 h-8 rounded-lg overflow-visible cursor-col-resize ${isDraggingTimeline ? 'cursor-grabbing' : ''}`}
                                style={{ background: '#1e293b' }}
                                onMouseDown={handleTimelineMouseDown}
                                onTouchStart={handleTimelineTouchStart}
                            >
                                {/* Progress fill */}
                                <div
                                    className="absolute top-0 left-0 h-full rounded-l-lg pointer-events-none"
                                    style={{ width: `${activePct}%`, background: 'rgba(255,255,255,0.08)' }}
                                />

                                {/* Phase marker dots */}
                                {duration > 0 && phaseFields.map((f, i) => {
                                    const ts = timestamps[f.key];
                                    if (ts == null) return null;
                                    const leftPct = (ts / duration) * 100;
                                    const isActive = activePhaseIdx === i;
                                    return (
                                        <div
                                            key={`dot-${f.key}`}
                                            className="absolute top-0 h-full flex items-center pointer-events-auto"
                                            style={{ left: `${leftPct}%`, transform: 'translateX(-50%)', zIndex: 10 }}
                                            onClick={e => { e.stopPropagation(); seekTo(ts); setActivePhaseIdx(i); }}
                                            title={`${f.label}: ${fmtTime(ts)}`}
                                        >
                                            <div className="absolute top-0 w-0.5 h-full opacity-50" style={{ background: hex(i) }} />
                                            <div
                                                className={`w-3.5 h-3.5 rounded-full border-2 border-black cursor-pointer transition-transform hover:scale-125 ${isActive ? 'scale-125' : ''}`}
                                                style={{ background: hex(i) }}
                                            />
                                            <div
                                                className="absolute bottom-full mb-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold px-1 py-0.5 rounded pointer-events-none"
                                                style={{ background: hex(i), color: '#000' }}
                                            >
                                                {f.label.split(' ').map((w: string) => w[0]).join('')}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Playhead */}
                                <div
                                    className="absolute top-0 h-full pointer-events-none"
                                    style={{ left: `${activePct}%`, transform: 'translateX(-50%)', zIndex: 20 }}
                                >
                                    <div className="w-0.5 h-full bg-white opacity-90" />
                                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-md" />
                                </div>
                            </div>

                            <span className="font-mono text-xs text-slate-500 shrink-0 w-14">{duration > 0 ? fmtTime(duration) : '—'}</span>
                        </div>

                        {/* Transport + Mark — all on one row */}
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => seekTo(currentTime - 1 / 30)} className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded font-mono transition-colors shrink-0" title="Prev frame (←)">◀1f</button>
                            <button
                                onClick={togglePlay}
                                disabled={!videoSrc}
                                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-xs font-medium rounded min-w-[64px] transition-colors shrink-0"
                            >
                                {isPlaying ? '⏸ Pause' : '▶ Play'}
                            </button>
                            <button onClick={() => seekTo(currentTime + 1 / 30)} className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded font-mono transition-colors shrink-0" title="Next frame (→)">1f▶</button>

                            <div className="flex gap-1 shrink-0">
                                {([0.1, 0.25, 0.5, 1] as const).map(r => (
                                    <button
                                        key={r}
                                        onClick={() => setSpeed(r)}
                                        className={`px-1.5 py-1.5 text-[11px] rounded font-mono transition-colors ${playbackRate === r ? 'bg-green-500/80 text-black font-bold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                            }`}
                                    >
                                        {r}×
                                    </button>
                                ))}
                            </div>

                            {/* ── Mark button — right here next to transport ── */}
                            {videoSrc ? (
                                <button
                                    onClick={markActivePhase}
                                    className="flex-1 ml-1 py-1.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] min-w-0 truncate"
                                    style={{ background: hex(activePhaseIdx), color: '#000' }}
                                >
                                    <span className="shrink-0">📌</span>
                                    <span className="truncate">
                                        Mark "{phaseFields[activePhaseIdx]?.label}"
                                        <span className="font-normal opacity-75 ml-1 text-xs">@ {fmtTime(currentTime)}</span>
                                    </span>
                                </button>
                            ) : (
                                <div className="flex-1 ml-1 py-1.5 rounded-lg text-center text-xs text-slate-600 bg-slate-800/40">Load a video to begin</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Right column: phase status panel ── */}
                <div className="shrink-0 w-52 flex flex-col border-l border-slate-800 bg-slate-950 min-h-0">
                    <div className="px-3 py-2 border-b border-slate-800 shrink-0">
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Phases</p>
                    </div>

                    {/* Phase list */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                        {phaseFields.map((f, i) => {
                            const ts = timestamps[f.key];
                            const isActive = activePhaseIdx === i;
                            const wasJust = justMarked === f.key;
                            return (
                                <div
                                    key={f.key}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => { setActivePhaseIdx(i); if (ts != null) seekTo(ts); }}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActivePhaseIdx(i); if (ts != null) seekTo(ts); } }}
                                    className={[
                                        'w-full text-left px-2.5 py-2 rounded-lg transition-all flex items-center gap-2 group cursor-pointer',
                                        isActive ? `bg-slate-800 ring-1 ${ring(i)}` : 'hover:bg-slate-800/50',
                                    ].join(' ')}
                                >
                                    <div
                                        className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${isActive ? 'scale-125' : ''}`}
                                        style={{ background: ts != null ? hex(i) : '#334155' }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-xs font-semibold truncate ${isActive ? 'text-white' : 'text-slate-400'}`}>{f.label}</div>
                                        {ts != null ? (
                                            <div className="text-[10px] font-mono" style={{ color: hex(i) }}>
                                                {fmtTime(ts)}{wasJust && <span className="ml-1 text-green-400">✓</span>}
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-slate-600">{isActive ? '← mark now' : 'not set'}</div>
                                        )}
                                    </div>
                                    {ts != null && (
                                        <button
                                            onClick={e => { e.stopPropagation(); setTimestamps(prev => { const n = { ...prev }; delete n[f.key]; return n; }); }}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-slate-600 rounded text-xs transition-opacity"
                                            title="Clear"
                                        >×</button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-2.5 border-t border-slate-800 shrink-0">
                        <p className="text-[10px] text-slate-600 text-center leading-relaxed">
                            <kbd className="px-1 bg-slate-800 rounded text-slate-400">M</kbd> mark ·{' '}
                            <kbd className="px-1 bg-slate-800 rounded text-slate-400">Tab</kbd> next ·{' '}
                            <kbd className="px-1 bg-slate-800 rounded text-slate-400">←/→</kbd> frame
                        </p>
                    </div>
                </div>
            </div>

            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileInput} />
        </div>
    );
};
