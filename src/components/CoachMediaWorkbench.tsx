import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { mediaPipeVideoPoseService } from '../services/pose/MediaPipeVideoPoseService';
import { CameraRecorder } from './CameraRecorder';
import { StudentVideoAIFeedback, type AIFeedbackPublishPayload } from './StudentVideoAIFeedback';

export type WorkbenchAnnotation =
    | { type: 'path'; color: string; points: { x: number; y: number }[] }
    | { type: 'label'; color: string; x: number; y: number; text: string };

export interface WorkbenchMediaDraft {
    id: string;
    file: File;
    url: string;
    kind: 'image' | 'video';
    landmarks: { x: number; y: number; visibility?: number }[] | null;
    poseFrames: { timeMs: number; landmarks: { x: number; y: number; visibility?: number }[] }[];
    annotations: WorkbenchAnnotation[];
}

interface CoachMediaWorkbenchProps {
    onChange: (drafts: WorkbenchMediaDraft[]) => void;
    onUseSuggestion: (suggestion: string) => void;
    onAIFeedbackChange?: (payload: AIFeedbackPublishPayload | null) => void;
}

const MAX_ITEMS = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const CONNECTIONS: [number, number][] = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28],
    [27, 29], [29, 31], [28, 30], [30, 32],
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
];

export function CoachMediaWorkbench({ onChange, onUseSuggestion, onAIFeedbackChange }: CoachMediaWorkbenchProps) {
    const [drafts, setDrafts] = useState<WorkbenchMediaDraft[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tool, setTool] = useState<'review' | 'draw' | 'label'>('review');
    const [label, setLabel] = useState('');
    const [showSkeleton, setShowSkeleton] = useState(true);
    const [status, setStatus] = useState('Attach a photo or video to begin a visual review.');
    const [suggestion, setSuggestion] = useState<string | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const [liveLandmarks, setLiveLandmarks] = useState<{ x: number; y: number; visibility?: number }[] | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const poseImageLandmarkerRef = useRef<PoseLandmarker | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const vfcRef = useRef<number | null>(null);
    const lastPoseSampleAtRef = useRef(-Infinity);
    const drawingRef = useRef<{ points: { x: number; y: number }[] } | null>(null);
    const objectUrlsRef = useRef(new Set<string>());
    const poseFramesAccumulatorRef = useRef<Map<number, { x: number; y: number; visibility?: number }[]>>(new Map());

    const selected = drafts.find((draft) => draft.id === selectedId) ?? null;

    useEffect(() => { onChange(drafts); }, [drafts, onChange]);
    useEffect(() => () => objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);
    useEffect(() => { setSuggestion(null); onAIFeedbackChange?.(null); }, [selectedId]);
    useEffect(() => {
        setLiveLandmarks(selected?.landmarks ?? null);
        poseFramesAccumulatorRef.current.clear();
        if (selected?.kind === 'video') {
            void mediaPipeVideoPoseService.init();
            if (selected.poseFrames?.length) {
                selected.poseFrames.forEach((frame) => {
                    poseFramesAccumulatorRef.current.set(frame.timeMs, frame.landmarks);
                });
            }
        }
    }, [selectedId, selected?.kind]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !selected) return;
        const bounds = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(bounds.width));
        canvas.height = Math.max(1, Math.round(bounds.height));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const media = selected.kind === 'image' ? imageRef.current : videoRef.current;
        const frameBounds = media ? getContainedMediaBounds(media, canvas) : { x: 0, y: 0, width: canvas.width, height: canvas.height };
        if (showSkeleton && (liveLandmarks ?? selected.landmarks)) {
            context.save();
            context.translate(frameBounds.x, frameBounds.y);
            drawSkeleton(context, liveLandmarks ?? selected.landmarks!, frameBounds.width, frameBounds.height);
            context.restore();
        }
        selected.annotations.forEach((annotation) => drawAnnotation(context, annotation, canvas.width, canvas.height));
    }, [selected, showSkeleton, liveLandmarks]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || selected?.kind !== 'video' || !showSkeleton) return;

        let isRunning = true;

        const syncFramesToDraft = () => {
            const sorted = Array.from(poseFramesAccumulatorRef.current.entries())
                .map(([timeMs, lms]) => ({ timeMs, landmarks: lms }))
                .sort((a, b) => a.timeMs - b.timeMs);
            if (sorted.length > 0) {
                setDrafts((current) => current.map((draft) => (
                    draft.id === selected.id ? { ...draft, landmarks: sorted[0]?.landmarks ?? draft.landmarks, poseFrames: sorted } : draft
                )));
            }
        };

        const processVideoFrame = () => {
            if (!isRunning) return;
            if (!video.paused && !video.ended && video.readyState >= 2) {
                const landmarks = mediaPipeVideoPoseService.detect(video);
                if (landmarks && landmarks.length >= 33) {
                    setLiveLandmarks(landmarks);
                    const playbackTime = Math.round(video.currentTime * 1000);
                    if (Math.abs(playbackTime - lastPoseSampleAtRef.current) >= 60) {
                        lastPoseSampleAtRef.current = playbackTime;
                        poseFramesAccumulatorRef.current.set(playbackTime, landmarks);
                    }
                }
            }

            if (!video.paused && !video.ended) {
                if ('requestVideoFrameCallback' in video) {
                    vfcRef.current = (video as any).requestVideoFrameCallback(processVideoFrame);
                } else {
                    animationFrameRef.current = requestAnimationFrame(processVideoFrame);
                }
            }
        };

        const startTracking = () => {
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            if (vfcRef.current !== null && 'cancelVideoFrameCallback' in video) (video as any).cancelVideoFrameCallback(vfcRef.current);
            processVideoFrame();
        };

        const stopTracking = () => {
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            if (vfcRef.current !== null && 'cancelVideoFrameCallback' in video) (video as any).cancelVideoFrameCallback(vfcRef.current);
            animationFrameRef.current = null;
            vfcRef.current = null;
            syncFramesToDraft();
        };

        const onSeek = () => {
            if (video.paused && video.readyState >= 2) {
                const playbackTime = Math.round(video.currentTime * 1000);
                const cached = poseFramesAccumulatorRef.current.get(playbackTime);
                if (cached) {
                    setLiveLandmarks(cached);
                } else {
                    const detected = mediaPipeVideoPoseService.detect(video);
                    if (detected && detected.length >= 33) {
                        setLiveLandmarks(detected);
                        poseFramesAccumulatorRef.current.set(playbackTime, detected);
                    }
                }
            }
        };

        video.addEventListener('play', startTracking);
        video.addEventListener('pause', stopTracking);
        video.addEventListener('ended', stopTracking);
        video.addEventListener('seeked', onSeek);
        video.addEventListener('timeupdate', onSeek);

        if (!video.paused) startTracking();

        return () => {
            isRunning = false;
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            if (vfcRef.current !== null && 'cancelVideoFrameCallback' in video) (video as any).cancelVideoFrameCallback(vfcRef.current);
            video.removeEventListener('play', startTracking);
            video.removeEventListener('pause', stopTracking);
            video.removeEventListener('ended', stopTracking);
            video.removeEventListener('seeked', onSeek);
            video.removeEventListener('timeupdate', onSeek);
            syncFramesToDraft();
        };
    }, [selected?.id, selected?.kind, showSkeleton]);

    const addFiles = (files: FileList | readonly File[] | null) => {
        if (!files) return;
        const remaining = MAX_ITEMS - drafts.length;
        const accepted: WorkbenchMediaDraft[] = [];
        for (const file of Array.from(files).slice(0, remaining)) {
            const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
            const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
            if (!kind || file.size > limit) {
                setStatus(`${file.name} was not added. Photos must be 10 MB or less; videos must be 100 MB or less.`);
                continue;
            }
            const url = URL.createObjectURL(file);
            objectUrlsRef.current.add(url);
            accepted.push({ id: crypto.randomUUID(), file, url, kind, landmarks: null, poseFrames: [], annotations: [] });
        }
        if (accepted.length) {
            setDrafts((current) => [...current, ...accepted]);
            setSelectedId(accepted[0].id);
            setStatus(`${accepted.length} media item${accepted.length > 1 ? 's' : ''} ready for review.`);
        }
    };

    const handleCameraCapture = (file: File) => {
        setShowCamera(false);
        addFiles([file]);
    };

    const detectPose = async () => {
        if (!selected) return;
        setDetecting(true);
        try {
            if (selected.kind === 'video') {
                const video = videoRef.current;
                if (!video || video.readyState < 2) throw new Error('Wait for the video preview to load.');
                await mediaPipeVideoPoseService.init();
                const landmarks = mediaPipeVideoPoseService.detect(video);
                if (landmarks && landmarks.length >= 33) {
                    setLiveLandmarks(landmarks);
                    const playbackTime = Math.round(video.currentTime * 1000);
                    poseFramesAccumulatorRef.current.set(playbackTime, landmarks);
                    const sorted = Array.from(poseFramesAccumulatorRef.current.entries())
                        .map(([timeMs, lms]) => ({ timeMs, landmarks: lms }))
                        .sort((a, b) => a.timeMs - b.timeMs);
                    setDrafts((current) => current.map((draft) => (
                        draft.id === selected.id ? { ...draft, landmarks, poseFrames: sorted } : draft
                    )));
                    const nextSuggestion = buildPoseSuggestion(landmarks);
                    setSuggestion(nextSuggestion);
                    setStatus(nextSuggestion);
                } else {
                    setStatus('Could not find a clear pose in this frame. Pause where the player is clearly visible.');
                }
            } else {
                if (!poseImageLandmarkerRef.current) {
                    const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm');
                    poseImageLandmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, {
                        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
                        runningMode: 'IMAGE',
                        numPoses: 1,
                    });
                }
                const source = imageRef.current;
                if (!source) throw new Error('Wait for the image preview to load.');
                const result = poseImageLandmarkerRef.current.detect(source);
                const landmarks = (result.landmarks[0] as { x: number; y: number; visibility?: number }[]) ?? null;
                setLiveLandmarks(landmarks);
                setDrafts((current) => current.map((draft) => draft.id === selected.id ? { ...draft, landmarks } : draft));
                const nextSuggestion = landmarks
                    ? buildPoseSuggestion(landmarks)
                    : 'AI pose scan could not find a clear full-body pose. Choose a clearer image with the player fully visible, or add your own coaching observation.';
                setSuggestion(nextSuggestion);
                setStatus(nextSuggestion);
            }
        } catch {
            setStatus('Pose scan could not run. Pause on a clear, full-body frame and try again.');
        } finally {
            setDetecting(false);
        }
    };

    const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    };

    const startAnnotation = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!selected) return;
        const point = pointFromEvent(event);
        if (tool === 'label') {
            if (!label.trim()) { setStatus('Type a label before placing it on the media.'); return; }
            updateSelected({ type: 'label', color: '#d9ff57', x: point.x, y: point.y, text: label.trim() });
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drawingRef.current = { points: [point] };
    };

    const continueAnnotation = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const point = pointFromEvent(event);
        const points = drawingRef.current.points;
        const previous = points[points.length - 1];
        points.push(point);
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || !previous) return;
        context.save();
        context.strokeStyle = '#d9ff57';
        context.lineWidth = Math.max(2, canvas.width * 0.006);
        context.beginPath();
        context.moveTo(previous.x * canvas.width, previous.y * canvas.height);
        context.lineTo(point.x * canvas.width, point.y * canvas.height);
        context.stroke();
        context.restore();
    };

    const finishAnnotation = () => {
        if (drawingRef.current && drawingRef.current.points.length > 1) updateSelected({ type: 'path', color: '#d9ff57', points: drawingRef.current.points });
        drawingRef.current = null;
    };

    const updateSelected = (annotation: WorkbenchAnnotation) => {
        if (!selected) return;
        setDrafts((current) => current.map((draft) => draft.id === selected.id ? { ...draft, annotations: [...draft.annotations, annotation] } : draft));
    };

    const clearAnnotations = () => selected && setDrafts((current) => current.map((draft) => draft.id === selected.id ? { ...draft, annotations: [] } : draft));
    const removeSelected = () => selected && setDrafts((current) => { URL.revokeObjectURL(selected.url); objectUrlsRef.current.delete(selected.url); const next = current.filter((draft) => draft.id !== selected.id); setSelectedId(next[0]?.id ?? null); return next; });

    return <section className="crm-workbench" aria-label="Coach media workbench">
        <div className="crm-panel-heading"><div><p className="crm-eyebrow">Visual feedback workbench</p><h2>Review and mark up</h2></div><span className="crm-count">{drafts.length}/{MAX_ITEMS}</span></div>
        <p className="crm-workbench-status">{status}</p>
        <div className="crm-workbench-toolbar"><label className="crm-button crm-button-secondary">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} /></label><label className="crm-button crm-button-secondary">Add video<input type="file" accept="video/mp4,video/quicktime,video/webm" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} /></label><button type="button" className="crm-button crm-button-secondary" onClick={() => setShowCamera(true)} disabled={drafts.length >= MAX_ITEMS}>Record video</button><button type="button" className="crm-workbench-tool" onClick={() => { setTool('review'); void videoRef.current?.play().catch(() => undefined); }} data-active={tool === 'review'}>Play video</button><button type="button" className="crm-workbench-tool" onClick={() => setTool('draw')} data-active={tool === 'draw'}>Draw</button><button type="button" className="crm-workbench-tool" onClick={() => setTool('label')} data-active={tool === 'label'}>Label</button><button type="button" className="crm-workbench-tool" onClick={() => setShowSkeleton((value) => !value)} data-active={showSkeleton}>Joints</button></div>
        {showCamera && <CameraRecorder onCapture={handleCameraCapture} onCancel={() => setShowCamera(false)} />}
        {tool === 'label' && <label className="crm-workbench-label">Callout text<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Tap media to place this note" /></label>}
        {drafts.length > 0 && <div className="crm-workbench-grid"><div className="crm-media-strip">{drafts.map((draft) => <button type="button" key={draft.id} onClick={() => { setSelectedId(draft.id); setTool('review'); }} className={`crm-media-thumb ${draft.id === selectedId ? 'is-selected' : ''}`}>{draft.kind === 'image' ? <img src={draft.url} alt="Coach attachment" /> : <video src={draft.url} muted preload="metadata" />}<span>{draft.kind === 'image' ? 'Photo' : 'Video'}</span></button>)}</div><div className="crm-media-stage">{selected?.kind === 'image' ? <img ref={imageRef} src={selected.url} alt="Selected coaching attachment" onLoad={() => setStatus('Ready to annotate. Run the pose scan when the player is fully visible.')} /> : <video ref={videoRef} src={selected?.url} controls onLoadedData={() => setStatus('Pause the video on the frame you want to review, then run the pose scan.')} />}<canvas ref={canvasRef} className={tool === 'review' ? 'is-pass-through' : ''} onPointerDown={startAnnotation} onPointerMove={continueAnnotation} onPointerUp={finishAnnotation} onPointerCancel={finishAnnotation} /></div></div>}
        {selected && <div className="crm-workbench-actions"><button type="button" onClick={() => void detectPose()} disabled={detecting} className="crm-button crm-button-primary">{detecting ? 'Scanning pose...' : 'Run AI pose scan'}</button>{selected.kind === 'video' && <StudentVideoAIFeedback key={selected.id} videoUrl={selected.url} fileName={selected.file.name} placement="workbench" onShareChange={onAIFeedbackChange} />}<button type="button" onClick={() => suggestion && onUseSuggestion(suggestion)} disabled={!suggestion} className="crm-button crm-button-secondary">Use suggestion in feedback</button><button type="button" onClick={clearAnnotations} className="crm-text-button">Clear markings</button><button type="button" onClick={removeSelected} className="crm-text-button">Remove media</button></div>}
    </section>;
}

export function drawSkeleton(context: CanvasRenderingContext2D, landmarks: { x: number; y: number; visibility?: number }[], width: number, height: number) {
    context.save();
    context.strokeStyle = '#54f59a';
    context.fillStyle = '#d9ff57';
    context.lineWidth = Math.max(2, width * 0.005);
    CONNECTIONS.forEach(([start, end]) => {
        const a = landmarks[start];
        const b = landmarks[end];
        if (!a || !b) return;
        if ((a.visibility ?? 1) < 0.25 || (b.visibility ?? 1) < 0.25) return;
        context.beginPath();
        context.moveTo(a.x * width, a.y * height);
        context.lineTo(b.x * width, b.y * height);
        context.stroke();
    });
    landmarks.slice(0, 33).forEach((landmark) => {
        if ((landmark.visibility ?? 1) < 0.25) return;
        context.beginPath();
        context.arc(landmark.x * width, landmark.y * height, Math.max(3, width * 0.008), 0, Math.PI * 2);
        context.fill();
    });
    context.restore();
}

export function drawAnnotation(context: CanvasRenderingContext2D, annotation: WorkbenchAnnotation, width: number, height: number) {
    context.save(); context.strokeStyle = annotation.color; context.fillStyle = annotation.color; context.lineWidth = Math.max(2, width * 0.006);
    if (annotation.type === 'path') { annotation.points.forEach((point, index) => { if (index === 0) context.moveTo(point.x * width, point.y * height); else context.lineTo(point.x * width, point.y * height); }); context.stroke(); }
    else { context.font = `700 ${Math.max(13, width * 0.035)}px Manrope`; context.fillText(annotation.text, annotation.x * width, annotation.y * height); }
    context.restore();
}

function getContainedMediaBounds(media: HTMLImageElement | HTMLVideoElement, canvas: HTMLCanvasElement) {
    const sourceWidth = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth;
    const sourceHeight = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight;
    const canvasBounds = canvas.getBoundingClientRect();
    const mediaBounds = media.getBoundingClientRect();
    const elementX = mediaBounds.left - canvasBounds.left;
    const elementY = mediaBounds.top - canvasBounds.top;

    if (!sourceWidth || !sourceHeight) {
        return { x: elementX, y: elementY, width: mediaBounds.width, height: mediaBounds.height };
    }

    const scale = Math.min(mediaBounds.width / sourceWidth, mediaBounds.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
        x: elementX + (mediaBounds.width - width) / 2,
        y: elementY + (mediaBounds.height - height) / 2,
        width,
        height,
    };
}

function buildPoseSuggestion(landmarks: { x: number; y: number; visibility?: number }[]) {
    const shoulderTilt = lineTilt(landmarks[11], landmarks[12]);
    const hipTilt = lineTilt(landmarks[23], landmarks[24]);
    const kneeAngles = [jointAngle(landmarks[23], landmarks[25], landmarks[27]), jointAngle(landmarks[24], landmarks[26], landmarks[28])].filter((angle): angle is number => angle !== null);
    const cues: string[] = [];
    if (shoulderTilt !== null) cues.push(`Shoulders: ${Math.round(shoulderTilt)} degrees from level.`);
    if (hipTilt !== null) cues.push(`Hips: ${Math.round(hipTilt)} degrees from level.`);
    if (kneeAngles.length) {
        const averageKneeAngle = kneeAngles.reduce((total, angle) => total + angle, 0) / kneeAngles.length;
        cues.push(averageKneeAngle > 165 ? 'Knees: mostly extended.' : 'Knees: visible flexion.');
    }
    return cues.join(' ') || 'Full-body pose found. Review the frame before adding feedback.';
}

function lineTilt(first?: { x: number; y: number }, second?: { x: number; y: number }) {
    if (!first || !second) return null;
    return Math.abs(Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI);
}

function jointAngle(first?: { x: number; y: number }, vertex?: { x: number; y: number }, second?: { x: number; y: number }) {
    if (!first || !vertex || !second) return null;
    const firstVector = { x: first.x - vertex.x, y: first.y - vertex.y };
    const secondVector = { x: second.x - vertex.x, y: second.y - vertex.y };
    const magnitude = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
    if (!magnitude) return null;
    return Math.acos(Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / magnitude))) * 180 / Math.PI;
}