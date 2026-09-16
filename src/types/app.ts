/**
 * Shared application-level types used across App.tsx and custom hooks.
 * Centralising here prevents circular imports and keeps the root component thin.
 */

export type Step = 'welcome' | 'admin' | 'reference' | 'user' | 'compare' | 'feedback';
export type CompareMode = 'split' | 'overlay';
export type SportType = 'tennis';
export type RouteFeature =
  | Step
  | 'livecoaching'
  | 'serve-phase-demo'
  | 'groundstroke-phase-demo'
  | 'settings'
  | 'root'
  | null;

export type SkillType =
  | 'serve'
  | 'forehand'
  | 'backhand'
  | 'volley'
  | 'forehand_volley'
  | 'backhand_volley'
  | 'overhead';

export type TrimRange = { start: number; end: number }; // normalised 0..1
