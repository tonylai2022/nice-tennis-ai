/**
 * WatchMetricsPanel
 *
 * Shows Apple Watch motion metrics in the feedback screen.
 *
 * HOW IT WORKS ($0, no native app, no developer account):
 *   1. User records their swing video in MotionTutor.
 *   2. Simultaneously, they run "Sensor Logger" (free on App Store) on their Apple Watch.
 *   3. After recording, they tap Export in Sensor Logger → share the ZIP to this page.
 *   4. This panel parses the ZIP, derives swing features, and shows them here.
 *
 * Also accepts: Gyroscope.csv / Accelerometer.csv individually, or any merged CSV.
 */

import React, { useRef, useState } from 'react';
import { WatchImportService } from '../services/WatchImportService';
import type { SwingSession } from '../types/watch';

export function WatchMetricsPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [session, setSession]     = useState<SwingSession | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    setError(null);
    const result = await WatchImportService.importFiles(files);
    setImporting(false);
    if (result.ok && result.session) {
      setSession(result.session);
    } else {
      setError(result.error ?? 'Import failed.');
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white/80 uppercase tracking-wide text-xs">
          ⌚ Watch Motion Metrics
        </h3>
        <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
          Sensor Logger
        </span>
      </div>

      {/* How-to hint (shown before first import) */}
      {!session && !importing && (
        <div className="mb-3 text-xs text-white/50 leading-relaxed space-y-1">
          <p>
            1. Install <span className="text-white/70 font-medium">Sensor Logger</span> (free, App Store) on your Apple Watch.
          </p>
          <p>2. Start a recording on the watch before your swing.</p>
          <p>3. Stop, then tap <span className="text-white/70 font-medium">Export → Share</span> and send the ZIP here.</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-red-400 text-xs mb-3 leading-relaxed bg-red-500/10 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      {/* Import button */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={importing}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1.5"
        >
          {importing ? (
            <>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Importing…
            </>
          ) : (
            <>{session ? '↺ Re-import' : '⬆ Import Watch Data'}</>
          )}
        </button>
        {session && (
          <span className="text-xs text-white/40">
            {session.motionSamples.length} samples · {session.swingFeatures?.motionScore ?? 0}/100
          </span>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.csv"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {/* Derived features */}
      {session?.swingFeatures && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-1">
          <MetricRow label="Motion Score"       value={`${session.swingFeatures.motionScore} / 100`} highlight />
          <MetricRow label="Peak Angular Vel."  value={`${session.swingFeatures.peakAngularVelocity.toFixed(1)} rad/s`} />
          <MetricRow label="Peak Acceleration"  value={`${session.swingFeatures.peakAcceleration.toFixed(2)} g`} />
          <MetricRow label="Forward Swing"      value={`${Math.round(session.swingFeatures.forwardSwingDurationMs)} ms`} />
          <MetricRow label="Backswing"           value={`${Math.round(session.swingFeatures.backswingDurationMs)} ms`} />
          <MetricRow label="Impact Stability"   value={`${session.swingFeatures.impactStability.toFixed(2)} rad/s`} />
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-white/40 text-[10px] uppercase tracking-wide">{label}</p>
      <p className={`font-semibold ${highlight ? 'text-green-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}


