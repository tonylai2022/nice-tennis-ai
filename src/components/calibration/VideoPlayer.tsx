/**
 * VideoPlayer.tsx
 * SRP: Video element, canvas pose overlay, timeline controls, and upload/analyze states.
 */

import React from 'react';
import { PoseResult } from '../../services/MotionAnalysisRouter';

interface VideoPlayerProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    canvasRef: React.RefObject<HTMLCanvasElement>;
    fileInputRef: React.RefObject<HTMLInputElement>;
    localVideoUrl: string | null;
    currentTime: number;
    duration: number;
    isAnalyzing: boolean;
    isUploading: boolean;
    poseSequence: PoseResult[];
    message: string | null;
    onLoadedMetadata: () => void;
    onTimeUpdate: () => void;
    onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onVideoSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    onUploadClick: () => void;
    onOpenLibrary: () => void;
    onFrameBack: () => void;
    onFrameForward: () => void;
    onPlayPause: () => void;
    onSlowmo: () => void;
    onNormalSpeed: () => void;
    isPlaying: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
    videoRef, canvasRef, fileInputRef,
    localVideoUrl, currentTime, duration,
    isAnalyzing, isUploading, poseSequence,
    message,
    onLoadedMetadata, onTimeUpdate, onSeek, onVideoSelect,
    onUploadClick, onOpenLibrary,
    onFrameBack, onFrameForward, onPlayPause, onSlowmo, onNormalSpeed,
    isPlaying,
}) => (
    <div className="flex-none md:flex-1 flex flex-col min-w-0 md:overflow-y-auto">
        {/* Video container */}
        <div className="p-2 sm:p-3 md:p-4">
            <div className="relative bg-black rounded-lg overflow-hidden h-[35vh] sm:h-[45vh] md:h-[50vh] lg:h-auto lg:aspect-video">
                {localVideoUrl ? (
                    <>
                        <video ref={videoRef} src={localVideoUrl} className="w-full h-full object-contain"
                            crossOrigin="anonymous" onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} />
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                        {isUploading && (
                            <div className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-emerald-500/90 rounded-lg text-xs sm:text-sm text-white flex items-center gap-2">
                                <div className="animate-spin w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full" />
                                Uploading to cloud...
                            </div>
                        )}
                        <div className="absolute top-2 sm:top-3 right-2 sm:right-3 flex gap-1.5 sm:gap-2">
                            <button onClick={onUploadClick} disabled={isUploading}
                                className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 rounded text-xs sm:text-sm text-white touch-target">
                                📁 Upload
                            </button>
                            <button onClick={onOpenLibrary} disabled={isUploading}
                                className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 rounded text-xs sm:text-sm text-white touch-target">
                                📹 Training
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center p-3 sm:p-6 md:p-8">
                        <div className="text-4xl sm:text-5xl md:text-6xl mb-2 sm:mb-3 md:mb-4">🎬</div>
                        <h3 className="text-base sm:text-lg md:text-xl font-bold text-white mb-1 sm:mb-2">Load a Video to Calibrate</h3>
                        <p className="text-xs sm:text-sm text-slate-400 mb-3 sm:mb-4 md:mb-6 max-w-sm md:max-w-md">
                            Select a tennis video to mark the phases. Use a video with clear, full-body motion.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                            <button onClick={onUploadClick}
                                className="px-3 sm:px-6 py-2 sm:py-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-semibold flex items-center justify-center gap-2 text-sm sm:text-base touch-target">
                                📁 Upload Video
                            </button>
                            <button onClick={onOpenLibrary}
                                className="px-3 sm:px-6 py-2 sm:py-3 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-white font-semibold flex items-center justify-center gap-2 text-sm sm:text-base touch-target">
                                📹 Training Library
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-2 sm:mt-3">MP4, MOV, WebM supported</p>
                    </div>
                )}
                {isAnalyzing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="text-center">
                            <div className="animate-spin w-10 h-10 sm:w-12 sm:h-12 border-4 border-emerald-500 border-t-transparent rounded-full mx-auto mb-3 sm:mb-4" />
                            <p className="text-white text-sm sm:text-base">Analyzing video poses...</p>
                        </div>
                    </div>
                )}
            </div>
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={onVideoSelect} />
        </div>

        {/* Timeline + controls */}
        <div className="sticky bottom-0 md:static bg-black/95 md:bg-transparent backdrop-blur-sm md:backdrop-blur-none border-t border-slate-700 p-2 sm:p-3 md:p-4 space-y-2 md:space-y-2.5 z-10">
            <div className="flex items-center gap-1.5 sm:gap-2.5 md:gap-4">
                <span className="text-xs sm:text-sm text-slate-400 w-10 sm:w-12 md:w-16 shrink-0">{currentTime.toFixed(2)}s</span>
                <input type="range" min={0} max={duration} step={0.01} value={currentTime} onChange={onSeek}
                    className="flex-1 h-2 rounded-lg appearance-none bg-slate-700 cursor-pointer" />
                <span className="hidden sm:inline text-xs sm:text-sm text-slate-400 w-10 sm:w-12 md:w-16 text-right">{duration.toFixed(2)}s</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 md:gap-2">
                <button onClick={onFrameBack} className="px-2 sm:px-2.5 md:px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">← Frame</button>
                <button onClick={onFrameForward} className="px-2 sm:px-2.5 md:px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">Frame →</button>
                <button onClick={onPlayPause} className="px-2 sm:px-2.5 md:px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <button onClick={onSlowmo} className="px-2 sm:px-2.5 md:px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">0.25x</button>
                <button onClick={onNormalSpeed} className="px-2 sm:px-2.5 md:px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">1x</button>
            </div>
            {message && <div className="p-2 bg-slate-800 rounded text-xs sm:text-sm text-slate-300">{message}</div>}
        </div>
    </div>
);
