/**
 * CalibrationHeader.tsx
 * SRP: Sticky header with title, save status, profile badge, and action buttons.
 */

import React from 'react';
import { StrokeType } from '../../services/CalibrationService';

interface CalibrationHeaderProps {
    strokeType: StrokeType;
    isComplete: boolean;
    lastSavedLabel: string | null;
    activeProfileName: string | null;
    strokeExampleCount: number;
    onClose: () => void;
    onSync: () => void;
    onQuickSave: () => void;
    onSaveAs: () => void;
}

export const CalibrationHeader: React.FC<CalibrationHeaderProps> = ({
    isComplete, lastSavedLabel, activeProfileName, strokeExampleCount,
    onClose, onSync, onQuickSave, onSaveAs,
}) => (
    <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-sm flex flex-col gap-2 sm:gap-2.5 md:gap-3 md:flex-row md:items-center md:justify-between p-2.5 sm:p-3 md:p-4 border-b border-slate-700">
        <div className="min-w-0 flex items-center justify-between gap-2.5 sm:gap-3">
            <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg md:text-xl font-bold text-white truncate">Phase Calibration</h2>
                <div className="hidden md:flex items-center gap-2.5 lg:gap-3 mt-1">
                    <p className="text-xs sm:text-sm text-slate-400">Mark each phase in the video to train the AI</p>
                    {lastSavedLabel && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1 whitespace-nowrap">
                            💾 Saved {lastSavedLabel}
                        </span>
                    )}
                    {activeProfileName && (
                        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300 truncate">
                            📁 {activeProfileName}
                        </span>
                    )}
                </div>
            </div>
            <button
                onClick={onClose}
                className="md:hidden px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs sm:text-sm shrink-0 touch-target"
            >
                Close
            </button>
        </div>

        {/* Desktop action row */}
        <div className="hidden md:flex flex-wrap items-center gap-1.5 lg:gap-2.5">
            {isComplete && (
                <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs whitespace-nowrap">
                    ✓ Ready to use
                </span>
            )}
            <button onClick={onSync} className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white font-medium text-xs sm:text-sm whitespace-nowrap" title="Export/import calibration to sync with another device">
                🔄 Sync
            </button>
            <button onClick={onQuickSave} disabled={strokeExampleCount === 0}
                className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-white font-medium flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
                💾 Save
            </button>
            <button onClick={onSaveAs} disabled={strokeExampleCount === 0}
                className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-xs sm:text-sm whitespace-nowrap">
                Save As...
            </button>
            <button onClick={onClose} className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs sm:text-sm whitespace-nowrap">
                Close
            </button>
        </div>

        {/* Mobile secondary action row */}
        <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            {isComplete && (
                <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs whitespace-nowrap">✓ Ready</span>
            )}
            <button onClick={onSync} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-white text-xs whitespace-nowrap shrink-0 touch-target">🔄 Sync</button>
            <button onClick={onQuickSave} disabled={strokeExampleCount === 0}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-white text-xs whitespace-nowrap shrink-0 touch-target">
                💾 Save
            </button>
            <button onClick={onSaveAs} disabled={strokeExampleCount === 0}
                className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-xs whitespace-nowrap shrink-0 touch-target">
                Save As...
            </button>
        </div>
    </div>
);
