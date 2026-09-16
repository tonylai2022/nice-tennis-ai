/**
 * SyncDialog.tsx
 * SRP: Calibration sync modal (export/import + cloud Supabase).
 */

import React from 'react';
import { CalibrationCloudSync } from '../../services/CalibrationCloudSync';

interface SyncDialogProps {
    showSyncDialog: boolean;
    setShowSyncDialog: (v: boolean) => void;
    syncImportMode: 'merge' | 'replace';
    setSyncImportMode: (v: 'merge' | 'replace') => void;
    syncPasteText: string;
    setSyncPasteText: (v: string) => void;
    cloudSyncKey: string;
    includeImagesInCloud: boolean;
    setIncludeImagesInCloud: (v: boolean) => void;
    calibrationImportRef: React.RefObject<HTMLInputElement>;
    saveCloudSyncKey: (key: string) => void;
    downloadCalibrationBundle: (includeImages: boolean) => void;
    copyCalibrationBundle: (includeImages: boolean) => Promise<void>;
    importCalibrationBundle: (json: string) => Promise<void>;
    handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    pushToSupabase: () => Promise<void>;
    pullFromSupabase: () => Promise<void>;
}

export const SyncDialog: React.FC<SyncDialogProps> = ({
    showSyncDialog, setShowSyncDialog,
    syncImportMode, setSyncImportMode,
    syncPasteText, setSyncPasteText,
    cloudSyncKey, includeImagesInCloud, setIncludeImagesInCloud,
    calibrationImportRef,
    saveCloudSyncKey,
    downloadCalibrationBundle, copyCalibrationBundle,
    importCalibrationBundle, handleImportFile,
    pushToSupabase, pullFromSupabase,
}) => {
    if (!showSyncDialog) return null;
    return (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-60 p-3 sm:p-6">
            <div className="bg-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full sm:w-[min(44rem,92vw)] max-h-[90dvh] overflow-y-auto shadow-2xl border border-slate-700 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-white">Sync Calibration (Laptop → Mobile)</h3>
                        <p className="text-sm text-slate-400 mt-1">Export on your laptop, send the file (AirDrop/Drive/Email), then import here.</p>
                    </div>
                    <button onClick={() => setShowSyncDialog(false)} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white">Close</button>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Export */}
                    <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-2">Export (Laptop)</h4>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                            <button onClick={() => downloadCalibrationBundle(true)} className="w-full sm:w-auto px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-sm">
                                Download JSON (with images)
                            </button>
                            <button onClick={() => downloadCalibrationBundle(false)} className="w-full sm:w-auto px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm" title="Smaller file, but reference-frame images won't sync">
                                Download JSON (no images)
                            </button>
                            <button onClick={() => copyCalibrationBundle(true)} className="w-full sm:w-auto px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm">
                                Copy to Clipboard
                            </button>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">Tip: "with images" is recommended so mobile shows the same pro frames.</p>
                    </div>

                    {/* Import */}
                    <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-2">Import (Mobile)</h4>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3">
                            <label className="text-xs text-slate-400">Mode</label>
                            <select value={syncImportMode} onChange={e => setSyncImportMode(e.target.value as 'merge' | 'replace')}
                                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm">
                                <option value="merge">Merge (recommended)</option>
                                <option value="replace">Replace (overwrite this device)</option>
                            </select>
                        </div>
                        <input ref={calibrationImportRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
                        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                            <button onClick={() => calibrationImportRef.current?.click()} className="w-full sm:w-auto px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-sm">
                                Import JSON File
                            </button>
                            <button onClick={() => importCalibrationBundle(syncPasteText)} disabled={!syncPasteText.trim()}
                                className="w-full sm:w-auto px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-sm">
                                Import Pasted JSON
                            </button>
                        </div>
                        <textarea value={syncPasteText} onChange={e => setSyncPasteText(e.target.value)}
                            placeholder="Paste sync JSON here (optional)"
                            className="mt-3 w-full h-24 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
                    </div>
                </div>

                {/* Cloud Sync */}
                <div className="mt-4 bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h4 className="text-sm font-semibold text-white">Cloud Sync (Supabase)</h4>
                            <p className="text-xs text-slate-400 mt-1">Use the same sync key on laptop + mobile. Laptop: Upload. Mobile: Download.</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${CalibrationCloudSync.isAvailable() ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-300'}`}>
                            {CalibrationCloudSync.isAvailable() ? 'Supabase connected' : 'Supabase not configured'}
                        </span>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Sync Key</label>
                            <input value={cloudSyncKey} onChange={e => saveCloudSyncKey(e.target.value)} placeholder="default"
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500" />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm text-slate-200">
                                <input type="checkbox" checked={includeImagesInCloud} onChange={e => setIncludeImagesInCloud(e.target.checked)} />
                                Include frame images
                            </label>
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={pushToSupabase} disabled={!CalibrationCloudSync.isAvailable() || !cloudSyncKey.trim()}
                            className="w-full sm:w-auto px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-white text-sm">
                            Upload to Cloud
                        </button>
                        <button onClick={pullFromSupabase} disabled={!CalibrationCloudSync.isAvailable() || !cloudSyncKey.trim()}
                            className="w-full sm:w-auto px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-sm">
                            Download from Cloud
                        </button>
                    </div>
                </div>

                <p className="mt-4 text-xs text-slate-400">After import, mobile will stop showing "No calibration data" and use your pro-calibrated frames.</p>
            </div>
        </div>
    );
};
