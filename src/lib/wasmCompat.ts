// Apply early WebAssembly compatibility patches for mobile Safari/iOS.
//
// Why: Some WebAssembly loaders (Emscripten, MediaPipe Tasks, etc.) try to use
// `WebAssembly.instantiateStreaming(...)`. On iOS Safari/WebKit this can throw
// a TypeError in certain environments, then fall back. In the worst case it can
// prevent model initialization.
//
// We disable streaming compilation on iOS/iPadOS to force the safe ArrayBuffer
// path.

export { };

declare global {
    interface WebAssembly {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        instantiateStreaming?: any;
    }
}

function isLikelyIOSWebKit(): boolean {
    const ua = navigator.userAgent;

    // iPhone/iPod are straightforward.
    if (/iPhone|iPod/i.test(ua)) return true;

    // iPadOS 13+ reports itself as Macintosh; detect via touch points.
    // (Safari on macOS won't usually have maxTouchPoints > 1.)
    if (/iPad/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1) return true;

    return false;
}

(function applyWasmCompatPatch() {
    try {
        if (!isLikelyIOSWebKit()) return;

        const wa: any = WebAssembly as any;
        if (typeof wa.instantiateStreaming === 'function') {
            try {
                delete wa.instantiateStreaming;
            } catch {
                // Some environments may not allow deleting; replace with undefined.
                wa.instantiateStreaming = undefined;
            }
            // Helpful, but keep it low-noise.
            console.log('[WASM] iOS streaming compilation disabled for compatibility');
        }
    } catch {
        // best-effort
    }
})();
