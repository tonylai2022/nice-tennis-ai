import type { PoseResult } from './MotionAnalysisRouter';
import type { TrimRange } from '../types/app';
import type { FreeFeedback } from './coaching/FreeTennisCoach';
import { clampTrimRange } from '../lib/videoHelpers';



// ── Skeleton drawing ──────────────────────────────────────────────────────────

const CONNECTIONS: [number, number][] = [
    // face
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
    // torso
    [11, 12], [11, 23], [12, 24], [23, 24],
    // arms
    [11, 13], [13, 15], [12, 14], [14, 16],
    // legs
    [23, 25], [25, 27], [24, 26], [26, 28],
];

function drawSkeleton(
    ctx: CanvasRenderingContext2D,
    landmarks: { x: number; y: number; visibility?: number }[],
    xOff: number,
    yOff: number,
    w: number,
    h: number,
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
    const rFace = Math.max(1.5, w * 0.004);
    for (let i = 0; i <= 28; i++) {
        const lm = landmarks[i];
        if (!lm || (lm.visibility ?? 1) < 0.3) continue;
        ctx.globalAlpha = Math.min(1, (lm.visibility ?? 1) + 0.2);
        ctx.beginPath();
        ctx.arc(xOff + lm.x * w, yOff + lm.y * h, i <= 10 ? rFace : r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function findNearest(frames: PoseResult[], time: number): PoseResult | null {
    if (!frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].timestamp < time) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(frames[lo - 1].timestamp - time) < Math.abs(frames[lo].timestamp - time)) {
        return frames[lo - 1];
    }
    return frames[lo];
}

/** Linearly interpolate a pose frame between the two frames surrounding `time`.
 *  Falls back to nearest-neighbour when outside the recorded range or when
 *  the two surrounding frames are more than 500 ms apart (e.g. scene cut). */
function interpolateNearest(frames: PoseResult[], time: number): PoseResult | null {
    if (!frames.length) return null;
    if (frames.length === 1) return frames[0];

    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].timestamp < time) lo = mid + 1;
        else hi = mid;
    }

    if (lo === 0) return frames[0];
    if (lo >= frames.length) return frames[frames.length - 1];

    const before = frames[lo - 1];
    const after = frames[lo];
    const span = after.timestamp - before.timestamp;
    if (span <= 0 || span > 0.5) return findNearest(frames, time);

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

// ── Racket trail helpers ──────────────────────────────────────────────────────

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

// ── Video helpers ─────────────────────────────────────────────────────────────

function loadVideoEl(url: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        // Only set CORS for non-blob/data URLs (Supabase storage etc.)
        if (!url.startsWith('blob:') && !url.startsWith('data:')) {
            v.crossOrigin = 'anonymous';
        }
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        // Wait for onloadeddata (first frame decoded) rather than onloadedmetadata.
        // On mobile, videoWidth/videoHeight are often still 0 at metadata stage,
        // which causes drawVideoContainExport to compute the wrong letterbox rect
        // and the skeleton joints to be mis-placed on the first frames.
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(v); } };
        v.onloadeddata = finish;
        // Fallback: if onloadeddata never fires (some mobile codecs), resolve at metadata
        v.onloadedmetadata = () => window.setTimeout(finish, 50);
        v.onerror = () => { if (!settled) { settled = true; reject(new Error('Failed to load video')); } };
        v.src = url;
        v.load();
    });
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
    const targetTime = Math.max(0, Math.min(t, Math.max(0, (v.duration || t) - 0.05)));
    if (Math.abs(v.currentTime - targetTime) < 0.05) return Promise.resolve();

    return new Promise(resolve => {
        let done = false;

        const cleanup = () => {
            v.removeEventListener('seeked', onSeeked);
            v.removeEventListener('error', onError);
        };

        const finish = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
        };

        const onSeeked = () => finish();
        const onError = () => finish();

        v.addEventListener('seeked', onSeeked);
        v.addEventListener('error', onError);

        window.setTimeout(() => {
            if (done) return;
            if (!v.seeking && Math.abs(v.currentTime - targetTime) < 0.08) {
                finish();
                return;
            }
            finish();
        }, 1500);

        try {
            v.currentTime = targetTime;
        } catch {
            finish();
        }
    });
}

function pickMimeType(): string {
    // Android Chrome: mp4 often crashes mid-recording even when isTypeSupported returns true.
    // Use webm on Android; prefer mp4 only on desktop/iOS where it's reliable.
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) {
        if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) return 'video/mp4;codecs=avc1';
        if (MediaRecorder.isTypeSupported('video/mp4')) return 'video/mp4';
    }
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
    if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
    return '';
}

/** Contain-fit a video into a rect (no cropping, whole frame visible). */
function drawVideoContainExport(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    px: number, py: number, pw: number, ph: number,
): { x: number; y: number; w: number; h: number } {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // If dimensions aren't loaded yet, return the panel rect without drawing.
    // Falling back to pw/ph produces a wrong contain-fit rect (e.g. for 16:9
    // landscape video in a portrait panel) and places skeleton joints incorrectly.
    if (!vw || !vh) return { x: px, y: py, w: pw, h: ph };
    const scale = Math.min(pw / vw, ph / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = px + (pw - dw) / 2, dy = py + (ph - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.drawImage(video, dx, dy, dw, dh);
    ctx.restore();
    return { x: dx, y: dy, w: dw, h: dh };
}

/** Wrap text to lines fitting maxWidth. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
}



// ── Public API ────────────────────────────────────────────────────────────────

export interface ExportOptions {
    refVideoUrl: string;
    userVideoUrl: string;
    refPoseFrames: PoseResult[] | null;
    userPoseFrames: PoseResult[] | null;
    referenceTrim: TrimRange;
    userTrim: TrimRange;
    referenceDuration: number;
    userDuration: number;
    feedback: FreeFeedback;
    motionType: string;
    sport: 'tennis';
    showSkeleton?: boolean;
    lang?: 'en' | 'zhSimp' | 'zhTrad';
    onProgress?: (pct: number) => void;
}

export class VideoExportService {
    static async export(opts: ExportOptions): Promise<Blob> {
        const {
            refVideoUrl, userVideoUrl,
            refPoseFrames, userPoseFrames,
            referenceTrim, userTrim,
            referenceDuration, userDuration,
            feedback, motionType, sport, showSkeleton = true, lang = 'en', onProgress,
        } = opts;

        onProgress?.(1);

        // Load video elements
        const [refVid, userVid] = await Promise.all([
            loadVideoEl(refVideoUrl),
            loadVideoEl(userVideoUrl),
        ]);

        // Export should not trust UI duration state alone; mobile compare can invoke save
        // before those props settle even though the loaded video elements already know duration.
        const effectiveReferenceDuration = referenceDuration > 0 ? referenceDuration : refVid.duration;
        const effectiveUserDuration = userDuration > 0 ? userDuration : userVid.duration;

        const safeReferenceTrim = clampTrimRange(referenceTrim);
        const safeUserTrim = clampTrimRange(userTrim);

        // Determine trim windows and cap duration at 30s.
        // If one side still computes to zero, fall back to the full loaded clip instead of failing.
        let refStart = safeReferenceTrim.start * effectiveReferenceDuration;
        let refEnd = safeReferenceTrim.end * effectiveReferenceDuration;
        let userStart = safeUserTrim.start * effectiveUserDuration;
        let userEnd = safeUserTrim.end * effectiveUserDuration;

        if (!(refEnd > refStart) && effectiveReferenceDuration > 0) {
            refStart = 0;
            refEnd = effectiveReferenceDuration;
        }
        if (!(userEnd > userStart) && effectiveUserDuration > 0) {
            userStart = 0;
            userEnd = effectiveUserDuration;
        }

        // Use the LONGER clip so the export matches the compare preview (which plays to the end
        // of the longer video). Cap at 60 s to avoid runaway exports.
        const duration = Math.min(Math.max(refEnd - refStart, userEnd - userStart), 60);
        if (!(duration > 0)) {
            throw new Error('Video export could not determine a valid clip duration. Please reopen compare and try again.');
        }

        await Promise.all([seekTo(refVid, refStart), seekTo(userVid, userStart)]);
        onProgress?.(3);

        // ── Portrait canvas layout: 40/40/20 strict ratio ──────────────────────────
        // PRO panel (40%), USER panel (40%), Feedback footer (20%)
        const CW = 540;                    // portrait width
        const contentH = 748;               // total content height (including footer)
        const refPanelH = Math.floor(contentH * 0.4);  // 299
        const userPanelH = Math.floor(contentH * 0.4); // 299
        const feedBarH = contentH - refPanelH - userPanelH;  // 150
        const HEAD = 0;                    // no header bar in export
        const CH = contentH;

        const refY = 0;
        const userY = refPanelH;
        const footY = refPanelH + userPanelH;

        const canvas = document.createElement('canvas');
        canvas.width = CW; canvas.height = CH;
        const ctx = canvas.getContext('2d')!;

        const tips = feedback.tips.slice(0, 6);

        // Attach elements to DOM so mobile browsers actually decode/advance video frames.
        // Detached video elements silently freeze on iOS/Android.
        // IMPORTANT: do NOT use visibility:hidden or display:none — either removes the element
        // from the browser compositor, causing captureStream(30) to stop producing frames.
        // Off-screen position alone is sufficient to hide from the user.
        const hiddenCss = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;z-index:-9999';
        refVid.style.cssText = hiddenCss;
        userVid.style.cssText = hiddenCss;
        canvas.style.cssText = hiddenCss;
        document.body.appendChild(refVid);
        document.body.appendChild(userVid);
        document.body.appendChild(canvas);

        const domCleanup = () => {
            [refVid, userVid, canvas].forEach(el => { try { document.body.removeChild(el); } catch { /* already removed */ } });
            refVid.src = '';
            userVid.src = '';
        };

        // Guard: captureStream is not available on iOS Safari
        if (typeof canvas.captureStream !== 'function') {
            domCleanup();
            throw new Error('Video export is not supported in this browser. Please use Chrome on Android or a desktop browser.');
        }

        const mimeType = pickMimeType();
        // captureStream(30): auto-capture mode — the browser samples the canvas at 30 fps.
        // captureStream(0) + requestFrame() was not working on mobile because requestFrame
        // is absent on many mobile browsers, silently producing a zero-frame stream.
        const stream = canvas.captureStream(30);
        const recorderOptions: MediaRecorderOptions = { videoBitsPerSecond: 4_000_000 };
        if (mimeType) {
            recorderOptions.mimeType = mimeType;
        }
        // Some Android Chrome versions report isTypeSupported=true for video/mp4 but then
        // throw NotSupportedError when actually constructing the MediaRecorder. Fall back to
        // the browser default (video/webm) in that case.
        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, recorderOptions);
        } catch {
            recorder = new MediaRecorder(stream);
        }
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

        const recordingDone = new Promise<Blob>((resolve, reject) => {
            recorder.onerror = () => reject(new Error('Video recorder failed during export.'));
            recorder.onstop = () => {
                // Safari can fire stop before the final chunk is fully flushed.
                window.setTimeout(() => {
                    const finalType = (chunks[0] instanceof Blob ? chunks[0].type : '') || recorder.mimeType || mimeType || 'video/webm';
                    const blob = new Blob(chunks, { type: finalType });

                    if (blob.size === 0) {
                        reject(new Error('Video export produced an empty file. Please try again after analysis fully finishes.'));
                        return;
                    }

                    resolve(blob);
                }, 1000);
            };
        });

        // Load the tennis logo (non-blocking — may be null if not found)
        let logoImg: HTMLImageElement | null = null;
        try {
            logoImg = await new Promise<HTMLImageElement>((res, rej) => {
                const img = new Image();
                img.onload = () => res(img);
                img.onerror = () => rej();
                img.src = '/images/NT_logo.png';
            });
        } catch { /* logo optional */ }

        // Trail state for racket path overlay
        const refTrail: { x: number; y: number }[] = [];
        const userTrail: { x: number; y: number }[] = [];
        let refTrailLastT = -1;
        let userTrailLastT = -1;
        const TRAIL_MAX = 30;

        const drawFrame = () => {
            // ── Background ────────────────────────────────────────────────
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, CW, CH);

            // ── PRO panel (top 40%) ───────────────────────────────────────
            const refRect = drawVideoContainExport(ctx, refVid, 0, refY, CW, refPanelH);
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, refY, 140, 20);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'left';
            ctx.font = 'bold 11px system-ui,sans-serif';
            ctx.fillStyle = '#34d399';
            ctx.fillText('PRO REFERENCE', 7, refY + 13);

            // ── Divider between PRO and USER ──────────────────────────────
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, userY - 1, CW, 2);

            // ── USER panel (middle 40%) ───────────────────────────────────
            const userRect = drawVideoContainExport(ctx, userVid, 0, userY, CW, userPanelH);
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, userY, 130, 20);
            ctx.globalAlpha = 1;
            ctx.font = 'bold 11px system-ui,sans-serif';
            ctx.fillStyle = '#fb7185';
            ctx.fillText('YOUR ATTEMPT', 7, userY + 13);

            // ── Skeleton overlays ─────────────────────────────────────────
            if (showSkeleton) {
                // Guard by videoWidth: if dimensions aren't loaded, the contain-fit
                // rect is the full panel (not letterboxed), so joints would be misplaced.
                const rf = refPoseFrames?.length && refVid.videoWidth
                    ? interpolateNearest(refPoseFrames, refVid.currentTime) : null;
                const uf = userPoseFrames?.length && userVid.videoWidth
                    ? interpolateNearest(userPoseFrames, userVid.currentTime) : null;
                if (rf?.landmarks) drawSkeleton(ctx, rf.landmarks, refRect.x, refRect.y, refRect.w, refRect.h, 'emerald');
                if (uf?.landmarks) drawSkeleton(ctx, uf.landmarks, userRect.x, userRect.y, userRect.w, userRect.h, 'rose');
            }
            // ── Racket trails ─────────────────────────────────────────────
            {
                const rrf = refPoseFrames?.length && refVid.videoWidth
                    ? findNearest(refPoseFrames, refVid.currentTime) : null;
                const uuf = userPoseFrames?.length && userVid.videoWidth
                    ? findNearest(userPoseFrames, userVid.currentTime) : null;
                const refNow = refVid.currentTime;
                const userNow = userVid.currentTime;
                if (Math.abs(refNow - refTrailLastT) > 0.5) refTrail.length = 0;
                if (Math.abs(userNow - userTrailLastT) > 0.5) userTrail.length = 0;
                refTrailLastT = refNow;
                userTrailLastT = userNow;
                if (rrf?.landmarks) {
                    const pt = estimateRacketHead(rrf.landmarks, refRect.x, refRect.y, refRect.w, refRect.h);
                    if (pt) { refTrail.push(pt); if (refTrail.length > TRAIL_MAX) refTrail.shift(); }
                }
                if (uuf?.landmarks) {
                    const pt = estimateRacketHead(uuf.landmarks, userRect.x, userRect.y, userRect.w, userRect.h);
                    if (pt) { userTrail.push(pt); if (userTrail.length > TRAIL_MAX) userTrail.shift(); }
                }
                drawRacketTrail(ctx, refTrail, '#34d399');
                drawRacketTrail(ctx, userTrail, '#fb7185');
            }
            // ── Feedback bar (bottom 20%) ─────────────────────────────────
            if (feedBarH > 20) {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, footY, CW, feedBarH);

                ctx.textAlign = 'left';
                ctx.font = 'bold 12px system-ui,sans-serif';
                ctx.fillStyle = '#94a3b8';
                const motionLabel = motionType.charAt(0).toUpperCase() + motionType.slice(1);
                ctx.fillText(motionLabel + ' Analysis', 12, footY + 16);

                ctx.textAlign = 'right';
                ctx.font = '11px system-ui,sans-serif';
                ctx.fillStyle = '#64748b';
                const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                ctx.fillText(exportDate, CW - 12, footY + 16);

                ctx.textAlign = 'left';
                ctx.font = 'bold 13px system-ui,sans-serif';
                ctx.fillStyle = '#e2e8f0';
                ctx.fillText('Feedback', 12, footY + 34);

                ctx.font = '12px system-ui,sans-serif';
                ctx.fillStyle = '#e2e8f0';
                const halfCW = CW / 2;
                const colMaxW = halfCW - 40;
                tips.forEach((t, idx) => {
                    if (!t) return;
                    const col = Math.floor(idx / 3);
                    const row = idx % 3;
                    const dotX = col === 0 ? 12 : halfCW + 8;
                    const txtX = col === 0 ? 26 : halfCW + 22;
                    const bY = footY + 52 + row * 20;
                    if (bY > footY + feedBarH - 12) return;
                    const label = lang === 'zhSimp'
                        ? (t.shortZhSimp || t.short || t.detail)
                        : lang === 'zhTrad'
                            ? (t.shortZhTrad || t.short || t.detail)
                            : (t.short || t.detail);
                    ctx.fillStyle = '#34d399';
                    ctx.fillText('•', dotX, bY);
                    ctx.fillStyle = '#e2e8f0';
                    let txt = label;
                    while (ctx.measureText(txt).width > colMaxW && txt.length > 8) txt = txt.slice(0, -1);
                    if (txt.length < label.length) txt = txt.trimEnd() + '…';
                    ctx.fillText(txt, txtX, bY);
                });

                // Center watermark logo over the video panels
                if (logoImg) {
                    const wmH = Math.round(CW * 0.22);
                    const wmW = Math.round(wmH * (logoImg.naturalWidth / (logoImg.naturalHeight || 1)));
                    ctx.globalAlpha = 0.58;
                    ctx.drawImage(logoImg, (CW - wmW) / 2, (footY - wmH) / 2, wmW, wmH);
                    ctx.globalAlpha = 1;
                    // Corner logo — bottom-right of feedback bar
                    const cornerH = Math.min(feedBarH - 8, 52);
                    const cornerW = Math.round(cornerH * (logoImg.naturalWidth / (logoImg.naturalHeight || 1)));
                    ctx.globalAlpha = 1;
                    ctx.drawImage(logoImg, CW - cornerW - 10, CH - cornerH - 6, cornerW, cornerH);
                }
            }

        };

        // Time-stretch each clip so both complete one full swing in the same wall-clock
        // duration. The shorter clip plays at a reduced rate; the longer at 1×.
        // This normalises both clips to a shared 0→1 timeline regardless of their lengths.
        const refClipDur = refEnd - refStart;
        const userClipDur = userEnd - userStart;
        refVid.playbackRate = refClipDur / duration;
        userVid.playbackRate = userClipDur / duration;

        // Paint one black frame before videos start so the first timeslice is never empty.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CW, CH);

        recorder.start(100); // collect data every 100ms
        // Play both videos. On mobile a play() call can fail due to codec limits;
        // retry once after a short delay before giving up.
        const safePlay = (v: HTMLVideoElement) =>
            v.play().catch(() => new Promise<void>(r => setTimeout(() => { v.play().catch(() => { }); r(); }, 400)));
        await Promise.all([safePlay(refVid), safePlay(userVid)]);

        // Capture timing AFTER play() resolves so wall-clock doesn't include the
        // buffering/decode delay that play() takes on mobile (often 300-500ms).
        // Using pre-play t0 was causing elapsed to already be >= duration on the
        // first rAF tick for short clips, stopping the recorder before any data.
        const loopRefStart = refVid.currentTime;
        const loopUserStart = userVid.currentTime;
        const t0 = performance.now();

        await new Promise<void>(resolve => {
            let stopRequested = false;

            const loop = () => {
                const wallElapsed = (performance.now() - t0) / 1000;
                // Drive elapsed from video currentTime measured from where play() actually started.
                // Fall back to wall-clock minus a small startup grace so a stalled video
                // still eventually terminates the loop.
                const refElapsed = Math.max(0, refVid.currentTime - loopRefStart);
                const userElapsed = Math.max(0, userVid.currentTime - loopUserStart);
                const elapsed = Math.max(refElapsed, userElapsed, wallElapsed - 0.5);
                // Use wall-clock to decide when to stop — both videos loop so they
                // never naturally 'end'; wall-clock is the only reliable terminator.
                const bothEnded = false;

                // Never stop before 300ms wall-clock has elapsed — this guarantees
                // at least one ondataavailable interval (100ms) has fired with real frames.
                if (wallElapsed < 0.3 && !bothEnded) {
                    drawFrame();
                    requestAnimationFrame(loop);
                    return;
                }

                if (elapsed >= duration || bothEnded) {
                    if (!stopRequested) {
                        stopRequested = true;
                        try {
                            if (recorder.state === 'recording') {
                                recorder.requestData();
                            }
                        } catch {
                            // requestData is best-effort only.
                        }

                        window.setTimeout(() => {
                            if (recorder.state !== 'inactive') {
                                recorder.stop();
                            }
                        }, 120);
                    }
                    refVid.pause();
                    userVid.pause();
                    resolve();
                    return;
                }

                onProgress?.(Math.min(99, Math.round((elapsed / duration) * 100)));

                drawFrame();

                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        });

        let blob: Blob;
        try {
            blob = await recordingDone;
        } catch (e) {
            domCleanup();
            throw e;
        }
        domCleanup();
        return blob;
    }

    static async download(blob: Blob, filename: string) {
        if (blob.size === 0) {
            throw new Error('Exported video is empty. Please retry once the analysis is fully complete.');
        }

        // Use correct extension based on actual recorded format
        let name = filename;
        if (blob.type.includes('mp4')) name = filename.replace(/\.\w+$/, '.mp4');
        else if (blob.type.includes('webm')) name = filename.replace(/\.\w+$/, '.webm');

        // Check if we're on mobile and Web Share API is available
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        if (isMobile && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
            try {
                const file = new File([blob], name, { type: blob.type });
                const shareData = { files: [file], title: name };

                if (navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    return;
                }
            } catch (err) {
                // AbortError = user dismissed share sheet; other errors = fall through to <a> download
                console.warn('Share failed, falling back to download:', err);
            }
        }

        // Fall back to regular download for desktop or if share fails
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.rel = 'noopener';

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
    }
}
