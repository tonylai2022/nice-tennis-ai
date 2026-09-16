export const FRAME_THUMBNAIL_SIZE = 480;

export function captureFrameThumbnail(video: HTMLVideoElement, maxDim = FRAME_THUMBNAIL_SIZE): string | undefined {
    try {
        if (video.videoWidth === 0 || video.videoHeight === 0) return undefined;

        const canvas = document.createElement('canvas');
        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > maxDim || height > maxDim) {
            const ratio = width / height;
            if (width > height) {
                width = maxDim;
                height = Math.round(maxDim / ratio);
            } else {
                height = maxDim;
                width = Math.round(maxDim * ratio);
            }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;

        ctx.imageSmoothingEnabled = true;
        try { (ctx as any).imageSmoothingQuality = 'high'; } catch { /* ignore */ }
        ctx.drawImage(video, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.65);
    } catch (e) {
        console.warn('Frame thumbnail capture failed:', e);
        return undefined;
    }
}

export function waitRafs(count: number): Promise<void> {
    return new Promise((resolve) => {
        const step = (remaining: number) => {
            if (remaining <= 0) return resolve();
            requestAnimationFrame(() => step(remaining - 1));
        };
        step(count);
    });
}

export function seekToTime(video: HTMLVideoElement, targetTime: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        const start = performance.now();
        let done = false;
        let vfcSeq = 0;

        const requestVFC = (video as any).requestVideoFrameCallback as
            | ((cb: (now: number, metadata: any) => void) => number)
            | undefined;

        const cleanup = () => {
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
        };

        const onError = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
        };

        const isFrameReady = () => {
            if (video.readyState < 2) return false;
            if (!video.videoWidth || !video.videoHeight) return false;
            if (video.seeking) return false;
            const diff = Math.abs(video.currentTime - targetTime);
            return diff < 0.08 || !Number.isFinite(diff);
        };

        const tickWithVfc = () => {
            if (done) return;
            if (performance.now() - start > timeoutMs) {
                done = true; cleanup(); resolve(); return;
            }

            if (typeof requestVFC === 'function') {
                const seq = ++vfcSeq;
                let fired = false;

                try {
                    requestVFC.call(video, (_, metadata) => {
                        fired = true;
                        if (done) return;
                        const mtRaw = metadata?.mediaTime;
                        const mt = typeof mtRaw === 'number' ? mtRaw : Number(mtRaw);
                        const presented = typeof mt === 'number' && isFinite(mt);
                        const closeEnough = presented ? Math.abs(mt - targetTime) < 0.06 : false;
                        const ready = video.readyState >= 2 && !video.seeking && video.videoWidth > 0;
                        if (ready && (closeEnough || !presented)) {
                            done = true; cleanup(); resolve(); return;
                        }
                        requestAnimationFrame(tickWithVfc);
                    });
                } catch {
                    requestAnimationFrame(tick);
                    return;
                }

                window.setTimeout(() => {
                    if (done) return;
                    if (seq !== vfcSeq) return;
                    if (!fired) requestAnimationFrame(tick);
                }, 120);
                return;
            }

            requestAnimationFrame(tick);
        };

        const tick = () => {
            if (done) return;
            if (isFrameReady()) { done = true; cleanup(); resolve(); return; }
            if (performance.now() - start > timeoutMs) { done = true; cleanup(); resolve(); return; }
            requestAnimationFrame(tick);
        };

        const onSeeked = () => { tickWithVfc(); };

        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);

        try {
            video.currentTime = targetTime;
        } catch { /* ignore */ }

        tickWithVfc();
    });
}
