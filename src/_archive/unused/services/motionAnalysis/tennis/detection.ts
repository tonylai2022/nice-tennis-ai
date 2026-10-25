import type { PoseResult } from '../BaseMotionAnalysis';

// Module-level canvas singletons (replace class-level properties)
let ballCanvas: HTMLCanvasElement | null = null;
let ballCtx: CanvasRenderingContext2D | null = null;
let racketCanvas: HTMLCanvasElement | null = null;
let racketCtx: CanvasRenderingContext2D | null = null;

export function detectTennisBallFromVideo(
    video: HTMLVideoElement,
    landmarks?: any[]
): PoseResult['ball'] {
    try {
        if (!video.videoWidth || !video.videoHeight) return undefined;

        if (!ballCanvas) {
            ballCanvas = document.createElement('canvas');
            ballCtx = ballCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (!ballCanvas || !ballCtx) return undefined;

        const srcW = video.videoWidth;
        const srcH = video.videoHeight;
        const MAX_W = 320;
        const scale = Math.min(1, MAX_W / srcW);
        const w = Math.max(2, Math.round(srcW * scale));
        const h = Math.max(2, Math.round(srcH * scale));
        ballCanvas.width = w;
        ballCanvas.height = h;

        ballCtx.imageSmoothingEnabled = true;
        try { (ballCtx as any).imageSmoothingQuality = 'high'; } catch { /* ignore */ }
        ballCtx.drawImage(video, 0, 0, w, h);
        const img = ballCtx.getImageData(0, 0, w, h);
        const data = img.data;

        const isBallPixel = (r: number, g: number, b: number) => {
            const rf = r / 255, gf = g / 255, bf = b / 255;
            const max = Math.max(rf, gf, bf);
            const min = Math.min(rf, gf, bf);
            const delta = max - min;
            const v = max;
            const s = max === 0 ? 0 : delta / max;
            if (v < 0.22 || s < 0.15) return false;
            let hDeg = 0;
            if (delta === 0) hDeg = 0;
            else if (max === rf) hDeg = 60 * (((gf - bf) / delta) % 6);
            else if (max === gf) hDeg = 60 * ((bf - rf) / delta + 2);
            else hDeg = 60 * ((rf - gf) / delta + 4);
            if (hDeg < 0) hDeg += 360;
            return hDeg >= 30 && hDeg <= 115;
        };

        const rois: { x0: number; y0: number; x1: number; y1: number }[] = [];
        const addRoi = (lmIdx: number) => {
            const lm = landmarks?.[lmIdx];
            if (!lm) return;
            const cx = Math.round((lm.x ?? 0) * w);
            const cy = Math.round((lm.y ?? 0) * h);
            const rad = Math.round(Math.min(w, h) * 0.22);
            rois.push({ x0: Math.max(0, cx - rad), y0: Math.max(0, cy - rad), x1: Math.min(w - 1, cx + rad), y1: Math.min(h - 1, cy + rad) });
        };
        addRoi(15); addRoi(16);
        rois.push({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });

        let best: { cx: number; cy: number; area: number; x0: number; y0: number; x1: number; y1: number } | null = null;
        const stride = 2;

        for (const roi of rois) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let sumX = 0, sumY = 0, count = 0;

            for (let y = roi.y0; y <= roi.y1; y += stride) {
                const row = y * w * 4;
                for (let x = roi.x0; x <= roi.x1; x += stride) {
                    const idx = row + x * 4;
                    if (!isBallPixel(data[idx], data[idx + 1], data[idx + 2])) continue;
                    count++;
                    sumX += x; sumY += y;
                    if (x < minX) minX = x; if (y < minY) minY = y;
                    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                }
            }

            if (count < 6) continue;
            const cx = sumX / count, cy = sumY / count;
            const bw = Math.max(1, maxX - minX + 1), bh = Math.max(1, maxY - minY + 1);
            const aspect = bw / bh;
            if (aspect < 0.45 || aspect > 2.0) continue;
            const approxArea = count * stride * stride;
            const density = approxArea / (bw * bh);
            if (density < 0.15) continue;
            const areaMax = (w * h) * 0.018;
            if (approxArea > areaMax) continue;
            if (!best || approxArea > best.area) {
                best = { cx, cy, area: approxArea, x0: minX, y0: minY, x1: maxX, y1: maxY };
            }
        }

        if (!best) return undefined;

        const boxW = Math.max(1, best.x1 - best.x0 + 1);
        const boxH = Math.max(1, best.y1 - best.y0 + 1);
        const radiusPx = 0.5 * (boxW + boxH) / 2;
        const sizeScore = Math.min(1, best.area / (w * h * 0.003));
        const densityScore = Math.min(1, (best.area / (boxW * boxH)) / 0.2);
        const conf = Math.max(0, Math.min(1, (sizeScore + densityScore) * 0.5));
        return { x: best.cx / w, y: best.cy / h, confidence: conf, radius: radiusPx / Math.max(w, h) };
    } catch {
        return undefined;
    }
}

export function detectRacketFromVideo(
    video: HTMLVideoElement,
    landmarks?: any[],
    ball?: PoseResult['ball']
): PoseResult['racket'] {
    try {
        if (!video.videoWidth || !video.videoHeight) return undefined;
        if (!landmarks || landmarks.length < 17) return undefined;

        if (!racketCanvas) {
            racketCanvas = document.createElement('canvas');
            racketCtx = racketCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (!racketCanvas || !racketCtx) return undefined;

        const srcW = video.videoWidth, srcH = video.videoHeight;
        const MAX_W = 320;
        const scale = Math.min(1, MAX_W / srcW);
        const w = Math.max(2, Math.round(srcW * scale));
        const h = Math.max(2, Math.round(srcH * scale));
        racketCanvas.width = w;
        racketCanvas.height = h;

        racketCtx.imageSmoothingEnabled = true;
        try { (racketCtx as any).imageSmoothingQuality = 'high'; } catch { /* ignore */ }
        racketCtx.drawImage(video, 0, 0, w, h);
        const img = racketCtx.getImageData(0, 0, w, h);
        const data = img.data;

        const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
        const getLm = (i: number) => landmarks?.[i];
        const arms: Array<{ wIdx: number; eIdx: number }> = [{ wIdx: 16, eIdx: 14 }, { wIdx: 15, eIdx: 13 }];

        const grayAt = (x: number, y: number) => {
            const idx = (y * w + x) * 4;
            return 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
        };

        const edgeMagAt = (x: number, y: number) => {
            if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 0;
            const tl = grayAt(x - 1, y - 1), tc = grayAt(x, y - 1), tr = grayAt(x + 1, y - 1);
            const ml = grayAt(x - 1, y), mr = grayAt(x + 1, y);
            const bl = grayAt(x - 1, y + 1), bc = grayAt(x, y + 1), br = grayAt(x + 1, y + 1);
            const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            return Math.min(255, Math.sqrt(gx * gx + gy * gy) / 4);
        };

        const ballPx = ball && ball.confidence > 0.15 ? { x: ball.x * w, y: ball.y * h, c: ball.confidence } : null;
        let best: { x0: number; y0: number; x1: number; y1: number; score: number } | null = null;

        for (const arm of arms) {
            const wrist = getLm(arm.wIdx);
            const elbow = getLm(arm.eIdx);
            if (!wrist || !elbow) continue;

            const wx = (wrist.x ?? 0) * w, wy = (wrist.y ?? 0) * h;
            const ex = (elbow.x ?? 0) * w, ey = (elbow.y ?? 0) * h;
            const vx = wx - ex, vy = wy - ey;
            const vLen = Math.sqrt(vx * vx + vy * vy);
            if (vLen < 4) continue;
            const ux = vx / vLen, uy = vy / vLen;

            const minDim = Math.min(w, h);
            const L = minDim * 0.45, W = minDim * 0.30;
            const cx = wx + ux * (L * 0.35), cy = wy + uy * (L * 0.35);
            const px = -uy, py = ux;
            const corners = [
                { x: cx - ux * (L * 0.5) - px * (W * 0.5), y: cy - uy * (L * 0.5) - py * (W * 0.5) },
                { x: cx - ux * (L * 0.5) + px * (W * 0.5), y: cy - uy * (L * 0.5) + py * (W * 0.5) },
                { x: cx + ux * (L * 0.5) - px * (W * 0.5), y: cy + uy * (L * 0.5) - py * (W * 0.5) },
                { x: cx + ux * (L * 0.5) + px * (W * 0.5), y: cy + uy * (L * 0.5) + py * (W * 0.5) },
            ];
            const x0 = Math.max(1, Math.floor(Math.min(...corners.map(c => c.x))));
            const y0 = Math.max(1, Math.floor(Math.min(...corners.map(c => c.y))));
            const x1 = Math.min(w - 2, Math.ceil(Math.max(...corners.map(c => c.x))));
            const y1 = Math.min(h - 2, Math.ceil(Math.max(...corners.map(c => c.y))));
            if (x1 <= x0 || y1 <= y0) continue;

            const baseAngle = Math.atan2(uy, ux);
            const angleSpan = (30 * Math.PI) / 180;
            const angleStep = (4 * Math.PI) / 180;
            const lengths = [minDim * 0.24, minDim * 0.30, minDim * 0.36, minDim * 0.42];

            for (let a = baseAngle - angleSpan; a <= baseAngle + angleSpan + 1e-6; a += angleStep) {
                const dx = Math.cos(a), dy = Math.sin(a);
                for (const len of lengths) {
                    const tx = wx + dx * len, ty = wy + dy * len;
                    if (!isFinite(tx) || !isFinite(ty)) continue;

                    const steps = Math.max(10, Math.floor(len));
                    let sum = 0, n = 0;
                    for (let s = 0; s <= steps; s++) {
                        const t = s / steps;
                        const sx = Math.round(wx + (tx - wx) * t);
                        const sy = Math.round(wy + (ty - wy) * t);
                        if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
                        sum += edgeMagAt(sx, sy); n++;
                    }
                    if (n < Math.max(6, steps * 0.40)) continue;

                    let score = (sum / n) / 255;

                    if (ballPx) {
                        const abx = tx - wx, aby = ty - wy;
                        const apx = ballPx.x - wx, apy = ballPx.y - wy;
                        const ab2 = abx * abx + aby * aby;
                        const tt = ab2 > 1e-6 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
                        const dist = Math.sqrt((ballPx.x - (wx + abx * tt)) ** 2 + (ballPx.y - (wy + aby * tt)) ** 2);
                        const prox = clamp01(1 - Math.max(0, Math.min(3, dist / Math.max(1, len))) / 0.28);
                        score += 0.60 * prox * clamp01(ballPx.c);
                    }

                    if (!best || score > best.score) {
                        best = { x0: wx, y0: wy, x1: tx, y1: ty, score };
                    }
                }
            }
        }

        if (!best) return undefined;
        const conf = clamp01((best.score - 0.05) / 0.35);
        if (conf < 0.12) return undefined;

        return { x0: best.x0 / w, y0: best.y0 / h, x1: best.x1 / w, y1: best.y1 / h, confidence: conf };
    } catch {
        return undefined;
    }
}
