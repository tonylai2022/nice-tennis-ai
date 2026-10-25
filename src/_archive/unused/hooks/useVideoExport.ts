import { useState, useCallback } from 'react';
import { VideoExportService } from '../services/VideoExportService';
import type { ExportOptions } from '../services/VideoExportService';

export interface VideoExportState {
    isExporting: boolean;
    progress: number; // 0–100
    error: string | null;
    triggerExport: (opts: ExportOptions, filename: string) => Promise<void>;
}

export function useVideoExport(): VideoExportState {
    const [isExporting, setIsExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const triggerExport = useCallback(async (opts: ExportOptions, filename: string) => {
        setIsExporting(true);
        setProgress(0);
        setError(null);
        try {
            const blob = await VideoExportService.export({ ...opts, onProgress: setProgress });
            // Handing the blob off to the browser/OS save UI should not keep the app
            // stuck in an exporting state because mobile share/download flows can suspend
            // or navigate the page before the promise chain settles.
            setProgress(100);
            setIsExporting(false);
            await VideoExportService.download(blob, filename);
        } catch (err) {
            console.error('Video export failed', err);
            setError(err instanceof Error ? err.message : 'Export failed. Try a shorter clip or different browser.');
        } finally {
            setIsExporting(false);
        }
    }, []);

    return { isExporting, progress, error, triggerExport };
}
