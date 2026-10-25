/**
 * WatchImportService
 *
 * Parses motion-data files exported from free Apple Watch logging apps and
 * converts them into WatchMotionSample arrays that feed into deriveSwingFeatures.
 *
 * Supported formats
 * -----------------
 *  1. Sensor Logger (by Kelvin Jang) — free on App Store
 *     Records raw gyro + accel on the watch.
 *     Export: "Export" button → shares a .zip containing one CSV per sensor.
 *     Files inside the ZIP:
 *       Gyroscope.csv       columns: time, seconds_elapsed, x, y, z   (rad/s)
 *       Accelerometer.csv   columns: time, seconds_elapsed, x, y, z   (m/s²)
 *       Attitude.csv        columns: time, seconds_elapsed, roll, pitch, yaw (rad)  [optional]
 *
 *  2. Single merged CSV (generic)
 *     Any CSV with a header containing at least:
 *       timestamp (seconds), accelX, accelY, accelZ, gyroX, gyroY, gyroZ
 *     Column names are matched case-insensitively.
 *
 * Usage
 * -----
 *   // User picks file(s) with <input type="file">
 *   const result = await WatchImportService.importFiles(files);
 *   if (result.ok) {
 *     const features = deriveSwingFeatures(result.samples);
 *   }
 */

import type { WatchMotionSample } from '../types/watch';
import { deriveSwingFeatures } from './WatchBridgeService';
import type { SwingSession } from '../types/watch';

export interface ImportResult {
  ok: boolean;
  samples: WatchMotionSample[];
  session?: SwingSession;
  error?: string;
  sampleCount: number;
  durationSeconds: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

export class WatchImportService {
  /**
   * Main entry point. Accepts one of:
   *   - A single merged CSV file
   *   - Multiple CSV files (Gyroscope.csv, Accelerometer.csv, Attitude.csv)
   *   - A .zip file containing those CSVs (requires browser native ZIP support via DecompressionStream)
   */
  static async importFiles(files: FileList | File[]): Promise<ImportResult> {
    const arr = Array.from(files);

    try {
      if (arr.length === 1 && arr[0].name.toLowerCase().endsWith('.zip')) {
        return await this._importZip(arr[0]);
      }
      return await this._importCsvList(arr);
    } catch (e) {
      return {
        ok: false,
        samples: [],
        sampleCount: 0,
        durationSeconds: 0,
        error: `Import failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // ── ZIP import (Sensor Logger default export) ─────────────────────────────

  private static async _importZip(file: File): Promise<ImportResult> {
    // Use the browser-native DecompressionStream (available in all modern browsers)
    // For ZIP we need a more complete parser. We'll use a lightweight approach:
    // read the ZIP as ArrayBuffer and parse entries manually using the ZIP local
    // file header format (no external library needed).
    const buffer = await file.arrayBuffer();
    const entries = parseZipEntries(buffer);

    const csvFiles: { name: string; text: string }[] = [];
    for (const entry of entries) {
      if (entry.name.toLowerCase().endsWith('.csv')) {
        const text = new TextDecoder().decode(entry.data);
        csvFiles.push({ name: entry.name, text });
      }
    }

    if (!csvFiles.length) {
      return { ok: false, samples: [], sampleCount: 0, durationSeconds: 0,
               error: 'No CSV files found inside the ZIP.' };
    }

    return this._mergeSensorLoggerCsvs(csvFiles);
  }

  // ── Multiple CSV files ────────────────────────────────────────────────────

  private static async _importCsvList(files: File[]): Promise<ImportResult> {
    const csvFiles: { name: string; text: string }[] = [];
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.csv')) {
        csvFiles.push({ name: f.name, text: await f.text() });
      }
    }
    if (!csvFiles.length) {
      return { ok: false, samples: [], sampleCount: 0, durationSeconds: 0,
               error: 'No CSV files selected.' };
    }
    return this._mergeSensorLoggerCsvs(csvFiles);
  }

  // ── Merge Sensor Logger CSVs → WatchMotionSample[] ───────────────────────

  private static _mergeSensorLoggerCsvs(
    files: { name: string; text: string }[]
  ): ImportResult {
    const lc = (s: string) => s.toLowerCase();

    const gyroFile   = files.find(f => lc(f.name).includes('gyro'));
    const accelFile  = files.find(f => lc(f.name).includes('accel') || lc(f.name).includes('accelero'));
    const attFile    = files.find(f => lc(f.name).includes('attit') || lc(f.name).includes('orient'));

    // Single merged CSV fallback
    if (!gyroFile && !accelFile) {
      const merged = files[0];
      return this._parseMergedCsv(merged.text);
    }

    // Parse each sensor file
    const gyroRows  = gyroFile  ? parseSensorLoggerCsv(gyroFile.text)  : [];
    const accelRows = accelFile ? parseSensorLoggerCsv(accelFile.text) : [];
    const attRows   = attFile   ? parseSensorLoggerCsv(attFile.text)   : [];

    // Use accel timestamps as the master timeline; fill gyro by nearest neighbour
    const masterRows = accelRows.length ? accelRows : gyroRows;
    if (!masterRows.length) {
      return { ok: false, samples: [], sampleCount: 0, durationSeconds: 0,
               error: 'CSV files appear to be empty.' };
    }

    const G = 9.80665;
    const samples: WatchMotionSample[] = masterRows.map(row => {
      const t   = row.elapsed;
      const gRow = nearest(gyroRows, t);
      const aRow = attRows.length ? nearest(attRows, t) : null;

      return {
        timestamp: t,
        // Sensor Logger accel is in m/s² — convert to g
        accelX: (row.x ?? 0) / G,
        accelY: (row.y ?? 0) / G,
        accelZ: (row.z ?? 0) / G,
        // Gyro already in rad/s in Sensor Logger
        gyroX: gRow?.x ?? 0,
        gyroY: gRow?.y ?? 0,
        gyroZ: gRow?.z ?? 0,
        roll:  aRow?.x ?? 0,
        pitch: aRow?.y ?? 0,
        yaw:   aRow?.z ?? 0,
      };
    });

    return buildResult(samples);
  }

  // ── Single merged CSV (generic format) ───────────────────────────────────

  private static _parseMergedCsv(text: string): ImportResult {
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) {
      return { ok: false, samples: [], sampleCount: 0, durationSeconds: 0,
               error: 'CSV has fewer than 2 lines.' };
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const col = (names: string[]): number =>
      headers.findIndex(h => names.some(n => h.includes(n)));

    const iTime   = col(['timestamp','time','t','elapsed','seconds']);
    const iAx     = col(['accelx','ax','acceleration_x','acc_x']);
    const iAy     = col(['accely','ay','acceleration_y','acc_y']);
    const iAz     = col(['accelz','az','acceleration_z','acc_z']);
    const iGx     = col(['gyrox','gx','rotation_x','gyro_x','angular_x']);
    const iGy     = col(['gyroy','gy','rotation_y','gyro_y','angular_y']);
    const iGz     = col(['gyroz','gz','rotation_z','gyro_z','angular_z']);

    if (iTime < 0 || iAx < 0 || iGx < 0) {
      return { ok: false, samples: [], sampleCount: 0, durationSeconds: 0,
               error: 'Cannot identify required columns (timestamp, accel, gyro). ' +
                      'Expected headers like: timestamp, accelX, accelY, accelZ, gyroX, gyroY, gyroZ' };
    }

    const G = 9.80665;
    const samples: WatchMotionSample[] = [];
    const t0 = parseFloat(lines[1].split(',')[iTime]);

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      const t = parseFloat(cells[iTime]) - t0;
      const ax = parseFloat(cells[iAx] ?? '0');
      const ay = parseFloat(cells[iAy] ?? '0');
      const az = parseFloat(cells[iAz] ?? '0');
      const gx = parseFloat(cells[iGx] ?? '0');
      const gy = parseFloat(cells[iGy] ?? '0');
      const gz = parseFloat(cells[iGz] ?? '0');
      if (isNaN(t)) continue;

      // Auto-detect unit: if raw accel > 5 it's probably m/s², else g
      const accelScale = Math.abs(ax) > 5 || Math.abs(ay) > 5 || Math.abs(az) > 5
        ? 1 / G : 1;

      samples.push({
        timestamp: t, 
        accelX: ax * accelScale, accelY: ay * accelScale, accelZ: az * accelScale,
        gyroX: gx, gyroY: gy, gyroZ: gz,
        roll: 0, pitch: 0, yaw: 0,
      });
    }

    return buildResult(samples);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SensorRow { elapsed: number; x: number; y: number; z: number; }

function parseSensorLoggerCsv(text: string): SensorRow[] {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iElapsed = headers.findIndex(h => h.includes('second') || h.includes('elapsed'));
  // Sensor Logger columns are  time, seconds_elapsed, z, y, x  (yes, ZYX order)
  const iZ = headers.findIndex(h => h === 'z');
  const iY = headers.findIndex(h => h === 'y');
  const iX = headers.findIndex(h => h === 'x');

  if (iElapsed < 0 || iX < 0) return [];

  const rows: SensorRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    rows.push({
      elapsed: parseFloat(c[iElapsed] ?? '0'),
      x: parseFloat(c[iX] ?? '0'),
      y: parseFloat(c[iY] ?? '0'),
      z: parseFloat(c[iZ] ?? '0'),
    });
  }
  return rows;
}

function nearest(rows: SensorRow[], t: number): SensorRow | null {
  if (!rows.length) return null;
  let best = rows[0], bestDist = Math.abs(rows[0].elapsed - t);
  for (const r of rows) {
    const d = Math.abs(r.elapsed - t);
    if (d < bestDist) { best = r; bestDist = d; }
    if (r.elapsed > t + 0.1) break; // rows are sorted, no need to scan further
  }
  return best;
}

function buildResult(samples: WatchMotionSample[]): ImportResult {
  if (!samples.length) {
    return { ok: false, samples: [], sampleCount: 0, durationSeconds: 0,
             error: 'No valid samples parsed from the file.' };
  }
  const duration = samples[samples.length - 1].timestamp - samples[0].timestamp;
  const session: SwingSession = {
    sessionId: `import-${Date.now()}`,
    startedAt: Date.now(),
    videoFileName: '',
    motionSamples: samples,
    swingFeatures: deriveSwingFeatures(samples),
  };
  return { ok: true, samples, session, sampleCount: samples.length, durationSeconds: duration };
}

// ── Minimal ZIP parser (no external library) ──────────────────────────────────
// Reads local file headers only (no central directory needed for our purposes).

interface ZipEntry { name: string; data: Uint8Array; }

function parseZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 < bytes.length) {
    // Local file header signature: 0x04034b50
    if (view.getUint32(offset, true) !== 0x04034b50) break;

    const compression    = view.getUint16(offset + 8,  true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen        = view.getUint16(offset + 26, true);
    const extraLen       = view.getUint16(offset + 28, true);
    const dataOffset     = offset + 30 + nameLen + extraLen;

    const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    if (compression === 0) {
      // Stored (no compression)
      const data = bytes.slice(dataOffset, dataOffset + compressedSize);
      entries.push({ name, data });
    }
    // Deflate (compression === 8) needs DecompressionStream which is async —
    // Sensor Logger default exports use "Store" for CSV files, so this covers most cases.
    // If the file is deflated, we skip it and let the caller handle the error gracefully.

    offset = dataOffset + compressedSize;
  }
  return entries;
}
