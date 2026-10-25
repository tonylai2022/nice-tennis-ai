/**
 * useVideoPlayer.ts
 * SRP: Manages video element state, pose analysis, and canvas overlay drawing.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MotionAnalysisService, PoseResult } from '../services/MotionAnalysisRouter';
import { trainingVideoService } from '../services/TrainingVideoService';
import { StrokeType } from '../services/CalibrationService';

interface UseVideoPlayerReturn {
    videoRef: React.RefObject<HTMLVideoElement>;
    canvasRef: React.RefObject<HTMLCanvasElement>;
    fileInputRef: React.RefObject<HTMLInputElement>;
    localVideoUrl: string | null;
    localVideoName: string;
    setLocalVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;
    setLocalVideoName: React.Dispatch<React.SetStateAction<string>>;
    duration: number;
    currentTime: number;
    setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
    poseSequence: PoseResult[];
    setPoseSequence: React.Dispatch<React.SetStateAction<PoseResult[]>>;
    isAnalyzing: boolean;
    isUploading: boolean;
    handleLoadedMetadata: () => void;
    handleTimeUpdate: () => void;
    handleSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
    analyzeVideo: () => Promise<void>;
    handleVideoSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    captureFrameImage: () => string | undefined;
}

export function useVideoPlayer(
    initialVideoUrl: string | null | undefined,
    initialVideoName: string | undefined,
    strokeType: StrokeType,
    setMessage: (msg: string | null) => void
): UseVideoPlayerReturn {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(initialVideoUrl || null);
    const [localVideoName, setLocalVideoName] = useState<string>(initialVideoName || 'video');
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [poseSequence, setPoseSequence] = useState<PoseResult[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const handleLoadedMetadata = () => {
        if (videoRef.current) setDuration(videoRef.current.duration);
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (videoRef.current) videoRef.current.currentTime = time;
        setCurrentTime(time);
    };

    const analyzeVideo = useCallback(async () => {
        if (!localVideoUrl) return;
        setIsAnalyzing(true);
        setMessage('Analyzing poses in video...');
        try {
            const sequence = await MotionAnalysisService.analyzeVideo(localVideoUrl);
            setPoseSequence(sequence);
            setMessage(`Found ${sequence.length} frames with poses`);
        } catch {
            setMessage('Failed to analyze video');
        } finally {
            setIsAnalyzing(false);
        }
    }, [localVideoUrl, setMessage]);

    // Auto-analyze when URL changes
    useEffect(() => {
        if (localVideoUrl) void analyzeVideo();
    }, [analyzeVideo, localVideoUrl]);

    const handleVideoSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (localVideoUrl?.startsWith('blob:')) URL.revokeObjectURL(localVideoUrl);
        const localUrl = URL.createObjectURL(file);
        setLocalVideoUrl(localUrl);
        setLocalVideoName(file.name);
        setPoseSequence([]);
        if (trainingVideoService.isSupabaseConfigured()) {
            setIsUploading(true);
            setMessage('Uploading video to cloud...');
            try {
                const result = await trainingVideoService.uploadVideo(file, [strokeType]);
                if (result) {
                    URL.revokeObjectURL(localUrl);
                    setLocalVideoUrl(result.url);
                    setLocalVideoName(result.video.title);
                    setMessage('✓ Video uploaded to cloud');
                } else {
                    setMessage('Using local video (cloud upload failed)');
                }
            } catch {
                setMessage('Using local video (cloud upload failed)');
            } finally {
                setIsUploading(false);
            }
        } else {
            setMessage('Using local video (Supabase not configured)');
        }
    }, [localVideoUrl, strokeType, setMessage]);

    const captureFrameImage = (): string | undefined => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) return undefined;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(video, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.85);
    };

    // Draw pose overlay on canvas
    useEffect(() => {
        if (!canvasRef.current || !videoRef.current || poseSequence.length === 0) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        let closestPose: PoseResult | null = null;
        let minDiff = Infinity;
        for (const pose of poseSequence) {
            const diff = Math.abs(pose.timestamp - currentTime);
            if (diff < minDiff) { minDiff = diff; closestPose = pose; }
        }
        if (!closestPose) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const lm = closestPose.landmarks;
        const connections: [number, number][] = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24],
            [23, 25], [25, 27], [24, 26], [26, 28],
        ];
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        for (const [a, b] of connections) {
            if (lm[a] && lm[b]) {
                ctx.beginPath();
                ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
                ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
                ctx.stroke();
            }
        }
        ctx.fillStyle = '#34d399';
        for (let i = 11; i <= 28; i++) {
            if (lm[i]) {
                ctx.beginPath();
                ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 5, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        ctx.fillStyle = '#fbbf24';
        for (const idx of [15, 16]) {
            if (lm[idx]) {
                ctx.beginPath();
                ctx.arc(lm[idx].x * canvas.width, lm[idx].y * canvas.height, 8, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }, [currentTime, poseSequence]);

    return {
        videoRef, canvasRef, fileInputRef,
        localVideoUrl, localVideoName, setLocalVideoUrl, setLocalVideoName,
        duration, currentTime, setCurrentTime,
        poseSequence, setPoseSequence,
        isAnalyzing, isUploading,
        handleLoadedMetadata, handleTimeUpdate, handleSeek,
        analyzeVideo, handleVideoSelect, captureFrameImage,
    };
}
