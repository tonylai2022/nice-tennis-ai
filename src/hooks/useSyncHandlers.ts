/**
 * useSyncHandlers.ts
 * SRP: Manages sync/export/import state and operations.
 */

import { useState, useRef, useCallback } from 'react';
import { CalibrationService } from '../services/CalibrationService';
import { CalibrationCloudSync } from '../services/CalibrationCloudSync';

interface UseSyncHandlersReturn {
    calibrationImportRef: React.RefObject<HTMLInputElement>;
    showSyncDialog: boolean;
    setShowSyncDialog: (v: boolean) => void;
    syncImportMode: 'merge' | 'replace';
    setSyncImportMode: (v: 'merge' | 'replace') => void;
    syncPasteText: string;
    setSyncPasteText: (v: string) => void;
    cloudSyncKey: string;
    includeImagesInCloud: boolean;
    setIncludeImagesInCloud: (v: boolean) => void;
    saveCloudSyncKey: (key: string) => void;
    downloadCalibrationBundle: (includeImages: boolean) => void;
    copyCalibrationBundle: (includeImages: boolean) => Promise<void>;
    importCalibrationBundle: (json: string) => Promise<void>;
    handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    pushToSupabase: () => Promise<void>;
    pullFromSupabase: () => Promise<void>;
}

export function useSyncHandlers(
    refreshCalibrationState: () => void,
    setMessage: (msg: string | null) => void
): UseSyncHandlersReturn {
    const calibrationImportRef = useRef<HTMLInputElement>(null);
    const [showSyncDialog, setShowSyncDialog] = useState(false);
    const [syncImportMode, setSyncImportMode] = useState<'merge' | 'replace'>('merge');
    const [syncPasteText, setSyncPasteText] = useState('');
    const [cloudSyncKey, setCloudSyncKey] = useState<string>(() => {
        try { return localStorage.getItem('calibration_cloud_sync_key') || 'default'; } catch { return 'default'; }
    });
    const [includeImagesInCloud, setIncludeImagesInCloud] = useState(true);

    const saveCloudSyncKey = useCallback((key: string) => {
        setCloudSyncKey(key);
        try { localStorage.setItem('calibration_cloud_sync_key', key); } catch { /* ignore */ }
    }, []);

    const downloadCalibrationBundle = useCallback((includeImages: boolean) => {
        try {
            const json = CalibrationService.exportBundle({ includeFrameImages: includeImages });
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `motiontutor-calibration-sync-${date}${includeImages ? '' : '-no-images'}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setMessage('Downloaded calibration sync file');
        } catch {
            setMessage('Failed to export calibration');
        }
    }, [setMessage]);

    const copyCalibrationBundle = useCallback(async (includeImages: boolean) => {
        try {
            const json = CalibrationService.exportBundle({ includeFrameImages: includeImages });
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(json);
                setMessage('Copied sync code to clipboard');
            } else {
                setSyncPasteText(json);
                setMessage('Clipboard unavailable — sync code placed in text box');
            }
        } catch {
            setMessage('Failed to copy calibration');
        }
    }, [setMessage]);

    const importCalibrationBundle = useCallback(async (json: string) => {
        const result = CalibrationService.importBundle(json, { mode: syncImportMode });
        if (result.ok) {
            refreshCalibrationState();
            setMessage(`Imported calibration: ${result.importedExamples} examples, ${result.importedProfiles} profiles`);
            setShowSyncDialog(false);
            setSyncPasteText('');
        } else {
            setMessage(result.message || 'Failed to import calibration');
        }
    }, [syncImportMode, refreshCalibrationState, setMessage]);

    const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            await importCalibrationBundle(text);
        } catch {
            setMessage('Failed to read import file');
        } finally {
            e.target.value = '';
        }
    }, [importCalibrationBundle, setMessage]);

    const pushToSupabase = useCallback(async () => {
        if (!CalibrationCloudSync.isAvailable()) { setMessage('Supabase not configured'); return; }
        try {
            setMessage('Uploading calibration to cloud...');
            const json = CalibrationService.exportBundle({ includeFrameImages: includeImagesInCloud });
            const res = await CalibrationCloudSync.uploadBundle(cloudSyncKey, json);
            setMessage(res.ok ? '✓ Uploaded calibration to cloud' : (res.message || 'Upload failed'));
        } catch {
            setMessage('Upload failed');
        }
    }, [cloudSyncKey, includeImagesInCloud, setMessage]);

    const pullFromSupabase = useCallback(async () => {
        if (!CalibrationCloudSync.isAvailable()) { setMessage('Supabase not configured'); return; }
        try {
            setMessage('Downloading calibration from cloud...');
            const res = await CalibrationCloudSync.downloadBundle(cloudSyncKey);
            if (res.ok && res.bundleJson) {
                await importCalibrationBundle(res.bundleJson);
            } else {
                setMessage(res.message || 'Download failed');
            }
        } catch {
            setMessage('Download failed');
        }
    }, [cloudSyncKey, importCalibrationBundle, setMessage]);

    return {
        calibrationImportRef,
        showSyncDialog, setShowSyncDialog,
        syncImportMode, setSyncImportMode,
        syncPasteText, setSyncPasteText,
        cloudSyncKey, includeImagesInCloud, setIncludeImagesInCloud,
        saveCloudSyncKey,
        downloadCalibrationBundle, copyCalibrationBundle,
        importCalibrationBundle, handleImportFile,
        pushToSupabase, pullFromSupabase,
    };
}
