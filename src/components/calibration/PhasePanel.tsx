/**
 * PhasePanel.tsx
 * SRP: Phase selection list, examples list, and actions panel (mobile + desktop).
 */

import React from 'react';
import { CalibrationService, CalibrationExample, CalibrationProfile, PhaseType, StrokeType } from '../../services/CalibrationService';

const PHASE_LABELS: Record<string, string> = {
    unit_turn: 'Unit Turn', racket_drop: 'Racket Drop', contact: 'Contact', follow_through: 'Follow Through',
    preparation: 'Preparation', ball_toss: 'Ball Toss', loading: 'Loading/Trophy', finish: 'Finish',
};
const PHASE_DESCRIPTIONS: Record<string, string> = {
    unit_turn: 'Shoulders rotated, racket back, weight on back foot',
    racket_drop: 'Racket head drops below hand, knees bent, ready to swing',
    contact: 'Ball contact moment - peak speed, arm extended',
    follow_through: 'Swing complete, racket crossed to opposite side',
    preparation: 'Ready stance before starting motion',
    ball_toss: 'Toss arm at highest point, ball in air',
    loading: 'Trophy pose - knees bent, racket behind back',
    finish: 'Motion complete, landing/recovery',
};

interface PhasePanelProps {
    phases: readonly PhaseType[];
    selectedPhase: PhaseType | null;
    setSelectedPhase: (p: PhaseType) => void;
    exampleCounts: Record<string, number>;
    strokeExamples: CalibrationExample[];
    strokeProfiles: CalibrationProfile[];
    mobilePanelOpen: boolean;
    setMobilePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    mobilePanelTab: 'phases' | 'examples' | 'actions';
    setMobilePanelTab: (t: 'phases' | 'examples' | 'actions') => void;
    isComplete: boolean;
    poseSequenceLength: number;
    strokeType: StrokeType;
    onMarkPhase: () => void;
    onJumpToExample: (timestamp: number) => void;
    onRemoveExample: (id: string) => void;
    onLoadProfile: (profileId: string) => void;
    onDeleteProfile: (profileId: string, name: string) => void;
    onCalibrationComplete?: () => void;
    onClose: () => void;
    onExportData: () => void;
    onImportData: () => void;
    onClearAll: () => void;
}

export const PhasePanel: React.FC<PhasePanelProps> = ({
    phases, selectedPhase, setSelectedPhase, exampleCounts,
    strokeExamples, strokeProfiles, mobilePanelOpen, setMobilePanelOpen,
    mobilePanelTab, setMobilePanelTab, isComplete, poseSequenceLength, strokeType,
    onMarkPhase, onJumpToExample, onRemoveExample, onLoadProfile, onDeleteProfile,
    onCalibrationComplete, onClose, onExportData, onImportData, onClearAll,
}) => {
    const phaseList = (
        <div className="space-y-2">
            {phases.map(phase => (
                <button key={phase} onClick={() => setSelectedPhase(phase)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${selectedPhase === phase ? 'bg-emerald-500/20 border border-emerald-500 text-emerald-400' : 'bg-slate-800 hover:bg-slate-700 text-white'}`}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{PHASE_LABELS[phase]}</span>
                        <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${(exampleCounts[phase] || 0) >= 2 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            {exampleCounts[phase] || 0} examples
                        </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{PHASE_DESCRIPTIONS[phase]}</p>
                </button>
            ))}
        </div>
    );

    const markBtn = (full: boolean) => (
        <button onClick={onMarkPhase} disabled={!selectedPhase || poseSequenceLength === 0}
            className={`w-full mt-4 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-white font-semibold transition-colors ${full ? '' : 'shadow-lg'} text-sm sm:text-base touch-target`}>
            {selectedPhase ? `📍 Mark "${PHASE_LABELS[selectedPhase]}" Here` : '📍 Select Phase Above First'}
        </button>
    );

    const exampleList = (
        <div className="space-y-2">
            {strokeExamples.length === 0 ? (
                <p className="text-xs sm:text-sm text-slate-400">No examples marked yet. Mark at least 2 examples per phase.</p>
            ) : strokeExamples.slice().sort((a, b) => a.timestamp - b.timestamp).map(example => (
                <div key={example.id} className="p-2.5 sm:p-3 bg-slate-800 rounded-lg flex items-center justify-between gap-2 group touch-target">
                    <button onClick={() => onJumpToExample(example.timestamp)} className="flex-1 text-left min-w-0">
                        <span className="text-xs sm:text-sm text-white truncate block">{PHASE_LABELS[example.phase]}</span>
                        <span className="text-xs text-slate-400">@ {example.timestamp.toFixed(2)}s</span>
                    </button>
                    <button onClick={() => onRemoveExample(example.id)}
                        className="px-2 sm:px-2.5 py-1.5 text-red-400 hover:text-red-300 text-sm shrink-0 touch-target opacity-0 group-hover:opacity-100"
                        aria-label="Remove example">✕</button>
                </div>
            ))}
        </div>
    );

    const actionSection = (
        <div className="space-y-2">
            {isComplete && (
                <button onClick={() => { onCalibrationComplete?.(); onClose(); }}
                    className="w-full px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-white font-semibold text-sm touch-target">
                    ✓ Done - Use Calibrated Model
                </button>
            )}
            <div className="flex gap-2">
                <button onClick={onExportData} className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">Export</button>
                <button onClick={onImportData} className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs sm:text-sm text-white touch-target">Import</button>
            </div>
            <button onClick={onClearAll} className="w-full px-3 py-2 bg-red-500/20 hover:bg-red-500/30 rounded text-xs sm:text-sm text-red-400 touch-target">Clear All Data</button>
            {strokeProfiles.length > 0 && (
                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-slate-700">
                    <h4 className="text-xs sm:text-sm font-medium text-slate-300 mb-2">Saved Profiles</h4>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                        {strokeProfiles.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(profile => (
                            <div key={profile.id} className="flex items-center gap-2 p-2 sm:p-2.5 bg-slate-800 rounded text-xs sm:text-sm group touch-target">
                                <button onClick={() => onLoadProfile(profile.id)}
                                    className="flex-1 text-left text-white hover:text-emerald-400 min-w-0" title={`Load "${profile.name}"`}>
                                    <span className="font-medium truncate block">{profile.name}</span>
                                    <span className="text-xs text-slate-400">({profile.exampleCount} examples)</span>
                                </button>
                                <button onClick={() => onDeleteProfile(profile.id, profile.name)}
                                    className="text-red-400 hover:text-red-300 px-2 shrink-0 opacity-0 group-hover:opacity-100" title="Delete profile">✕</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="w-full md:w-96 lg:w-80 xl:w-96 2xl:w-[28rem] border-t md:border-t-0 md:border-l border-slate-700 flex flex-col overflow-hidden bg-slate-900/50 md:bg-transparent">
            {/* Mobile drawer header */}
            <div className="md:hidden border-b border-slate-700 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
                <button type="button" onClick={() => setMobilePanelOpen(v => !v)}
                    className="w-full px-3 sm:px-4 py-3 text-left touch-target" aria-expanded={mobilePanelOpen}>
                    <div className="flex flex-col items-center gap-2">
                        <div className="h-1.5 w-12 rounded-full bg-slate-600/70" />
                        <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs sm:text-sm font-semibold text-white">Phase Panel</span>
                                {isComplete && <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Ready</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">{strokeExamples.length} marked</span>
                                <span className="text-slate-300 text-sm">{mobilePanelOpen ? '▾' : '▴'}</span>
                            </div>
                        </div>
                    </div>
                </button>
                {mobilePanelOpen && (
                    <div className="px-2.5 sm:px-3 pb-3">
                        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 bg-slate-800/50 p-1 rounded-lg">
                            {(['phases', 'examples', 'actions'] as const).map(tab => (
                                <button key={tab} type="button" onClick={() => setMobilePanelTab(tab)}
                                    className={`px-2.5 sm:px-3 py-2 rounded-md text-xs font-semibold transition-colors touch-target ${mobilePanelTab === tab ? 'bg-emerald-400 text-slate-900' : 'text-slate-200 hover:bg-slate-700'}`}>
                                    {tab === 'examples' ? `Examples (${strokeExamples.length})` : tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Mobile content */}
            {mobilePanelOpen && (
                <div className="md:hidden overflow-y-auto max-h-[calc(50vh-3rem)] sm:max-h-[calc(50vh-3.5rem)]">
                    {mobilePanelTab === 'phases' && (
                        <div className="p-4 border-b border-slate-700">
                            <h3 className="font-semibold text-white mb-2">Select Phase to Mark</h3>
                            <p className="text-xs text-slate-400 mb-4">Scrub to the correct frame, select a phase, then tap "Mark Phase".</p>
                            {phaseList}
                            {markBtn(false)}
                        </div>
                    )}
                    {mobilePanelTab === 'examples' && (
                        <div className="p-3 sm:p-4">
                            <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">Marked Examples ({strokeExamples.length})</h3>
                            {exampleList}
                        </div>
                    )}
                    {mobilePanelTab === 'actions' && (
                        <div className="p-3 sm:p-4 space-y-2 sm:space-y-2.5">{actionSection}</div>
                    )}
                </div>
            )}

            {/* Mobile sticky mark button */}
            {mobilePanelOpen && mobilePanelTab === 'phases' && (
                <div className="md:hidden sticky bottom-0 left-0 right-0 p-3 sm:p-4 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 z-20">
                    {markBtn(false)}
                </div>
            )}

            {/* Desktop content */}
            <div className="hidden md:flex md:flex-col md:flex-1 md:overflow-hidden">
                <div className="p-4 border-b border-slate-700">
                    <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">Select Phase to Mark</h3>
                    <p className="text-xs sm:text-sm text-slate-400 mb-4">Scrub to the correct frame, select a phase, then click "Mark Phase"</p>
                    {phaseList}
                    {markBtn(true)}
                </div>
                <div className="flex-1 overflow-auto p-4">
                    <h3 className="font-semibold text-white mb-2 text-sm sm:text-base">Marked Examples ({strokeExamples.length})</h3>
                    {exampleList}
                </div>
                <div className="p-4 border-t border-slate-700 space-y-2">{actionSection}</div>
            </div>
        </div>
    );
};
