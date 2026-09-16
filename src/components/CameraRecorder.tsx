import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

type CameraRecorderProps = {
    onCapture: (file: File) => void;
    onCancel: () => void;
    overlayVideoUrl?: string | null;
};

export const CameraRecorder: React.FC<CameraRecorderProps> = ({ onCapture, onCancel, overlayVideoUrl }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [reviewUrl, setReviewUrl] = useState<string | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [timer, setTimer] = useState(0);
    const [overlayOpacity, setOverlayOpacity] = useState(0.5);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
    const [isOverlayMirrored, setIsOverlayMirrored] = useState(false);
    const mimeTypeRef = useRef<string>('video/webm');

    useEffect(() => {
        startCamera();
        return () => {
            stopCamera();
            if (reviewUrl) URL.revokeObjectURL(reviewUrl);
        };
    }, [facingMode]);

    useEffect(() => {
        let interval: any;
        if (isRecording) {
            interval = setInterval(() => setTimer(t => t + 1), 1000);
        } else {
            setTimer(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const startCamera = async () => {
        stopCamera();
        setError(null);

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setError("Camera API not available. Please ensure you are using HTTPS or localhost.");
            return;
        }

        try {
            // Try with ideal constraints first; fall back to bare minimum if overConstrained
            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false,
                });
            } catch {
                // Fallback: minimal constraints — works on all Android/Samsung devices
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = true;
                videoRef.current.playsInline = true;
                videoRef.current.play().catch(e => console.log('Autoplay prevented:', e));
            }
        } catch (err) {
            console.error("Camera access denied:", err);
            setError(`Could not access camera: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    };

    const startRecording = () => {
        chunksRef.current = [];
        if (reviewUrl) {
            URL.revokeObjectURL(reviewUrl);
            setReviewUrl(null);
        }

        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;

            // On Android, webm/vp8 is the only reliably supported format.
            // Never put mp4 first — Android Chrome claims support but often crashes mid-recording.
            const isAndroid = /Android/i.test(navigator.userAgent);
            const types = isAndroid
                ? ['video/webm;codecs=vp8', 'video/webm', 'video/webm;codecs=vp9']
                : ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];

            let selectedType = types.find(t => MediaRecorder.isTypeSupported(t)) ?? '';

            // If no type matched, let the browser pick its own default (don't force a mimeType)
            let options: MediaRecorderOptions | undefined = undefined;
            if (selectedType) {
                mimeTypeRef.current = selectedType;
                options = { mimeType: selectedType };
            } else {
                mimeTypeRef.current = 'video/webm'; // safe default extension fallback
            }

            try {
                let mediaRecorder: MediaRecorder;
                try {
                    mediaRecorder = new MediaRecorder(stream, options);
                } catch {
                    // Fallback: some Android versions claim mimeType support but throw on creation
                    mimeTypeRef.current = 'video/webm';
                    mediaRecorder = new MediaRecorder(stream);
                }

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        chunksRef.current.push(event.data);
                    }
                };

                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
                    const url = URL.createObjectURL(blob);
                    setReviewUrl(url);
                    setIsRecording(false);
                };

                mediaRecorder.start(1000); // Collect frames every second
                setIsRecording(true);
                mediaRecorderRef.current = mediaRecorder;
            } catch (e) {
                console.error("MediaRecorder failed to start:", e);
                setError(`Recording failed: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            // isRecording set to false in onstop
        }
    };

    // Need to wait for chunks to settle. 
    // We can use a separate effect or just helper button "Use Video" after stopping
    const handleUseVideo = () => {
        if (!reviewUrl || chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        // Use a generic extension, though modern browsers handle mime detection
        const ext = mimeTypeRef.current.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `recorded-motion.${ext}`, { type: mimeTypeRef.current });
        onCapture(file);
    };

    const handleRetake = () => {
        setReviewUrl(null);
        chunksRef.current = [];
    };

    // Request fullscreen on mobile for immersive camera experience
    useEffect(() => {
        // Add class to body for CSS targeting
        document.body.classList.add('camera-fullscreen-active');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        const requestFullscreen = async () => {
            try {
                const elem = document.documentElement;
                if (elem.requestFullscreen) {
                    await elem.requestFullscreen();
                } else if ((elem as any).webkitRequestFullscreen) {
                    await (elem as any).webkitRequestFullscreen();
                }
            } catch (e) {
                console.log('Fullscreen not available:', e);
            }
        };
        requestFullscreen();

        return () => {
            document.body.classList.remove('camera-fullscreen-active');
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => { });
            }
        };
    }, []);

    const content = (
        <div
            className="fixed inset-0 z-[99999] bg-black text-white overflow-hidden camera-fullscreen"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
                maxWidth: '100vw',
                touchAction: 'none',
                overscrollBehavior: 'none',
                zIndex: 99999,
                isolation: 'isolate'
            }}
        >
            {error ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-rose-400">
                    <p className="text-xl mb-4">{error}</p>
                    <button className="btn btn-secondary" onClick={onCancel}>Close</button>
                </div>
            ) : (
                <>
                    {/* Full screen camera view */}
                    <div
                        className="absolute inset-0 overflow-hidden bg-black"
                        style={{ width: '100%', height: '100%' }}
                    >
                        {/* Review Mode: Show recorded video */}
                        {reviewUrl ? (
                            <video
                                key={reviewUrl}
                                src={reviewUrl}
                                controls
                                autoPlay
                                muted
                                playsInline
                                className="absolute inset-0 w-full h-full object-contain"
                                onLoadedMetadata={(e) => {
                                    const v = e.currentTarget;
                                    // WebM from MediaRecorder has no duration metadata — browser reports Infinity.
                                    // Seeking to a huge number forces the browser to scan to the real end.
                                    if (!isFinite(v.duration)) {
                                        (v as any).__fixingDuration = true;
                                        v.currentTime = 1e101;
                                    }
                                }}
                                onSeeked={(e) => {
                                    const v = e.currentTarget;
                                    if ((v as any).__fixingDuration) {
                                        (v as any).__fixingDuration = false;
                                        v.currentTime = 0;
                                    }
                                }}
                            />
                        ) : (
                            /* Camera Mode - Full screen video */
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`absolute inset-0 w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                }}
                            />
                        )}

                        {/* Ghost Overlay - Hide during review */}
                        {overlayVideoUrl && !reviewUrl && (
                            <video
                                src={overlayVideoUrl}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-transform opacity-50 mixing-blend-screen"
                                style={{
                                    opacity: overlayOpacity,
                                    transform: isOverlayMirrored ? 'scaleX(-1)' : 'none'
                                }}
                            />
                        )}
                    </div>

                    {/* Top Controls - with safe area */}
                    {!isRecording && !reviewUrl && (
                        <div
                            className="absolute right-4 z-20 flex flex-col gap-3"
                            style={{ top: 'max(env(safe-area-inset-top), 16px)' }}
                        >
                            <button
                                onClick={() => setFacingMode(m => m === 'user' ? 'environment' : 'user')}
                                className="bg-black/50 p-3 rounded-full text-white active:bg-black/70 text-base backdrop-blur-sm"
                                aria-label="Flip camera"
                            >
                                🔄
                            </button>
                            {overlayVideoUrl && (
                                <button
                                    onClick={() => setIsOverlayMirrored(m => !m)}
                                    className="bg-black/50 p-3 rounded-full text-white active:bg-black/70 text-base backdrop-blur-sm"
                                    aria-label="Mirror overlay"
                                >
                                    ↔️
                                </button>
                            )}
                        </div>
                    )}

                    {isRecording && (
                        <div
                            className="absolute right-4 z-20 flex flex-col items-end gap-2"
                            style={{ top: 'max(env(safe-area-inset-top), 16px)' }}
                        >
                            <div className="flex items-center gap-2 bg-red-600/90 px-4 py-2 rounded-full text-white font-mono text-base animate-pulse">
                                <div className="h-3 w-3 rounded-full bg-white animate-pulse"></div>
                                REC {Math.floor(timer / 60)}:{((timer % 60).toString().padStart(2, '0'))}
                            </div>
                        </div>
                    )}

                    {overlayVideoUrl && !isRecording && !reviewUrl && (
                        <div className="absolute top-4 left-4 w-40 bg-black/50 px-3 py-2 rounded flex flex-col gap-1 z-10 backdrop-blur-sm">
                            <div className="flex justify-between text-xs text-white">
                                <span>Ghost Overlay</span>
                                <span>{Math.round(overlayOpacity * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={overlayOpacity}
                                onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}

                    {/* Bottom Controls - Large touch targets for mobile */}
                    <div
                        className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-center bg-gradient-to-t from-black/80 via-black/40 to-transparent"
                        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)', paddingTop: '32px' }}
                    >
                        {!isRecording && !reviewUrl && (
                            <div className="flex items-center justify-between w-full px-8">
                                <button
                                    className="text-white text-lg font-medium px-4 py-3 rounded-lg bg-white/20 active:bg-white/30"
                                    onClick={onCancel}
                                >
                                    Cancel
                                </button>
                                {/* Large record button */}
                                <button
                                    className="h-20 w-20 rounded-full bg-red-500 border-4 border-white shadow-2xl active:scale-95 transition-transform"
                                    onClick={startRecording}
                                    aria-label="Start recording"
                                >
                                    <div className="h-full w-full rounded-full bg-red-500"></div>
                                </button>
                                <div className="w-20"></div> {/* Spacer for balance */}
                            </div>
                        )}

                        {isRecording && (
                            <div className="flex flex-col items-center gap-4 pb-4">
                                {/* Large stop button */}
                                <button
                                    className="h-20 w-20 rounded-full bg-white/20 border-4 border-white shadow-2xl flex items-center justify-center active:scale-95 transition-transform"
                                    onClick={stopRecording}
                                    aria-label="Stop recording"
                                >
                                    <div className="h-8 w-8 rounded bg-red-500"></div>
                                </button>
                                <span className="text-white/80 text-sm">Tap to stop</span>
                            </div>
                        )}

                        {!isRecording && reviewUrl && (
                            <div className="flex gap-4 w-full max-w-md mx-auto">
                                <button className="btn btn-secondary flex-1 py-3" onClick={handleRetake}>Retake</button>
                                <button className="btn btn-primary flex-1 py-3" onClick={handleUseVideo}>Use Video</button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );

    // Use portal to render at document.body level, escaping any parent stacking context
    return createPortal(content, document.body);
};
