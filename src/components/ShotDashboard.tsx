/**
 * ShotDashboard – interactive performance dashboard for MotionTutor.
 *
 * Sections:
 *   1. CompositeScoreCard  – large score + rank badge + percentile text
 *   2. RadarAndGauge       – hexagonal radar (attributes) + speedometer gauge
 *   3. AngleAnalysis       – interactive SVG joint-angle line chart (collapsible)
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { RichTip } from '../services/VideoTutor';
import type { FreeTip } from '../services/coaching/FreeTennisCoach';
import type { PoseResult } from '../services/MotionAnalysisRouter';

// Convert FreeTip[] to RichTip[] so ShotDashboard can render them
const METRIC_CFG: Record<string, { icon: string; abbr: string }> = {
  // current joint-named titles
  'Shoulder turn': { icon: '🔄', abbr: 'SHT' },
  'Hip drive': { icon: '⚡', abbr: 'HIP' },
  'Kinetic chain': { icon: '🔗', abbr: 'KCH' },
  'Elbow at finish': { icon: '🏁', abbr: 'ELF' },
  'Elbow at contact': { icon: '🎾', abbr: 'ELC' },
  'Knee bend': { icon: '⚖️', abbr: 'KNE' },
  // legacy / fallback titles kept for backwards compat
  'Prep': { icon: '🔄', abbr: 'PRE' },
  'Kinetics': { icon: '⚡', abbr: 'KIN' },
  'Timing': { icon: '🎯', abbr: 'TIM' },
  'Finish': { icon: '🏁', abbr: 'FIN' },
  'Racket Face': { icon: '🎾', abbr: 'RFC' },
  'Stability': { icon: '⚖️', abbr: 'STB' },
};
const TIP_ICONS = ['⚡', '🎯', '🔄', '⚖️', '💪', '🏆'];
function freeTipsToRich(tips: FreeTip[]): RichTip[] {
  return tips.map((t, i) => {
    const cfg = METRIC_CFG[t.title];
    return {
      label: t.title,
      abbr: cfg?.abbr ?? t.title.slice(0, 3).toUpperCase(),
      score: t.score,
      detail: t.detail,
      short: t.short,
      icon: cfg?.icon ?? TIP_ICONS[i % TIP_ICONS.length],
      rawValue: t.rawValue,
      rawUnit: t.rawUnit,
    };
  });
}

// ─── MediaPipe landmark indices (after YOLO→MP remapping) ───────────────────
const MP = {
  LS: 11, RS: 12,
  LE: 13, RE: 14,
  LW: 15, RW: 16,
  LH: 23, RH: 24,
  LK: 25, RK: 26,
  LA: 27, RA: 28,
} as const;

// ─── Geometry helpers ────────────────────────────────────────────────────────
function pt(lm: any[], idx: number): { x: number; y: number } | null {
  const l = lm[idx];
  return l ? { x: l.x, y: l.y } : null;
}

function angle3(
  A: { x: number; y: number } | null,
  B: { x: number; y: number } | null,
  C: { x: number; y: number } | null,
): number {
  if (!A || !B || !C) return 0;
  const dx1 = A.x - B.x, dy1 = A.y - B.y;
  const dx2 = C.x - B.x, dy2 = C.y - B.y;
  const dot = dx1 * dx2 + dy1 * dy2;
  const mag = Math.sqrt(dx1 * dx1 + dy1 * dy1) * Math.sqrt(dx2 * dx2 + dy2 * dy2);
  if (mag < 1e-9) return 0;
  return Math.round(Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI);
}

function bodyTiltAngle(lm: any[]): number {
  const ls = lm[MP.LS], rs = lm[MP.RS], lh = lm[MP.LH], rh = lm[MP.RH];
  if (!ls || !rs || !lh || !rh) return 0;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2;
  const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
  return Math.round(Math.abs(Math.atan2(sx - hx, -(sy - hy)) * 180 / Math.PI));
}

interface AngleSeries {
  times: number[];
  leftElbow: number[];
  rightElbow: number[];
  leftKnee: number[];
  rightKnee: number[];
  bodyTilt: number[];
}

function computeAngles(frames: PoseResult[]): AngleSeries | null {
  // YOLO produces 33-landmark arrays (some with visibility=0) so only check length >= 17
  const valid = frames.filter(f => f.landmarks && f.landmarks.length >= 17);
  if (valid.length < 2) return null;
  const t0 = valid[0].timestamp;
  const s: AngleSeries = { times: [], leftElbow: [], rightElbow: [], leftKnee: [], rightKnee: [], bodyTilt: [] };
  for (const f of valid) {
    const lm = f.landmarks;
    // timestamps are in seconds (video.currentTime) — no /1000 conversion needed
    s.times.push(parseFloat((f.timestamp - t0).toFixed(3)));
    s.leftElbow.push(angle3(pt(lm, MP.LS), pt(lm, MP.LE), pt(lm, MP.LW)));
    s.rightElbow.push(angle3(pt(lm, MP.RS), pt(lm, MP.RE), pt(lm, MP.RW)));
    s.leftKnee.push(angle3(pt(lm, MP.LH), pt(lm, MP.LK), pt(lm, MP.LA)));
    s.rightKnee.push(angle3(pt(lm, MP.RH), pt(lm, MP.RK), pt(lm, MP.RA)));
    s.bodyTilt.push(bodyTiltAngle(lm));
  }
  return s;
}

/** Synthesize demo angle data (smooth oscillating curves) */
function demoAngles(): AngleSeries {
  const N = 20;
  const times = Array.from({ length: N }, (_, i) => parseFloat((i * 0.08).toFixed(2)));
  const wave = (off: number, amp: number, base: number) =>
    times.map((_, i) => Math.round(base + amp * Math.sin(i * 0.45 + off)));
  return {
    times,
    leftElbow: wave(0, 62, 98),
    rightElbow: wave(0.8, 57, 93),
    leftKnee: wave(1.5, 14, 153),
    rightKnee: wave(2.1, 12, 157),
    bodyTilt: wave(0.3, 8, 11),
  };
}

/** Synthesize idealized "pro" reference angles for visual comparison */
function demoProAngles(): AngleSeries {
  const N = 20;
  const times = Array.from({ length: N }, (_, i) => parseFloat((i * 0.08).toFixed(2)));
  // Pro: efficient elbow arc, stable knee bend, minimal body tilt
  return {
    times,
    leftElbow: times.map((_, i) => Math.round(130 + 20 * Math.sin(i * 0.45 + 0.3))),
    rightElbow: times.map((_, i) => Math.round(122 + 26 * Math.sin(i * 0.45 + 1.0))),
    leftKnee: times.map((_, i) => Math.round(148 + 7 * Math.sin(i * 0.45 + 1.7))),
    rightKnee: times.map((_, i) => Math.round(152 + 6 * Math.sin(i * 0.45 + 2.3))),
    bodyTilt: times.map((_, i) => Math.round(5 + 3 * Math.sin(i * 0.45 + 0.5))),
  };
}

function computeSwingSpeed(frames: PoseResult[]): number | null {
  if (frames.length < 2) return null;
  let maxSpeed = 0;
  for (let i = 1; i < frames.length; i++) {
    // timestamps are in seconds (video.currentTime)
    const dt = frames[i].timestamp - frames[i - 1].timestamp;
    // Require at least 1 frame's worth of time (1/60s) to avoid near-zero dt
    // inflating the speed calculation with timestamp jitter between runs
    if (dt < 1 / 60 || dt > 1) continue;
    const lm0 = frames[i - 1].landmarks, lm1 = frames[i].landmarks;
    if (!lm0?.length || !lm1?.length) continue;
    for (const idx of [MP.LW, MP.RW]) {
      const p0 = lm0[idx], p1 = lm1[idx];
      if (!p0 || !p1) continue;
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      // 1 normalized unit ≈ 2.5 m (approximate for a full-body shot on camera)
      const speedKmh = (dist * 2.5 / dt) * 3.6;
      if (speedKmh > maxSpeed) maxSpeed = speedKmh;
    }
  }
  // Clamp to realistic tennis forehand range
  return maxSpeed > 10 ? Math.round(Math.min(130, Math.max(45, maxSpeed))) : null;
}

// ─── Rank system ─────────────────────────────────────────────────────────────
function getRank(score: number, motionType: string) {
  const stroke = motionType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  if (score >= 90) return { title: `Elite ${stroke} Master`, emoji: '🏆', gradient: 'from-yellow-500 to-amber-600', text: 'text-amber-300' };
  if (score >= 80) return { title: `Rising ${stroke} Star`, emoji: '🥇', gradient: 'from-orange-500 to-rose-600', text: 'text-orange-300' };
  if (score >= 70) return { title: `${stroke} Contender`, emoji: '🥈', gradient: 'from-sky-500 to-blue-700', text: 'text-sky-300' };
  if (score >= 60) return { title: `Developing ${stroke} Player`, emoji: '🥉', gradient: 'from-teal-500 to-emerald-700', text: 'text-teal-300' };
  return { title: `${stroke} in Training`, emoji: '💪', gradient: 'from-slate-500 to-slate-700', text: 'text-slate-300' };
}

function getPercentile(score: number) {
  return Math.min(99, Math.round(score * 0.87 + 3));
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
const SCORE_COLOR = (s: number) => s >= 85 ? '#34d399' : s >= 70 ? '#fcd34d' : '#fca5a5';

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Hexagonal radar chart with full word labels */
function HexRadar({ tips }: { tips: RichTip[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const n = tips.length;
  const size = 320;
  const cx = size / 2, cy = size / 2;
  const r = size * 0.32;
  const angles = tips.map((_, i) => (i * 2 * Math.PI / n) - Math.PI / 2);
  // Grid rings at clean 25/50/75/100 intervals; user vertices map score directly to radius.
  // Floor of 0.04 keeps a degenerate vertex (score=0) visible rather than collapsing to center.
  const gridLevels = [0.25, 0.5, 0.75];
  const toFrac = (score: number) => Math.max(0.04, score / 100);
  // Pro baseline: all metrics at 100%
  const proPoints = angles.map(a => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`).join(' ');
  const dataPoints = tips.map((tip, i) => {
    const frac = toFrac(tip.score);
    return `${cx + r * frac * Math.cos(angles[i])},${cy + r * frac * Math.sin(angles[i])}`;
  }).join(' ');

  const labelAnchor = (angle: number): 'start' | 'middle' | 'end' => {
    const cos = Math.cos(angle);
    if (cos > 0.3) return 'start';
    if (cos < -0.3) return 'end';
    return 'middle';
  };

  return (
    <svg viewBox={`0 0 ${size} ${size + 28}`} className="w-full max-w-[360px] h-auto" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.92" />
          <stop offset="65%" stopColor="#818cf8" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.2" />
        </radialGradient>
        <radialGradient id="proFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.12" />
        </radialGradient>
      </defs>
      {/* Inner grid rings */}
      {gridLevels.map(level => (
        <g key={level}>
          <polygon
            points={angles.map(a => `${cx + r * level * Math.cos(a)},${cy + r * level * Math.sin(a)}`).join(' ')}
            fill="none"
            stroke="#6366f138"
            strokeWidth="0.8"
          />
          {/* Ring label on the top axis */}
          <text x={cx} y={cy - r * level - 3} textAnchor="middle" fontSize="8" fill="#6366f170">
            {level * 100}
          </text>
        </g>
      ))}
      {/* Pro (100%) reference area — teal dashed outer ring */}
      <polygon points={proPoints} fill="url(#proFill)" stroke="#22d3ee" strokeWidth="1.8"
        strokeDasharray="5 3" strokeLinejoin="round" opacity="0.9" />
      {/* Axis lines */}
      {angles.map((a, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)}
          stroke="#6366f122" strokeWidth="0.8" />
      ))}
      {/* User filled polygon */}
      <polygon points={dataPoints} fill="url(#radarFill)" stroke="#818cf8" strokeWidth="2.5"
        strokeLinejoin="round" />
      {/* Score dots + always-visible score labels */}
      {tips.map((tip, i) => {
        const frac = toFrac(tip.score);
        const dx = cx + r * frac * Math.cos(angles[i]);
        const dy = cy + r * frac * Math.sin(angles[i]);
        // Label offset: radially inward so it sits inside the polygon
        const lbx = dx - 15 * Math.cos(angles[i]);
        const lby = dy - 15 * Math.sin(angles[i]) + 4;
        const isHov = hovered === i;
        return (
          <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}>
            <circle cx={dx} cy={dy} r={14} fill="transparent" />
            {isHov && <circle cx={dx} cy={dy} r={9} fill={SCORE_COLOR(tip.score)} opacity="0.2" />}
            <circle cx={dx} cy={dy} r={isHov ? 6 : 5} fill={SCORE_COLOR(tip.score)}
              stroke="#0f172a" strokeWidth="1.5" />
            {/* Always-visible score — hide if zero (data not available) */}
            {tip.score > 0 && (
              <text x={lbx} y={lby} textAnchor="middle" fontSize="9" fontWeight="900"
                fill={SCORE_COLOR(tip.score)} opacity="0.9">
                {tip.score}
              </text>
            )}
          </g>
        );
      })}
      {/* Full-word axis labels */}
      {tips.map((tip, i) => {
        const lx = cx + r * 1.4 * Math.cos(angles[i]);
        const ly = cy + r * 1.4 * Math.sin(angles[i]);
        const anchor = labelAnchor(angles[i]);
        const isHov = hovered === i;
        const words = tip.label.split(' ');
        return (
          <g key={`lbl-${i}`} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}>
            <text x={lx} y={ly} textAnchor={anchor}
              fontSize={isHov ? 13 : 12} fontWeight="700"
              fill={isHov ? SCORE_COLOR(tip.score) : '#cbd5e1'}>
              {words.map((word, index) => (
                <tspan key={`${tip.label}-${index}`} x={lx} dy={index === 0 ? 0 : 13}>
                  {word}
                </tspan>
              ))}
            </text>
            {isHov && (
              <text x={lx} y={ly + (words.length * 13) + 4} textAnchor={anchor} fontSize="9" fill="#94a3b8">
                {tip.rawValue !== undefined ? `${tip.rawValue}${tip.rawUnit}` : `${tip.score}/100`}
              </text>
            )}
          </g>
        );
      })}
      {/* Pro vs You legend */}
      <g>
        <rect x={cx - 56} y={size + 7} width={112} height={18} rx="3" fill="#0f172a" opacity="0.55" />
        <line x1={cx - 48} y1={size + 16} x2={cx - 34} y2={size + 16} stroke="#22d3ee" strokeWidth="2.5" strokeDasharray="4 2" strokeLinecap="round" />
        <text x={cx - 30} y={size + 20} fontSize="10" fontWeight="600" fill="#67e8f9">Pro</text>
        <line x1={cx + 4} y1={size + 16} x2={cx + 18} y2={size + 16} stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" />
        <text x={cx + 22} y={size + 20} fontSize="10" fontWeight="600" fill="#a5b4fc">You</text>
      </g>
    </svg>
  );
}

/** Build a coaching summary paragraph that references real measured values */
function buildFeedbackParagraph(tips: RichTip[]): string {
  if (!tips.length) return '';
  const sorted = [...tips].sort((a, b) => a.score - b.score);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const avg = Math.round(tips.reduce((s, t) => s + t.score, 0) / tips.length);

  const opening =
    avg >= 78 ? 'Your technique shows real progress' :
      avg >= 62 ? 'Your form has a solid base' :
        'There\'s meaningful room to improve';

  // Strength clause with actual measurement
  const strongTips = tips.filter(t => t.score >= 75);
  const strPart = strongTips.length > 0
    ? ` — ${strongTips.slice(0, 2).map(t =>
      t.rawValue !== undefined ? `${t.label} (${t.rawValue}${t.rawUnit})` : t.label
    ).join(' and ')} ${strongTips.length === 1 ? 'is' : 'are'} a clear strength`
    : ' — consistency across all areas is building well';

  // Focus clause: pull the first observation sentence from the worst tip
  let focusPart: string;
  if (worst && worst.score < 65) {
    const cue = worst.short ?? worst.detail.split(/[.!?]/)[0].trim();
    const lower = cue.replace(/ \([^)]*\)\s*$/, '').charAt(0).toLowerCase() + cue.replace(/ \([^)]*\)\s*$/, '').slice(1);
    focusPart = `. Key focus: ${lower}.`;
  } else {
    focusPart = '. Keep refining every area to stay ahead.';
  }

  return `${opening}${strPart}${focusPart}`;
}

/** Status badge helper */
function getStatus(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: 'Great', color: '#34d399', bg: 'rgba(52,211,153,0.12)' };
  if (score >= 60) return { label: 'Good', color: '#fcd34d', bg: 'rgba(252,211,77,0.12)' };
  return { label: 'Improve', color: '#fb7185', bg: 'rgba(251,113,133,0.12)' };
}

/** Circular score ring */
function CircleScore({ score, gradient }: { score: number; gradient: string }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = SCORE_COLOR(score);
  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 106, height: 106 }}>
      <svg className="absolute inset-0" width="106" height="106" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="53" cy="53" r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
        <circle cx="53" cy="53" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="text-center z-10">
        <p className="text-4xl font-black leading-none tabular-nums" style={{ color }}>{score}</p>
        <p className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">/100</p>
      </div>
    </div>
  );
}

/** Half-circle speedometer gauge */
function SpeedGauge({ value, maxValue, label, unit }: { value: number; maxValue: number; label: string; unit: string }) {
  const pct = Math.min(1, Math.max(0, value / maxValue));
  const W = 340, H = 220;
  const cx = W / 2, cy = H - 26;
  const r = 130;

  // Arc from left (180°) sweeping clockwise to angle based on pct
  // Angle in SVG coords: 0° = right, increases clockwise
  // We go from 180° (left) to 0° (right) as pct goes 0→1
  const startAngle = Math.PI; // radians from positive X axis
  const sweepAngle = Math.PI * pct; // 0 → π
  const endAngle = startAngle - sweepAngle; // go counter-clockwise in math = right sweep in SVG

  const ex = cx + r * Math.cos(endAngle);
  const ey = cy - r * Math.sin(endAngle);

  // Background arc (full half circle)
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  // Foreground arc — always short arc (large-arc=0) so it follows the gauge direction correctly
  const fgPath = pct <= 0 ? '' :
    pct >= 1 ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r - 0.01} ${cy}` :
      `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[380px] h-auto" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* Background track */}
      <path d={bgPath} fill="none" stroke="#1e293b" strokeWidth="18" strokeLinecap="round" />
      {/* Filled arc */}
      {pct > 0 && <path d={fgPath} fill="none" stroke="url(#gaugeGrad)" strokeWidth="18" strokeLinecap="round" />}
      {/* Center value */}
      <text x={cx} y={cy - 36} textAnchor="middle" fontSize="62" fontWeight="900" fill="white" fontFamily="system-ui, sans-serif">
        {value}
      </text>
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize="18" fill="#64748b" fontFamily="system-ui, sans-serif">
        km/h
      </text>
    </svg>
  );
}

// Series config for the angle chart
const SERIES_CONFIG = [
  { key: 'leftElbow' as const, label: 'L. Elbow', color: '#3b82f6' },
  { key: 'rightElbow' as const, label: 'R. Elbow', color: '#f59e0b' },
  { key: 'leftKnee' as const, label: 'L. Knee', color: '#22c55e' },
  { key: 'rightKnee' as const, label: 'R. Knee', color: '#ef4444' },
  { key: 'bodyTilt' as const, label: 'Body Tilt', color: '#a855f7' },
];

/** Interactive SVG angle line chart with optional reference overlay */
function AngleChart({
  series,
  refSeries,
  enabled,
  autoScale,
  isDemo,
}: {
  series: AngleSeries;
  refSeries?: AngleSeries | null;
  enabled: Record<string, boolean>;
  autoScale: boolean;
  isDemo: boolean;
}) {
  const ML = 12, MB = 36, MT = 16, MR = 48;
  const VW = 640, VH = 220;
  const PW = VW - ML - MR;
  const PH = VH - MT - MB;

  const N = series.times.length;
  if (N < 2) return <div className="text-xs text-slate-500 text-center py-6">No angle data</div>;

  const maxTime = series.times[N - 1];

  // Y range — include ref series when auto-scaling
  let minAngle = 0, maxAngle = 200;
  if (autoScale) {
    const all: number[] = [];
    SERIES_CONFIG.forEach(s => {
      if (enabled[s.key]) {
        all.push(...series[s.key]);
        if (refSeries) all.push(...refSeries[s.key]);
      }
    });
    if (all.length) {
      minAngle = Math.max(0, Math.floor(Math.min(...all) / 10) * 10 - 10);
      maxAngle = Math.min(200, Math.ceil(Math.max(...all) / 10) * 10 + 10);
    }
  }
  const rangeAngle = maxAngle - minAngle || 1;

  const px = (t: number) => ML + (t / maxTime) * PW;
  const py = (a: number) => MT + PH - ((a - minAngle) / rangeAngle) * PH;

  // Grid lines
  const gridAngles: number[] = [];
  const step = autoScale ? Math.round((maxAngle - minAngle) / 4 / 10) * 10 || 10 : 50;
  for (let v = 0; v <= maxAngle; v += step) {
    if (v >= minAngle) gridAngles.push(v);
  }

  // Time ticks — start from 0.5 so t=0 tick doesn't double-draw on the y-axis line
  const timeTicks: number[] = [];
  for (let t = 0.5; t <= maxTime + 0.01; t += 0.5) {
    timeTicks.push(parseFloat(t.toFixed(1)));
  }

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Grid lines + RIGHT y-axis labels */}
      {gridAngles.map(v => (
        <g key={v}>
          <line x1={ML} y1={py(v)} x2={ML + PW} y2={py(v)} stroke="#1e293b" strokeWidth="1" strokeDasharray="5 5" />
          <text x={ML + PW + 8} y={py(v) + 4} textAnchor="start" fontSize="12" fill="#64748b">{v}</text>
        </g>
      ))}
      {/* Time ticks */}
      {timeTicks.map(t => (
        <g key={t}>
          <line x1={px(t)} y1={MT} x2={px(t)} y2={MT + PH} stroke="#0f172a" strokeWidth="0.6" />
          <text x={px(t)} y={MT + PH + 18} textAnchor="middle" fontSize="12" fill="#64748b">{t}</text>
        </g>
      ))}
      {/* "Time (s)" x-axis label */}
      <text x={ML + PW / 2} y={VH - 4} textAnchor="middle" fontSize="12" fill="#475569">Time (s)</text>
      {/* Static "0" label at origin */}
      <text x={ML} y={MT + PH + 18} textAnchor="middle" fontSize="12" fill="#64748b">0</text>
      {/* Axes */}
      <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke="#1e293b" strokeWidth="0.8" />
      <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke="#334155" strokeWidth="1" />
      <line x1={ML + PW} y1={MT} x2={ML + PW} y2={MT + PH} stroke="#334155" strokeWidth="1" />
      {/* Reference overlay (dashed, faded) */}
      {refSeries && refSeries.times.length >= 2 && (() => {
        const refMax = refSeries.times[refSeries.times.length - 1] || 1;
        // Normalise ref time to same 0–maxTime scale so both clips align
        const rpx = (t: number) => ML + (t / refMax) * PW;
        return SERIES_CONFIG.map(s => {
          if (!enabled[s.key]) return null;
          const vals = refSeries[s.key];
          const points = refSeries.times.slice(1).map((t, i) => `${rpx(t)},${py(vals[i + 1])}`).join(' ');
          return (
            <polyline
              key={`ref-${s.key}`}
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.55}
            />
          );
        });
      })()}
      {/* Series polylines (user — solid) */}
      {SERIES_CONFIG.map(s => {
        if (!enabled[s.key]) return null;
        const vals = series[s.key];
        const points = series.times.slice(1).map((t, i) => `${px(t)},${py(vals[i + 1])}`).join(' ');
        return (
          <polyline
            key={s.key}
            points={points}
            fill="none"
            stroke={s.color}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={isDemo ? 0.6 : 0.9}
          />
        );
      })}
      {/* Data dots (skip first frame to avoid y-axis clutter) */}
      {SERIES_CONFIG.map(s => {
        if (!enabled[s.key]) return null;
        const vals = series[s.key];
        return series.times
          .filter((_, i) => i > 0 && i % 4 === 0)
          .map((t, i) => {
            const realI = (i + 1) * 4;
            if (realI >= vals.length) return null;
            return (
              <circle
                key={`${s.key}-${realI}`}
                cx={px(t)}
                cy={py(vals[realI])}
                r={3.5}
                fill={s.color}
                opacity={0.85}
              />
            );
          });
      })}
      {/* You/Pro top-right legend */}
      {refSeries && refSeries.times.length >= 2 && (
        <g>
          <line x1={ML + PW - 90} y1={MT + 9} x2={ML + PW - 66} y2={MT + 9} stroke="#c7d2fe" strokeWidth="2.5" strokeLinecap="round" />
          <text x={ML + PW - 62} y={MT + 13} fontSize="10" fontWeight="600" fill="#c7d2fe">You</text>
          <line x1={ML + PW - 26} y1={MT + 9} x2={ML + PW - 2} y2={MT + 9} stroke="#c7d2fe" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" opacity="0.55" />
          <text x={ML + PW + 2} y={MT + 13} fontSize="10" fontWeight="600" fill="#7dd3fc">Pro</text>
        </g>
      )}
      {/* Demo watermark */}
      {isDemo && (
        <text x={ML + PW / 2} y={VH / 2 + 4} textAnchor="middle" fontSize="9" fill="#64748b" opacity="0.4" letterSpacing="1">
          DEMO — record yourself to see real angles
        </text>
      )}
    </svg>
  );
}

/** Toggle button for a single series */
function SeriesToggle({ config, enabled, onChange }: {
  config: typeof SERIES_CONFIG[number];
  enabled: boolean;
  onChange: (key: string, val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center gap-2.5">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: config.color }} />
        <span className="text-[13px] text-slate-200 font-medium">{config.label}</span>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${enabled ? 'bg-blue-500' : 'bg-slate-700'}`}
        onClick={() => onChange(config.key, !enabled)}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{ transform: enabled ? 'translateX(20px)' : 'none' }}
        />
      </button>
    </div>
  );
}

// ─── Main ShotDashboard ───────────────────────────────────────────────────────
export interface ShotDashboardProps {
  overallScore: number;
  motionType: string;
  richTips?: RichTip[] | null;
  freeTips?: FreeTip[] | null; // free-mode alternative
  userPoseFrames?: PoseResult[] | null;
  refPoseFrames?: PoseResult[] | null;
  onDownloadPDF?: () => void;
  downloadingPDF?: boolean;
  showPDFButton?: boolean;
}

export function ShotDashboard({
  overallScore,
  motionType,
  richTips,
  freeTips,
  userPoseFrames,
  refPoseFrames,
  onDownloadPDF,
  downloadingPDF,
  showPDFButton = true,
}: ShotDashboardProps) {
  // Normalise to RichTip[] regardless of which prop is provided
  const tips: RichTip[] = useMemo(() => {
    if (richTips && richTips.length > 0) return richTips;
    if (freeTips && freeTips.length > 0) return freeTipsToRich(freeTips);
    return [];
  }, [richTips, freeTips]);

  const [showAngleDetails, setShowAngleDetails] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SERIES_CONFIG.map(s => [s.key, true]))
  );

  const [expandedTip, setExpandedTip] = useState<number | null>(null);

  const toggleSeries = useCallback((key: string, val: boolean) => {
    setEnabled(prev => ({ ...prev, [key]: val }));
  }, []);

  // Compute angle series
  const { angleSeries, isDemo } = useMemo(() => {
    if (userPoseFrames && userPoseFrames.length >= 3) {
      const s = computeAngles(userPoseFrames);
      if (s && s.times.length >= 2 && s.times[s.times.length - 1] > 0) return { angleSeries: s, isDemo: false };
    }
    return { angleSeries: demoAngles(), isDemo: true };
  }, [userPoseFrames]);

  // Compute reference angle series — always show pro curves for comparison
  const refAngleSeries = useMemo(() => {
    if (refPoseFrames && refPoseFrames.length >= 3) {
      const s = computeAngles(refPoseFrames);
      if (s && s.times.length >= 2 && s.times[s.times.length - 1] > 0) return s;
    }
    // Fallback: demo pro reference so the chart always has a comparison line
    return demoProAngles();
  }, [refPoseFrames]);

  // Swing speed (from pose frames or estimated from score)
  const swingSpeed = useMemo(() => {
    if (userPoseFrames && userPoseFrames.length >= 2) {
      const s = computeSwingSpeed(userPoseFrames);
      if (s) return s;
    }
    // Fallback: estimate from score
    return Math.round(50 + overallScore * 0.65);
  }, [userPoseFrames, overallScore]);

  // Power score for gauge
  const powerScore = useMemo(() => {
    if (tips.length) {
      const p = tips.find(t => t.label.toLowerCase().includes('power') || t.label.toLowerCase().includes('speed'));
      return p ? p.score : overallScore;
    }
    return overallScore;
  }, [tips, overallScore]);

  const rank = getRank(overallScore, motionType);
  const percentile = getPercentile(overallScore);

  return (
    <div className="flex flex-col gap-4">

      {/* ══ 1. SCORE + RADAR ══════════════════════════════════════════ */}
      <div className="card overflow-hidden relative">
        <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${rank.gradient}`} />

        {/* Score row */}
        <div className="flex items-start justify-between pt-2 mb-3">
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-1">Composite score</p>
            <p className="text-6xl font-black leading-none tabular-nums" style={{ color: SCORE_COLOR(overallScore) }}>
              {overallScore}
            </p>
          </div>
          {/* Rank badge — prominent top-right */}
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-br ${rank.gradient} shadow-lg max-w-[140px]`}>
            <span className="text-xl leading-none flex-shrink-0">{rank.emoji}</span>
            <span className="text-[13px] font-bold text-white leading-tight">{rank.title}</span>
          </div>
        </div>

        {/* Motivational text */}
        <p className="text-[13px] font-bold leading-relaxed mb-5" style={{ color: SCORE_COLOR(overallScore) }}>
          You're outperforming <span className="text-white">{percentile}%</span> of players at this stroke — keep building those fundamentals!
        </p>

        {/* Radar centered — only show when angle details are hidden to avoid page bloat */}
        {tips.length > 0 && (
          <div className="flex justify-center py-2">
            <HexRadar tips={tips} />
          </div>
        )}
      </div>

      {/* ══ 2. MAX SWING SPEED ════════════════════════════════════════ */}
      <div className="card">
        <p className="text-[17px] font-black text-slate-100 mb-1">Max swing speed</p>
        <div className="flex justify-center py-2">
          <SpeedGauge value={swingSpeed} maxValue={130} label="Swing Intensity" unit="km/h est." />
        </div>
      </div>

      {/* ══ 3. COACHING INSIGHTS ══════════════════════════════════════ */}
      {tips.length > 0 && (
        <div className="card">
          <p className="text-[17px] font-black text-slate-100 mb-2">Coaching insights</p>
          <p className="text-[13px] text-slate-400 leading-relaxed mb-4">
            {buildFeedbackParagraph(tips)}
          </p>
          <div className="flex flex-col">
            {tips.map((tip, i) => {
              const isExpanded = expandedTip === i;
              const st = getStatus(tip.score);
              return (
                <div key={i}>
                  <button
                    className="w-full flex items-center gap-3 py-3 border-b border-slate-800/50 last:border-0 text-left hover:bg-slate-800/30 rounded-lg px-1 transition-colors"
                    onClick={() => setExpandedTip(isExpanded ? null : i)}
                  >
                    <span className="text-lg leading-none flex-shrink-0 w-6">{tip.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="block text-[13px] text-slate-200 font-semibold leading-tight">{tip.label}</span>
                      {!isExpanded && (
                        <span className="block text-[11px] text-slate-400 leading-snug mt-0.5 truncate">
                          {tip.short ?? tip.detail.split(/[.!?]/)[0].trim()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-16 h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${tip.score}%`, background: st.color }} />
                      </div>
                      <span className="text-[13px] font-black tabular-nums w-16 text-right"
                        style={{ color: st.color }}>
                        {tip.rawValue !== undefined ? `${tip.rawValue}${tip.rawUnit}` : `${tip.score}`}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-600 w-3 flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-2 py-3 mb-1 text-[12px] text-slate-300 leading-relaxed border-l-2"
                      style={{ borderLeftColor: st.color, background: st.bg }}>
                      {tip.detail}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {showPDFButton && onDownloadPDF && (
            <div className="mt-4">
              <button
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-300 transition-colors disabled:opacity-50"
                onClick={onDownloadPDF} disabled={downloadingPDF}
              >
                {downloadingPDF ? (
                  <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />Generating PDF…</>
                ) : '📥 Download Shot Analysis PDF'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ 4. ANGLE ANALYSIS ═════════════════════════════════════════ */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[17px] font-black text-slate-100">
            Angle analysis
            {isDemo && <span className="ml-2 text-[10px] font-medium text-amber-500/70 align-middle">Preview</span>}
          </p>
        </div>

        {/* Chart preview — hidden when details panel is open to avoid duplication */}
        {!showAngleDetails && (
          <>
            <AngleChart series={angleSeries} refSeries={refAngleSeries} enabled={enabled} autoScale={autoScale} isDemo={isDemo} />
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 mb-4">
              {SERIES_CONFIG.filter(s => enabled[s.key]).map(s => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-[12px] text-slate-400">{s.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* View Details button */}
        <div className="flex justify-end">
          <button
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[13px] font-semibold text-slate-300 transition-colors border border-slate-700/60"
            onClick={() => setShowAngleDetails(v => !v)}
          >
            {showAngleDetails ? 'Hide Details' : 'View Details'}
            <span className="text-xs">{showAngleDetails ? ' ▲' : ' ›'}</span>
          </button>
        </div>
      </div>

      {/* ══ 5. ANGLE DETAILS (expanded) ═══════════════════════════════ */}
      {showAngleDetails && (
        <div className="card">
          <p className="text-[17px] font-black text-slate-100 mb-4">Angle analysis details</p>

          {/* Select angle item */}
          <p className="text-[13px] font-bold text-slate-300 mb-1">Select angle item</p>
          <div className="mb-2">
            {SERIES_CONFIG.map(s => (
              <SeriesToggle key={s.key} config={s} enabled={enabled[s.key]} onChange={toggleSeries} />
            ))}
            {/* Auto-scale as a toggle row */}
            <div className="flex items-center justify-between py-2.5 border-b border-slate-800/50">
              <div className="flex items-center gap-2.5">
                <span className="text-slate-400 text-base">⊕</span>
                <span className="text-[13px] text-slate-200 font-medium">Auto-scale Y axis</span>
              </div>
              <button
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${autoScale ? 'bg-blue-500' : 'bg-slate-700'}`}
                onClick={() => setAutoScale(v => !v)}
              >
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: autoScale ? 'translateX(20px)' : 'none' }} />
              </button>
            </div>
          </div>

          {/* Angle curve */}
          <p className="text-[13px] font-bold text-slate-300 mt-4 mb-2">Angle curve</p>
          <AngleChart series={angleSeries} refSeries={refAngleSeries} enabled={enabled} autoScale={autoScale} isDemo={isDemo} />

          {/* Legend */}
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 mb-4">
            {SERIES_CONFIG.filter(s => enabled[s.key]).map(s => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-[12px] text-slate-400">{s.label}</span>
              </div>
            ))}
          </div>

          {/* How to read */}
          <div className="mt-1 p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/40">
            <p className="text-[13px] font-bold text-slate-200 mb-3">How to read these angles</p>
            <div className="flex flex-col gap-2.5">
              {SERIES_CONFIG.map(s => (
                <div key={s.key} className="flex items-start gap-2.5">
                  <span className="w-1 h-4 rounded-full flex-shrink-0 mt-0.5" style={{ background: s.color }} />
                  <span className="text-[12px] text-slate-400 leading-relaxed">
                    <span className="font-bold" style={{ color: s.color }}>{s.label}: </span>
                    {s.key === 'leftElbow' && 'L shoulder→elbow→wrist. Lower = more bent arm.'}
                    {s.key === 'rightElbow' && 'R shoulder→elbow→wrist. Lower = more bent arm.'}
                    {s.key === 'leftKnee' && 'L hip→knee→ankle. ~170° = straight, ~120° = athletic bend.'}
                    {s.key === 'rightKnee' && 'R hip→knee→ankle. ~170° = straight, ~120° = athletic bend.'}
                    {s.key === 'bodyTilt' && 'Torso lean from vertical. 0° = fully upright.'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
