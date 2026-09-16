/**
 * WatchBridgeService
 *
 * Listens for motion data from the native iOS layer and computes derived
 * swing features from the raw Apple Watch samples.
 *
 * Communication channel:
 *   Native side (Swift): calls window.motionBridge.onMessage(jsonString)
 *   React side:          WatchBridgeService registers that handler and
 *                        dispatches a CustomEvent ('watchSession') on window.
 *
 * Usage:
 *   const bridge = WatchBridgeService.getInstance();
 *   bridge.onSession((session) => { ... });
 *   bridge.onSampleBatch((samples) => { ... });
 */

import type {
  NativeBridgePayload,
  SwingSession,
  SwingMotionFeatures,
  WatchMotionSample,
} from '../types/watch';

type SessionCallback = (session: SwingSession) => void;
type BatchCallback = (samples: WatchMotionSample[]) => void;
type ErrorCallback = (message: string) => void;

declare global {
  interface Window {
    motionBridge: {
      onMessage: (jsonString: string) => void;
    };
  }
}

export class WatchBridgeService {
  private static instance: WatchBridgeService | null = null;

  private sessionCallbacks: SessionCallback[] = [];
  private batchCallbacks: BatchCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  private liveSamples: WatchMotionSample[] = [];
  private currentSessionId: string | null = null;

  private constructor() {
    this._registerNativeHandler();
  }

  static getInstance(): WatchBridgeService {
    if (!WatchBridgeService.instance) {
      WatchBridgeService.instance = new WatchBridgeService();
    }
    return WatchBridgeService.instance;
  }

  // ── Subscription API ───────────────────────────────────────────────────────

  onSession(cb: SessionCallback): () => void {
    this.sessionCallbacks.push(cb);
    return () => {
      this.sessionCallbacks = this.sessionCallbacks.filter((f) => f !== cb);
    };
  }

  onSampleBatch(cb: BatchCallback): () => void {
    this.batchCallbacks.push(cb);
    return () => {
      this.batchCallbacks = this.batchCallbacks.filter((f) => f !== cb);
    };
  }

  onError(cb: ErrorCallback): () => void {
    this.errorCallbacks.push(cb);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((f) => f !== cb);
    };
  }

  /** Returns all samples collected so far in the current live session */
  getLiveSamples(): WatchMotionSample[] {
    return [...this.liveSamples];
  }

  // ── Native Bridge Registration ─────────────────────────────────────────────

  private _registerNativeHandler(): void {
    window.motionBridge = {
      onMessage: (jsonString: string) => {
        try {
          const payload = JSON.parse(jsonString) as NativeBridgePayload;
          this._handlePayload(payload);
        } catch (e) {
          console.error('[WatchBridge] Failed to parse native payload', e);
        }
      },
    };
  }

  private _handlePayload(payload: NativeBridgePayload): void {
    switch (payload.type) {
      case 'session_started':
        this.liveSamples = [];
        this.currentSessionId = payload.session?.sessionId ?? null;
        break;

      case 'sample_batch':
        if (payload.samples?.length) {
          this.liveSamples.push(...payload.samples);
          this.batchCallbacks.forEach((cb) => cb(payload.samples!));
        }
        break;

      case 'session_complete': {
        if (!payload.session) break;
        const session: SwingSession = {
          ...payload.session,
          swingFeatures: deriveSwingFeatures(payload.session.motionSamples),
        };
        this.liveSamples = [];
        this.currentSessionId = null;
        this.sessionCallbacks.forEach((cb) => cb(session));
        break;
      }

      case 'session_error':
        this.errorCallbacks.forEach((cb) =>
          cb(payload.error ?? 'Unknown watch error')
        );
        break;
    }
  }
}

// ── Feature Derivation ─────────────────────────────────────────────────────

/**
 * Computes SwingMotionFeatures from a raw sample array.
 * All math runs client-side — no server needed.
 */
export function deriveSwingFeatures(
  samples: WatchMotionSample[]
): SwingMotionFeatures {
  if (!samples.length) {
    return emptyFeatures();
  }

  // 1. Peak angular velocity
  let peakAngularVelocity = 0;
  let peakAcceleration = 0;

  for (const s of samples) {
    const angMag = magnitude(s.gyroX, s.gyroY, s.gyroZ);
    const accMag = magnitude(s.accelX, s.accelY, s.accelZ);
    if (angMag > peakAngularVelocity) peakAngularVelocity = angMag;
    if (accMag > peakAcceleration) peakAcceleration = accMag;
  }

  // 2. Detect impact frame: sample with largest angular velocity spike
  const impactIdx = samples.reduce(
    (bestIdx, s, i) =>
      magnitude(s.gyroX, s.gyroY, s.gyroZ) >
      magnitude(
        samples[bestIdx].gyroX,
        samples[bestIdx].gyroY,
        samples[bestIdx].gyroZ
      )
        ? i
        : bestIdx,
    0
  );

  // 3. Estimate backswing / forward swing duration
  // Backswing: from start to 50 % of the impact index
  // Forward swing: from 50 % of impact index to impact
  const halfIdx = Math.floor(impactIdx / 2);
  const backswingDurationMs =
    impactIdx > 0
      ? (samples[halfIdx].timestamp - samples[0].timestamp) * 1000
      : 0;
  const forwardSwingDurationMs =
    impactIdx > halfIdx
      ? (samples[impactIdx].timestamp - samples[halfIdx].timestamp) * 1000
      : 0;

  // 4. Impact window stability: average angular magnitude in ±5 frames around impact
  const windowStart = Math.max(0, impactIdx - 5);
  const windowEnd = Math.min(samples.length - 1, impactIdx + 5);
  const windowSamples = samples.slice(windowStart, windowEnd + 1);
  const impactStability =
    windowSamples.reduce(
      (sum, s) => sum + magnitude(s.gyroX, s.gyroY, s.gyroZ),
      0
    ) / (windowSamples.length || 1);

  // 5. Wrist roll at impact
  const impactWristRoll = samples[impactIdx]?.roll ?? 0;

  // 6. Overall motion score 0–100
  // Weights tuned for racket sports; adjust once you have reference data
  const angScore = Math.min(peakAngularVelocity / 20, 1) * 40; // 0–40
  const accScore = Math.min(peakAcceleration / 3, 1) * 20;     // 0–20
  const tempoScore =
    forwardSwingDurationMs > 0
      ? Math.max(0, 1 - Math.abs(forwardSwingDurationMs - 300) / 300) * 20
      : 0; // 0–20: penalise forward swings very far from 300 ms ideal
  const stabilityScore = Math.max(0, 1 - impactStability / 10) * 20; // 0–20

  const motionScore = Math.round(angScore + accScore + tempoScore + stabilityScore);

  return {
    peakAngularVelocity,
    peakAcceleration,
    forwardSwingDurationMs,
    backswingDurationMs,
    impactStability,
    impactWristRoll,
    motionScore: Math.min(motionScore, 100),
  };
}

function magnitude(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function emptyFeatures(): SwingMotionFeatures {
  return {
    peakAngularVelocity: 0,
    peakAcceleration: 0,
    forwardSwingDurationMs: 0,
    backswingDurationMs: 0,
    impactStability: 0,
    impactWristRoll: 0,
    motionScore: 0,
  };
}
