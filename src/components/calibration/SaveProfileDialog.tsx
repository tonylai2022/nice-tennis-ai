/**
 * SaveProfileDialog.tsx
 * SRP: Modal for saving a training profile with a custom name.
 */

import React from 'react';
import { StrokeType } from '../../services/CalibrationService';

interface SaveProfileDialogProps {
    showSaveDialog: boolean;
    setShowSaveDialog: (v: boolean) => void;
    newProfileName: string;
    setNewProfileName: (v: string) => void;
    strokeType: StrokeType;
    onSave: () => void;
}

export const SaveProfileDialog: React.FC<SaveProfileDialogProps> = ({
    showSaveDialog, setShowSaveDialog,
    newProfileName, setNewProfileName,
    strokeType, onSave,
}) => {
    if (!showSaveDialog) return null;
    return (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-60 p-3 sm:p-6">
            <div className="bg-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full sm:w-[min(24rem,92vw)] max-h-[85dvh] overflow-y-auto shadow-2xl border border-slate-700 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <h3 className="text-lg font-bold text-white mb-4">Save Training Profile</h3>
                <p className="text-sm text-slate-400 mb-4">Give your training data a name so you can easily load it later.</p>
                <input
                    type="text"
                    value={newProfileName}
                    onChange={e => setNewProfileName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
                    placeholder={`e.g. "${strokeType.charAt(0).toUpperCase() + strokeType.slice(1)} - Pro Style"`}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 mb-4"
                    autoFocus
                />
                <div className="flex gap-2">
                    <button onClick={onSave} disabled={!newProfileName.trim()}
                        className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
                        Save Profile
                    </button>
                    <button onClick={() => setShowSaveDialog(false)}
                        className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
