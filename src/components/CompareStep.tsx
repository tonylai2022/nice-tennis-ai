import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrimRange } from '../types/app';
import type { PoseResult } from '../services/MotionAnalysisRouter';
import type { FreeFeedback } from '../services/coaching/FreeTennisCoach';
import { useVideoExport } from '../hooks/useVideoExport';

// ── Skeleton drawing helpers ──────────────────────────────────────────────────

const CONNECTIONS: [number, number][] = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28],
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
];

function drawSkeleton(
    ctx: CanvasRenderingContext2D,
    landmarks: { x: number; y: number; visibility?: number }[],
    xOff: number, yOff: number, w: number, h: number,
    color: 'emerald' | 'rose',
) {
    ctx.save();
    ctx.strokeStyle = color === 'emerald' ? '#10b981' : '#f43f5e';
    ctx.fillStyle = color === 'emerald' ? '#34d399' : '#fb7185';
    ctx.lineWidth = Math.max(1.5, w * 0.004);
    for (const [a, b] of CONNECTIONS) {
        const la = landmarks[a]; const lb = landmarks[b];
        if (!la || !lb) continue;
        if ((la.visibility ?? 1) < 0.3 || (lb.visibility ?? 1) < 0.3) continue;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(xOff + la.x * w, yOff + la.y * h);
        ctx.lineTo(xOff + lb.x * w, yOff + lb.y * h);
        ctx.stroke();
    }
    const r = Math.max(3, w * 0.008);
    for (let i = 0; i < Math.min(landmarks.length, 33); i++) {
        const lm = landmarks[i];
        if (!lm || (lm.visibility ?? 1) < 0.3) continue;
        ctx.globalAlpha = Math.min(1, (lm.visibility ?? 1) + 0.2);
        ctx.beginPath();
        ctx.arc(xOff + lm.x * w, yOff + lm.y * h, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function findNearestFrame(frames: PoseResult[], time: number) {
    if (!frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].timestamp < time) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(frames[lo - 1].timestamp - time) < Math.abs(frames[lo].timestamp - time)) return frames[lo - 1];
    return frames[lo];
}

/** Linearly interpolate a pose frame between the two frames surrounding `time`.
 *  Falls back to nearest-neighbour when outside the recorded range or when
 *  the two surrounding frames are more than 500 ms apart (e.g. scene cut). */
function interpolateFrame(frames: PoseResult[], time: number): PoseResult | null {
    if (!frames.length) return null;
    if (frames.length === 1) return frames[0];

    // Binary search for the first frame at or after `time`
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].timestamp < time) lo = mid + 1;
        else hi = mid;
    }

    // Clamp to recorded range
    if (lo === 0) return frames[0];
    if (lo >= frames.length) return frames[frames.length - 1];

    const before = frames[lo - 1];
    const after = frames[lo];
    const span = after.timestamp - before.timestamp;
    // Don't interpolate across large gaps (scene cuts / sparse samples)
    if (span <= 0 || span > 0.5) return findNearestFrame(frames, time);

    const alpha = (time - before.timestamp) / span;
    const lerpLm = before.landmarks?.map((lmA, i) => {
        const lmB = after.landmarks?.[i];
        if (!lmA || !lmB) return lmA ?? lmB;
        return {
            x: lmA.x + (lmB.x - lmA.x) * alpha,
            y: lmA.y + (lmB.y - lmA.y) * alpha,
            z: (lmA.z ?? 0) + ((lmB.z ?? 0) - (lmA.z ?? 0)) * alpha,
            visibility: Math.min(lmA.visibility ?? 1, lmB.visibility ?? 1),
        };
    }) ?? null;

    return { ...before, timestamp: time, landmarks: lerpLm };
}

/** Draw a video onto the canvas panel using object-fit:contain logic (no cropping).
 *  Keeps the entire frame visible and returns the scaled rect for skeleton alignment. */
function drawVideoContain(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    px: number, py: number, pw: number, ph: number,
): { x: number; y: number; w: number; h: number } {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // If dimensions are not yet decoded, return the full panel rect but don't draw.
    // Using pw/ph as fallback produces a completely wrong contain-fit rect for portrait
    // videos in landscape panels, causing skeleton joints to land on incorrect pixels.
    if (!vw || !vh) return { x: px, y: py, w: pw, h: ph };
    const scale = Math.min(pw / vw, ph / vh); // contain: fit whole frame
    const dw = vw * scale, dh = vh * scale;
    const dx = px + (pw - dw) / 2, dy = py + (ph - dh) / 2;
    if (video.readyState >= 2) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, pw, ph);
        ctx.clip();
        ctx.drawImage(video, dx, dy, dw, dh);
        ctx.restore();
    }
    return { x: dx, y: dy, w: dw, h: dh };
}

// ── Racket tracking helpers ─────────────────────────────────────────────────

function estimateRacketHead(
    landmarks: { x: number; y: number; visibility?: number }[],
    xOff: number, yOff: number, w: number, h: number,
): { x: number; y: number } | null {
    const lw = landmarks[15], rw = landmarks[16];
    const le = landmarks[13], re = landmarks[14];
    const lhip = landmarks[23], rhip = landmarks[24];
    const hipCx = lhip && rhip ? (lhip.x + rhip.x) / 2 : 0.5;
    const hipCy = lhip && rhip ? (lhip.y + rhip.y) / 2 : 0.5;
    const lVis = (lw?.visibility ?? 0) >= 0.3;
    const rVis = (rw?.visibility ?? 0) >= 0.3;
    const ldist = lVis && lw ? Math.hypot(lw.x - hipCx, lw.y - hipCy) : 0;
    const rdist = rVis && rw ? Math.hypot(rw.x - hipCx, rw.y - hipCy) : 0;
    let wrist: typeof lw, elbow: typeof le;
    if (rdist >= ldist && rVis && rw && re && (re.visibility ?? 0) >= 0.3) {
        wrist = rw; elbow = re;
    } else if (lVis && lw && le && (le.visibility ?? 0) >= 0.3) {
        wrist = lw; elbow = le;
    } else {
        return null;
    }
    const dx = wrist.x - elbow.x;
    const dy = wrist.y - elbow.y;
    return { x: xOff + (wrist.x + dx * 1.4) * w, y: yOff + (wrist.y + dy * 1.4) * h };
}

function drawRacketTrail(
    ctx: CanvasRenderingContext2D,
    trail: { x: number; y: number }[],
    color: string,
): void {
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
        const t = i / trail.length;
        ctx.globalAlpha = t * 0.8;
        ctx.lineWidth = 1.5 + t * 2.5;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
    }
    const tip = trail[trail.length - 1];
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** Seek a video element to `targetTime` then, if `resumePlay` is true, resume
 *  playback only AFTER the 'seeked' event fires.
 *  On iOS Safari, calling play() immediately after setting currentTime is rejected
 *  with AbortError because the seek is still pending. */
function seekAndResume(v: HTMLVideoElement, targetTime: number, resumePlay: boolean) {
    v.currentTime = targetTime;
    if (!resumePlay) return;
    let done = false;
    const go = () => {
        if (done) return;
        done = true;
        v.play().catch(() => { });
    };
    v.addEventListener('seeked', go, { once: true });
    // Fallback: 'seeked' may never fire on some mobile browsers
    setTimeout(() => { v.removeEventListener('seeked', go); go(); }, 400);
}

// ── Contact-frame detection ───────────────────────────────────────────────────

/** Seconds of pre-contact footage to show before ball contact on each replay. */
const PRE_CONTACT_LEAD = 1.0;

/**
 * Find the timestamp (seconds) of ball contact inside the trimmed window.
 * Uses peak wrist speed as a proxy — the wrist accelerates to maximum
 * velocity at the moment of contact for all common strokes.
 * Falls back to 60% of trim duration if detection fails.
 */
function findContactTimestamp(
    frames: PoseResult[],
    trimStart: number,
    trimEnd: number,
): number {
    const fallback = trimStart + (trimEnd - trimStart) * 0.6;
    const trimmed = frames.filter(f => f.timestamp >= trimStart && f.timestamp <= trimEnd);
    if (trimmed.length < 3) return fallback;
    let maxSpeed = -1, contactTime = fallback;
    for (let i = 1; i < trimmed.length; i++) {
        const prev = trimmed[i - 1], curr = trimmed[i];
        const dt = curr.timestamp - prev.timestamp;
        if (dt <= 0) continue;
        const pw = prev.landmarks?.[16] ?? prev.landmarks?.[15];
        const cw = curr.landmarks?.[16] ?? curr.landmarks?.[15];
        if (!pw || !cw) continue;
        const speed = Math.sqrt((cw.x - pw.x) ** 2 + (cw.y - pw.y) ** 2) / dt;
        if (speed > maxSpeed) { maxSpeed = speed; contactTime = curr.timestamp; }
    }
    return contactTime;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CompareStepProps {
    sport: 'tennis';
    motionType: string;
    referenceUrl: string | null;
    userUrl: string | null;
    referenceDuration: number;
    referenceTrim: TrimRange;
    userDuration: number;
    userTrim: TrimRange;
    refVideoRef: React.RefObject<HTMLVideoElement>;
    userVideoRef: React.RefObject<HTMLVideoElement>;
    isPlaying: boolean;
    onTogglePlayback: () => void;
    onReplay: () => void;
    canAnalyze?: boolean;
    isAnalyzing?: boolean;
    onAnalyze?: () => void;
    onBack: () => void;
    onReport?: () => void;
    refPoseFrames?: PoseResult[] | null;
    userPoseFrames?: PoseResult[] | null;
    isProcessingPose?: boolean;
    showSkeleton?: boolean;
    onSkeletonToggle?: (v: boolean) => void;
    freeFeedback?: FreeFeedback | null;
    exportLang?: 'en' | 'zhSimp' | 'zhTrad';
}

export function CompareStep({
    sport,
    motionType,
    referenceUrl,
    userUrl,
    referenceDuration,
    referenceTrim,
    userDuration,
    userTrim,
    refVideoRef,
    userVideoRef,
    isPlaying,
    onTogglePlayback,
    onReplay,
    onBack,
    onReport,
    refPoseFrames,
    userPoseFrames,
    showSkeleton = true,
    onSkeletonToggle,
    freeFeedback,
    exportLang = 'en',
}: CompareStepProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);
    const logoRef = useRef<HTMLImageElement | null>(null);
    const { isExporting, progress, triggerExport } = useVideoExport();

    // lang is driven by the exportLang prop (set on the reference/upload page)
    const lang = exportLang;
    const langRef = useRef<'en' | 'zhSimp' | 'zhTrad'>('en');
    langRef.current = lang;

    // ── Contact-aligned start times ───────────────────────────────────────────
    // Both videos seek to 1 second before their respective contact frame,
    // so PRO and USER display the same phase of the stroke in sync.
    const refSyncStart = useMemo(() => {
        if (!refPoseFrames?.length || !referenceDuration) return referenceTrim.start * referenceDuration;
        const contact = findContactTimestamp(
            refPoseFrames,
            referenceTrim.start * referenceDuration,
            referenceTrim.end * referenceDuration,
        );
        return Math.max(referenceTrim.start * referenceDuration, contact - PRE_CONTACT_LEAD);
    }, [refPoseFrames, referenceTrim, referenceDuration]);

    const userSyncStart = useMemo(() => {
        if (!userPoseFrames?.length || !userDuration) return userTrim.start * userDuration;
        const contact = findContactTimestamp(
            userPoseFrames,
            userTrim.start * userDuration,
            userTrim.end * userDuration,
        );
        return Math.max(userTrim.start * userDuration, contact - PRE_CONTACT_LEAD);
    }, [userPoseFrames, userTrim, userDuration]);

    // Seek to sync start whenever it is computed (pose frames arrive) — only when paused
    useEffect(() => {
        const rv = refVideoRef.current;
        if (rv && rv.readyState >= 1 && !isPlaying) rv.currentTime = refSyncStart;
    }, [refSyncStart]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const uv = userVideoRef.current;
        if (uv && uv.readyState >= 1 && !isPlaying) uv.currentTime = userSyncStart;
    }, [userSyncStart]); // eslint-disable-line react-hooks/exhaustive-deps

    // Pre-load the tennis logo once
    useEffect(() => {
        const img = new Image();
        img.src = '/images/NT_logo.png';
        img.onload = () => { logoRef.current = img; };
    }, []);

    // ── Compositing loop ──────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const refTrail: { x: number; y: number }[] = [];
        const userTrail: { x: number; y: number }[] = [];
        let refLastT = -1;
        let userLastT = -1;
        const TRAIL_MAX = 30;

        const draw = () => {
            const refVid = refVideoRef.current;
            const userVid = userVideoRef.current;

            // Read actual rendered width — CSS already caps at 430px via max-w-[430px]
            const W = canvas.clientWidth || 320;
            const H = canvas.clientHeight || 568;
            if (canvas.width !== W || canvas.height !== H) {
                canvas.width = W;
                canvas.height = H;
            }

            // Pre-compute logo (watermark only — no longer affects bullet layout)
            const logo = logoRef.current;

            const tipSz = Math.max(11, W * 0.03);
            // Strict 40/40/20 layout: PRO / USER / FEEDBACK
            const dividerH = 2;
            const refPanelY = 0;
            const refPanelH = Math.floor(H * 0.4);
            const userPanelY = refPanelH;
            const userPanelH = Math.floor(H * 0.4);
            const feedBarY = userPanelY + userPanelH;
            const feedBarH = H - feedBarY;

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);

            // Draw frames contain-fit (full frame visible, no cropping)
            const refB = refVid ? drawVideoContain(ctx, refVid, 0, refPanelY, W, refPanelH) : { x: 0, y: refPanelY, w: W, h: refPanelH };
            const userB = userVid ? drawVideoContain(ctx, userVid, 0, userPanelY, W, userPanelH) : { x: 0, y: userPanelY, w: W, h: userPanelH };

            // Divider between PRO and USER panels
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, refPanelY + refPanelH - 1, W, dividerH);
            // Divider between USER and FEEDBACK panels
            ctx.fillRect(0, feedBarY - 1, W, dividerH);

            // Panel labels — match export: alpha 0.65, fixed 11px, position (7, Y+13)
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, refPanelY, 140, 20);
            ctx.fillRect(0, userPanelY, 130, 20);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'left';
            ctx.font = 'bold 11px system-ui,sans-serif';
            ctx.fillStyle = '#34d399';
            ctx.fillText('PRO REFERENCE', 7, refPanelY + 13);
            ctx.fillStyle = '#fb7185';
            ctx.fillText('YOUR ATTEMPT', 7, userPanelY + 13);

            // Skeletons — only draw when videoWidth is known so contain-fit rect is accurate.
            // Without this guard, portrait user videos (0 videoWidth during initial load)
            // produce a full-panel fallback rect and joints appear offset.
            if (showSkeleton) {
                const rFrame = refPoseFrames?.length && refVid?.videoWidth
                    ? interpolateFrame(refPoseFrames, refVid.currentTime) : null;
                const uFrame = userPoseFrames?.length && userVid?.videoWidth
                    ? interpolateFrame(userPoseFrames, userVid.currentTime) : null;
                if (rFrame?.landmarks) drawSkeleton(ctx, rFrame.landmarks, refB.x, refB.y, refB.w, refB.h, 'emerald');
                if (uFrame?.landmarks) drawSkeleton(ctx, uFrame.landmarks, userB.x, userB.y, userB.w, userB.h, 'rose');
            }

            // Racket trails — always rendered for comparison
            {
                const rFrame = refPoseFrames?.length && refVid?.videoWidth
                    ? findNearestFrame(refPoseFrames, refVid.currentTime) : null;
                const uFrame = userPoseFrames?.length && userVid?.videoWidth
                    ? findNearestFrame(userPoseFrames, userVid.currentTime) : null;
                const refNow = refVid?.currentTime ?? 0;
                const userNow = userVid?.currentTime ?? 0;
                if (Math.abs(refNow - refLastT) > 0.5) refTrail.length = 0;
                if (Math.abs(userNow - userLastT) > 0.5) userTrail.length = 0;
                refLastT = refNow;
                userLastT = userNow;
                if (rFrame?.landmarks) {
                    const pt = estimateRacketHead(rFrame.landmarks, refB.x, refB.y, refB.w, refB.h);
                    if (pt) { refTrail.push(pt); if (refTrail.length > TRAIL_MAX) refTrail.shift(); }
                }
                if (uFrame?.landmarks) {
                    const pt = estimateRacketHead(uFrame.landmarks, userB.x, userB.y, userB.w, userB.h);
                    if (pt) { userTrail.push(pt); if (userTrail.length > TRAIL_MAX) userTrail.shift(); }
                }
                drawRacketTrail(ctx, refTrail, '#34d399');
                drawRacketTrail(ctx, userTrail, '#fb7185');

            }

            // Feedback area — always bottom 20%
            if (feedBarH > 30) {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, feedBarY, W, feedBarH);

                // Header line
                ctx.textAlign = 'left';
                ctx.font = 'bold 13px system-ui,sans-serif';
                ctx.fillStyle = '#e2e8f0';
                ctx.fillText('Feedback', 12, feedBarY + 34);

                // 2-column, 3-row bullet layout
                const halfW = W / 2;
                const colMaxW = halfW - 36;
                ctx.font = `${tipSz}px system-ui,sans-serif`;
                (freeFeedback?.tips ?? []).slice(0, 6).forEach((tip, idx) => {
                    const col = Math.floor(idx / 3);
                    const row = idx % 3;
                    const dotX = col === 0 ? 12 : halfW + 8;
                    const txtX = col === 0 ? 26 : halfW + 22;
                    const bY = feedBarY + 52 + row * 20;
                    if (bY > feedBarY + feedBarH - 10) return;
                    const l = lang;
                    const raw = l === 'zhSimp'
                        ? (tip.shortZhSimp || tip.short || tip.detail)
                        : l === 'zhTrad'
                            ? (tip.shortZhTrad || tip.short || tip.detail)
                            : (tip.short || tip.detail);
                    ctx.fillStyle = '#34d399';
                    ctx.fillText('•', dotX, bY);
                    ctx.fillStyle = '#e2e8f0';
                    let txt = raw;
                    while (ctx.measureText(txt).width > colMaxW && txt.length > 8) txt = txt.slice(0, -1);
                    if (txt.length < raw.length) txt = txt.trimEnd() + '…';
                    ctx.fillText(txt, txtX, bY);
                });
                // Center watermark logo over the video panels
                if (logo) {
                    const wmH = Math.round(W * 0.22);
                    const wmW = Math.round(wmH * (logo.naturalWidth / (logo.naturalHeight || 1)));
                    ctx.globalAlpha = 0.28;
                    ctx.drawImage(logo, (W - wmW) / 2, (feedBarY - wmH) / 2, wmW, wmH);
                    ctx.globalAlpha = 1;
                    // Corner logo — bottom-right of feedback bar
                    const cornerH = Math.min(feedBarH - 8, 52);
                    const cornerW = Math.round(cornerH * (logo.naturalWidth / (logo.naturalHeight || 1)));
                    ctx.drawImage(logo, W - cornerW - 8, H - cornerH - 4, cornerW, cornerH);
                }
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [refVideoRef, userVideoRef, refPoseFrames, userPoseFrames, showSkeleton, freeFeedback, lang]);

    // ── Trim loop-back ────────────────────────────────────────────────────────
    const handleRefTimeUpdate = useCallback(() => {
        const v = refVideoRef.current;
        if (!v || !referenceDuration) return;
        if (v.currentTime >= referenceTrim.end * referenceDuration) {
            seekAndResume(v, refSyncStart, !v.paused);
        }
    }, [refVideoRef, referenceDuration, referenceTrim, refSyncStart]);

    const handleUserTimeUpdate = useCallback(() => {
        const v = userVideoRef.current;
        if (!v || !userDuration) return;
        if (v.currentTime >= userTrim.end * userDuration) {
            seekAndResume(v, userSyncStart, !v.paused);
        }
    }, [userVideoRef, userDuration, userTrim, userSyncStart]);

    // Local replay — seeks both videos to contact-aligned starts
    const handleInternalReplay = useCallback(() => {
        const rv = refVideoRef.current;
        const uv = userVideoRef.current;
        if (rv) seekAndResume(rv, refSyncStart, isPlaying);
        if (uv) seekAndResume(uv, userSyncStart, isPlaying);
    }, [refVideoRef, userVideoRef, refSyncStart, userSyncStart, isPlaying]);

    const handleDownload = () => {
        if (!referenceUrl || !userUrl || !freeFeedback) return;
        // Pause the compare-page video elements before starting the export.
        // The export creates its own video elements with the same URLs. On mobile,
        // 4 simultaneous video decoders (2 compare + 2 export) hit the browser limit
        // causing the user video (blob URL) decoder to stall and appear frozen.
        refVideoRef.current?.pause();
        userVideoRef.current?.pause();
        triggerExport({
            refVideoUrl: referenceUrl,
            userVideoUrl: userUrl,
            refPoseFrames: refPoseFrames ?? null,
            userPoseFrames: userPoseFrames ?? null,
            referenceTrim,
            userTrim,
            referenceDuration,
            userDuration,
            feedback: freeFeedback,
            motionType,
            sport,
            showSkeleton,
            lang,
        }, `${motionType}-comparison.mp4`);
    };

    return (
        /* Full-screen overlay. Responsive to desktop and mobile. */
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
            {/* Responsive container — full width on mobile, scaled on desktop */}
            <div className="relative flex flex-col w-full md:w-[90vw] lg:w-[80vw] xl:w-[1000px] h-full flex-shrink-0">
                {/* Hidden videos that drive playback; canvas reads their frames.
                     Use off-screen positioning rather than sr-only/clip:rect(0,0,0,0).
                     iOS Safari can refuse to play clipped/invisible video elements. */}
                <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', pointerEvents: 'none', opacity: 0 }} aria-hidden>
                    {referenceUrl && (
                        <video ref={refVideoRef} src={referenceUrl} muted playsInline preload="auto"
                            onLoadedMetadata={() => {
                                const v = refVideoRef.current;
                                if (v && referenceDuration > 0) seekAndResume(v, refSyncStart, false);
                            }}
                            onTimeUpdate={handleRefTimeUpdate}
                            onEnded={() => {
                                const v = refVideoRef.current;
                                if (!v) return;
                                seekAndResume(v, refSyncStart, isPlaying);
                            }}
                        />
                    )}
                    {userUrl && (
                        <video ref={userVideoRef} src={userUrl} muted playsInline preload="auto"
                            onLoadedMetadata={() => {
                                const v = userVideoRef.current;
                                if (v && userDuration > 0) seekAndResume(v, userSyncStart, false);
                            }}
                            onTimeUpdate={handleUserTimeUpdate}
                            onEnded={() => {
                                const v = userVideoRef.current;
                                if (!v) return;
                                seekAndResume(v, userSyncStart, isPlaying);
                            }}
                        />
                    )}
                </div>

                {/* Canvas — takes all available height */}
                <canvas ref={canvasRef} className="flex-1 w-full block min-h-0 mx-auto" style={{ touchAction: 'none' }} />

                {/* Minimal controls bar */}
                <div className="flex-none bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 px-3 py-2">
                    <div className="flex items-center gap-2">
                        <button
                            className="flex-none rounded-lg bg-slate-800 text-slate-300 px-3 py-2 text-sm"
                            onClick={onBack}
                        >← Back</button>
                        <button
                            className="flex-none rounded-lg bg-slate-800 text-slate-300 px-3 py-2 text-sm"
                            onClick={handleInternalReplay}
                            disabled={!referenceUrl || !userUrl}
                        >↺</button>
                        <button
                            className="flex-1 rounded-lg bg-slate-700 text-white px-3 py-2 text-sm"
                            onClick={onTogglePlayback}
                            disabled={!referenceUrl || !userUrl}
                        >{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
                        <button
                            className={`flex-none rounded-lg px-3 py-2 text-sm transition-colors ${showSkeleton ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-500'
                                }`}
                            onClick={() => onSkeletonToggle?.(!showSkeleton)}
                            title={showSkeleton ? 'Hide skeleton' : 'Show skeleton'}
                        >🦴</button>
                        {freeFeedback && onReport && (
                            <button
                                className="flex-none rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 text-sm"
                                onClick={onReport}
                                title="Generate full shot analysis report"
                            >📊 Report</button>
                        )}
                        {freeFeedback && (
                            <button
                                className="flex-none rounded-lg bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50"
                                onClick={handleDownload}
                                disabled={isExporting}
                            >{isExporting ? `${Math.round(progress)}%` : '⬇ Save'}</button>
                        )}
                    </div>
                </div>
            </div>{/* end responsive container */}
        </div>
    );
}
