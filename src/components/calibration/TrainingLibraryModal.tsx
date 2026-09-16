/**
 * TrainingLibraryModal.tsx
 * SRP: Modal grid for selecting or deleting training reference videos.
 */

import React from 'react';
import { ReferenceVideo } from '../../services/ReferenceVideoService';

interface TrainingLibraryModalProps {
    showLibrary: boolean;
    setShowLibrary: (v: boolean) => void;
    libraryVideos: ReferenceVideo[];
    loadingLibrary: boolean;
    onSelect: (video: ReferenceVideo) => void;
    onDelete: (event: React.MouseEvent<HTMLButtonElement>, video: ReferenceVideo) => Promise<void>;
}

export const TrainingLibraryModal: React.FC<TrainingLibraryModalProps> = ({
    showLibrary, setShowLibrary,
    libraryVideos, loadingLibrary,
    onSelect, onDelete,
}) => {
    if (!showLibrary) return null;
    return (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-60 p-3 sm:p-6">
            <div className="bg-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full sm:w-[min(56rem,92vw)] max-h-[90dvh] overflow-y-auto shadow-2xl border border-slate-700 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Training Library</h3>
                    <button onClick={() => setShowLibrary(false)} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white">Close</button>
                </div>

                {loadingLibrary ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
                    </div>
                ) : libraryVideos.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-400">No training videos available.</p>
                        <p className="text-xs text-slate-500 mt-2">Upload videos using the Upload button.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {libraryVideos.map(video => (
                            <div key={video.id} className="relative group bg-slate-900 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500"
                                onClick={() => onSelect(video)}>
                                {video.thumbnailUrl ? (
                                    <img src={video.thumbnailUrl} alt={video.title} className="w-full aspect-video object-cover" />
                                ) : (
                                    <div className="w-full aspect-video flex items-center justify-center bg-slate-800">
                                        <span className="text-3xl">🎬</span>
                                    </div>
                                )}
                                <div className="p-2">
                                    <p className="text-xs text-white font-medium truncate">{video.title}</p>
                                    {video.tags?.length > 0 && (
                                        <p className="text-xs text-slate-400 truncate">{video.tags.join(', ')}</p>
                                    )}
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); void onDelete(e, video); }}
                                    className="absolute top-1 right-1 w-6 h-6 bg-red-500/80 hover:bg-red-500 rounded-full text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Delete video"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
