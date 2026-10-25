/**
 * CalibrationService.ts
 * Orchestrator: storage, CRUD, profiles, import/export, cloud sync.
 * Delegates feature extraction, classification, and phase detection to sub-modules.
 *
 * SOLID:
 *  - SRP: Each sub-module owns one concern (types / features / classify / detect).
 *  - OCP: New stroke types extend PHASE_DEFINITIONS; no class changes needed.
 *  - DIP: Public API consumers depend only on this file; sub-modules are internal.
 */

import { PoseResult } from './MotionAnalysisRouter';
import { CalibrationCloudSync } from './CalibrationCloudSync';

// ── Re-export everything consumers already import from this path ────────────
export {
    PHASE_DEFINITIONS,
    type StrokeType,
    type PhaseType,
    type PoseFeatures,
    type CalibrationExample,
    type CalibrationData,
    type CalibrationSyncBundle,
    type CalibrationProfile,
} from './calibration/types';
import {
    PHASE_DEFINITIONS,
    StrokeType, PhaseType,
    CalibrationExample, CalibrationData, CalibrationSyncBundle, CalibrationProfile,
} from './calibration/types';

import { extractFeatures } from './calibration/featureExtractor';
import {
    classifyPose as classifyPoseImpl,
    distanceToPhase as distanceToPhaseImpl,
    getReferenceCalibrationDiagnostics as diagImpl,
} from './calibration/classifier';
import { findPhasesWithCalibration as findPhasesImpl } from './calibration/phaseDetector';

// ── Storage constants ────────────────────────────────────────────────────────
const STORAGE_KEY = 'tennis_phase_calibration';
const PROFILES_KEY = 'tennis_calibration_profiles';
const ACTIVE_PROFILE_KEY = 'tennis_active_profile';
const CURRENT_VERSION = 1;
const CLOUD_AUTO_KEY = '__motiontutor_calibration_auto__';
const LEGACY_PROFILE_NAMES_TO_REMOVE = new Set(['Backhand - Jan 13, 11:56 PM']);

// ── CalibrationService ───────────────────────────────────────────────────────
export class CalibrationService {
    private static data: CalibrationData | null = null;

    // ── Persistence ──────────────────────────────────────────────────────────
    static load(): CalibrationData {
        if (this.data) return this.data;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as CalibrationData;
                if (parsed.version === CURRENT_VERSION) {
                    this.data = parsed;
                    return this.data;
                }
            }
        } catch { /* ignore */ }
        this.data = { version: CURRENT_VERSION, examples: [], lastUpdated: Date.now() };
        return this.data;
    }

    static save(): void {
        if (!this.data) return;
        this.data.lastUpdated = Date.now();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
        this.saveToCloud().catch(() => { /* silent */ });
    }

    private static stripFrameImages(data: CalibrationData): CalibrationData {
        return {
            ...data,
            examples: (data.examples || []).map(({ frameImage: _fi, ...rest }) => rest as CalibrationExample),
        };
    }

    // ── Feature extraction (delegated) ───────────────────────────────────────
    static extractFeatures(pose: PoseResult, prevPose?: PoseResult) {
        return extractFeatures(pose, prevPose);
    }

    // ── Example CRUD ─────────────────────────────────────────────────────────
    static addExample(
        strokeType: StrokeType, phase: PhaseType,
        pose: PoseResult, prevPose: PoseResult | undefined,
        timestamp: number, videoName: string,
        frameImage?: string, isUserVideo?: boolean, videoId?: string, frameIndex?: number
    ): CalibrationExample {
        const data = this.load();
        const example: CalibrationExample = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            strokeType, phase,
            features: extractFeatures(pose, prevPose),
            timestamp, videoName, createdAt: Date.now(),
            landmarks: pose.landmarks,
            worldLandmarks: pose.worldLandmarks,
            frameImage, isUserVideo, videoId, frameIndex,
        };
        data.examples.push(example);
        this.save();
        return example;
    }

    static removeExample(id: string): void {
        const data = this.load();
        data.examples = data.examples.filter(e => e.id !== id);
        this.save();
    }

    static getExamples(strokeType: StrokeType): CalibrationExample[] {
        return this.load().examples.filter(e => e.strokeType === strokeType);
    }

    static getCalibratedFrame(strokeType: StrokeType, phase: PhaseType): CalibrationExample | null {
        const exs = this.getExamples(strokeType).filter(e => e.phase === phase && e.landmarks && !e.isUserVideo);
        if (!exs.length) return null;
        return exs.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    static getUserVideoCalibration(
        strokeType: StrokeType, videoId: string
    ): Map<PhaseType, { frameIndex: number; timestamp: number; landmarks: any[]; worldLandmarks?: any[] }> | null {
        const exs = this.load().examples.filter(
            e => e.strokeType === strokeType && e.isUserVideo && e.videoId === videoId && e.frameIndex !== undefined
        );
        if (!exs.length) return null;
        const phases = new Map<PhaseType, { frameIndex: number; timestamp: number; landmarks: any[]; worldLandmarks?: any[] }>();
        for (const ex of exs) {
            if (ex.landmarks && ex.frameIndex !== undefined) {
                phases.set(ex.phase, { frameIndex: ex.frameIndex, timestamp: ex.timestamp, landmarks: ex.landmarks, worldLandmarks: ex.worldLandmarks });
            }
        }
        return phases;
    }

    static getAllCalibratedFrames(strokeType: StrokeType): Map<PhaseType, CalibrationExample> {
        const frames = new Map<PhaseType, CalibrationExample>();
        for (const phase of PHASE_DEFINITIONS[strokeType]) {
            const cal = this.getCalibratedFrame(strokeType, phase);
            if (cal) frames.set(phase, cal);
        }
        return frames;
    }

    static getExampleCounts(strokeType: StrokeType): Record<string, number> {
        const exs = this.getExamples(strokeType);
        const counts: Record<string, number> = {};
        for (const phase of PHASE_DEFINITIONS[strokeType]) counts[phase] = exs.filter(e => e.phase === phase).length;
        return counts;
    }

    static getReferenceExampleCounts(strokeType: StrokeType): Record<string, number> {
        const exs = this.getExamples(strokeType).filter(e => !e.isUserVideo);
        const counts: Record<string, number> = {};
        for (const phase of PHASE_DEFINITIONS[strokeType]) counts[phase] = exs.filter(e => e.phase === phase).length;
        return counts;
    }

    static hasEnoughExamples(strokeType: StrokeType): boolean {
        const counts = this.getExampleCounts(strokeType);
        return PHASE_DEFINITIONS[strokeType].every(p => (counts[p] || 0) >= 1);
    }

    static hasEnoughReferenceExamples(strokeType: StrokeType): boolean {
        const counts = this.getReferenceExampleCounts(strokeType);
        return PHASE_DEFINITIONS[strokeType].every(p => (counts[p] || 0) >= 1);
    }

    // ── Classification (delegated) ────────────────────────────────────────────
    static classifyPose(strokeType: StrokeType, pose: PoseResult, prevPose?: PoseResult, k = 3) {
        return classifyPoseImpl(this.getExamples(strokeType), pose, prevPose, k);
    }

    static distanceToPhase(strokeType: StrokeType, pose: PoseResult, targetPhase: PhaseType, prevPose?: PoseResult) {
        return distanceToPhaseImpl(this.getExamples(strokeType), pose, targetPhase, prevPose);
    }

    static getReferenceCalibrationDiagnostics(strokeType: StrokeType) {
        const reps: CalibrationExample[] = [];
        for (const phase of PHASE_DEFINITIONS[strokeType]) {
            const ex = this.getCalibratedFrame(strokeType, phase);
            if (!ex) return { reliable: false, minPhaseDistance: 0, duplicatePairs: [] as { a: PhaseType; b: PhaseType; distance: number }[] };
            reps.push(ex);
        }
        return diagImpl(reps);
    }

    static hasReliableReferenceCalibration(strokeType: StrokeType): boolean {
        if (!this.hasEnoughReferenceExamples(strokeType)) return false;
        return this.getReferenceCalibrationDiagnostics(strokeType).reliable;
    }

    // ── Phase detection (delegated) ───────────────────────────────────────────
    static findPhasesWithCalibration(strokeType: StrokeType, sequence: PoseResult[]) {
        return findPhasesImpl(strokeType, sequence, this.getExamples(strokeType), this.hasEnoughExamples(strokeType));
    }

    // ── Import / Export ───────────────────────────────────────────────────────
    static exportData(): string {
        return JSON.stringify(this.load(), null, 2);
    }

    static exportBundle(options?: { includeFrameImages?: boolean }): string {
        const keepImages = options?.includeFrameImages !== false;
        const raw = this.load();
        const calibration = keepImages ? raw : this.stripFrameImages(raw);
        const profiles = this.getProfiles();
        const profileData: Record<string, CalibrationData> = {};
        for (const p of profiles) {
            try {
                const stored = localStorage.getItem(`${STORAGE_KEY}_${p.id}`);
                if (!stored) continue;
                const parsed = JSON.parse(stored) as CalibrationData;
                profileData[p.id] = keepImages ? parsed : this.stripFrameImages(parsed);
            } catch { /* ignore */ }
        }
        const bundle: CalibrationSyncBundle = {
            version: CURRENT_VERSION, exportedAt: Date.now(),
            calibration, profiles, activeProfileName: this.getActiveProfileName(), profileData,
        };
        return JSON.stringify(bundle);
    }

    static importData(json: string): boolean {
        try {
            const imported = JSON.parse(json) as CalibrationData;
            if (imported.version === CURRENT_VERSION && Array.isArray(imported.examples)) {
                this.data = imported;
                this.save();
                return true;
            }
        } catch { /* ignore */ }
        return false;
    }

    static importBundle(
        json: string,
        options?: { mode?: 'merge' | 'replace' }
    ): { ok: boolean; importedExamples: number; importedProfiles: number; message?: string } {
        const mode = options?.mode || 'merge';
        try {
            const parsed = JSON.parse(json) as Partial<CalibrationSyncBundle>;
            if (!parsed || parsed.version !== CURRENT_VERSION) return { ok: false, importedExamples: 0, importedProfiles: 0, message: 'Unsupported bundle version' };
            if (!parsed.calibration || !Array.isArray(parsed.calibration.examples)) return { ok: false, importedExamples: 0, importedProfiles: 0, message: 'Invalid bundle' };

            const inCal = parsed.calibration as CalibrationData;
            const inProfiles = Array.isArray(parsed.profiles) ? parsed.profiles as CalibrationProfile[] : [];
            const inActive = typeof parsed.activeProfileName === 'string' ? parsed.activeProfileName : null;
            const inProfileData = (parsed.profileData && typeof parsed.profileData === 'object') ? parsed.profileData as Record<string, CalibrationData> : {};

            const setActive = (name: string | null) => {
                if (name) localStorage.setItem(ACTIVE_PROFILE_KEY, name);
                else localStorage.removeItem(ACTIVE_PROFILE_KEY);
            };
            const writeProfileData = (data: Record<string, CalibrationData>) => {
                for (const [id, cal] of Object.entries(data)) {
                    try { localStorage.setItem(`${STORAGE_KEY}_${id}`, JSON.stringify(cal)); } catch { /* ignore */ }
                }
            };

            if (mode === 'replace') {
                this.data = inCal; this.save();
                this.saveProfiles(inProfiles); setActive(inActive); writeProfileData(inProfileData);
                return { ok: true, importedExamples: inCal.examples.length, importedProfiles: inProfiles.length };
            }

            // merge mode
            const current = this.load();
            const byId = new Map(current.examples.map(e => [e.id, e]));
            let importedExamples = 0;
            for (const ex of inCal.examples) {
                if (!ex?.id) continue;
                if (!byId.has(ex.id)) importedExamples++;
                byId.set(ex.id, ex as CalibrationExample);
            }
            this.data = { version: CURRENT_VERSION, examples: Array.from(byId.values()), lastUpdated: Date.now() };
            this.save();
            const profilesById = new Map(this.getProfiles().map(p => [p.id, p]));
            for (const p of inProfiles) { if (p?.id) profilesById.set(p.id, p); }
            this.saveProfiles(Array.from(profilesById.values()));
            writeProfileData(inProfileData);
            if (inActive !== null) setActive(inActive);
            return { ok: true, importedExamples, importedProfiles: inProfiles.length };
        } catch {
            return { ok: false, importedExamples: 0, importedProfiles: 0, message: 'Failed to parse bundle' };
        }
    }

    static clearAll(): void {
        this.data = { version: CURRENT_VERSION, examples: [], lastUpdated: Date.now() };
        this.save();
        try {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('tennis_') || k.startsWith('motion_cache_'))) keys.push(k);
            }
            keys.forEach(k => localStorage.removeItem(k));
        } catch { /* ignore */ }
        CalibrationCloudSync.deleteAllSync().catch(() => { /* ignore */ });
    }

    // ── Profile management ────────────────────────────────────────────────────
    static getProfiles(): CalibrationProfile[] {
        try {
            const stored = localStorage.getItem(PROFILES_KEY);
            if (stored) return this.pruneLegacyProfiles(JSON.parse(stored) as CalibrationProfile[]);
        } catch { /* ignore */ }
        return [];
    }

    private static saveProfiles(profiles: CalibrationProfile[]): void {
        try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch { /* ignore */ }
    }

    private static pruneLegacyProfiles(profiles: CalibrationProfile[]): CalibrationProfile[] {
        const stale = profiles.filter(p => LEGACY_PROFILE_NAMES_TO_REMOVE.has(p.name));
        if (!stale.length) return profiles;
        const staleIds = new Set(stale.map(p => p.id));
        const activeName = localStorage.getItem(ACTIVE_PROFILE_KEY);
        stale.forEach(p => { try { localStorage.removeItem(`${STORAGE_KEY}_${p.id}`); } catch { /* ignore */ } });
        if (activeName && LEGACY_PROFILE_NAMES_TO_REMOVE.has(activeName)) localStorage.removeItem(ACTIVE_PROFILE_KEY);
        const cleaned = profiles.filter(p => !staleIds.has(p.id));
        this.saveProfiles(cleaned);
        return cleaned;
    }

    static getActiveProfileName(): string | null {
        try {
            const name = localStorage.getItem(ACTIVE_PROFILE_KEY);
            if (!name) return null;
            if (LEGACY_PROFILE_NAMES_TO_REMOVE.has(name)) { localStorage.removeItem(ACTIVE_PROFILE_KEY); return null; }
            if (!this.getProfiles().some(p => p.name === name)) { localStorage.removeItem(ACTIVE_PROFILE_KEY); return null; }
            return name;
        } catch { return null; }
    }

    static saveAsProfile(name: string, strokeType: StrokeType, description?: string): CalibrationProfile | null {
        const examples = this.load().examples.filter(e => e.strokeType === strokeType);
        if (!examples.length) return null;
        const profileId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const profileData: CalibrationData = { version: CURRENT_VERSION, examples, lastUpdated: Date.now() };
        try { localStorage.setItem(`${STORAGE_KEY}_${profileId}`, JSON.stringify(profileData)); } catch { return null; }
        const profile: CalibrationProfile = {
            id: profileId, name: name.trim(), description: description?.trim(),
            strokeType, exampleCount: examples.length, createdAt: Date.now(), updatedAt: Date.now(),
        };
        const profiles = this.getProfiles();
        profiles.push(profile);
        this.saveProfiles(profiles);
        localStorage.setItem(ACTIVE_PROFILE_KEY, name);
        return profile;
    }

    static loadProfile(profileId: string): boolean {
        const profile = this.getProfiles().find(p => p.id === profileId);
        if (!profile) return false;
        try {
            const stored = localStorage.getItem(`${STORAGE_KEY}_${profileId}`);
            if (!stored) return false;
            const profileData = JSON.parse(stored) as CalibrationData;
            const other = this.load().examples.filter(e => e.strokeType !== profile.strokeType);
            this.data = { version: CURRENT_VERSION, examples: [...other, ...profileData.examples], lastUpdated: Date.now() };
            this.save();
            localStorage.setItem(ACTIVE_PROFILE_KEY, profile.name);
            return true;
        } catch { return false; }
    }

    static deleteProfile(profileId: string): boolean {
        const profiles = this.getProfiles();
        const idx = profiles.findIndex(p => p.id === profileId);
        if (idx === -1) return false;
        const deleted = profiles[idx];
        try { localStorage.removeItem(`${STORAGE_KEY}_${profileId}`); } catch { /* ignore */ }
        profiles.splice(idx, 1);
        this.saveProfiles(profiles);
        try { if (localStorage.getItem(ACTIVE_PROFILE_KEY) === deleted.name) localStorage.removeItem(ACTIVE_PROFILE_KEY); } catch { /* ignore */ }
        return true;
    }

    static renameProfile(profileId: string, newName: string): boolean {
        const profiles = this.getProfiles();
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return false;
        profile.name = newName.trim(); profile.updatedAt = Date.now();
        this.saveProfiles(profiles);
        return true;
    }

    static quickSave(strokeType: StrokeType): { saved: boolean; profileName: string } {
        const activeName = this.getActiveProfileName();
        const existing = this.getProfiles().find(p => p.name === activeName && p.strokeType === strokeType);
        if (existing) {
            const examples = this.load().examples.filter(e => e.strokeType === strokeType);
            const profileData: CalibrationData = { version: CURRENT_VERSION, examples, lastUpdated: Date.now() };
            try {
                localStorage.setItem(`${STORAGE_KEY}_${existing.id}`, JSON.stringify(profileData));
                existing.exampleCount = examples.length; existing.updatedAt = Date.now();
                this.saveProfiles(this.getProfiles());
                return { saved: true, profileName: existing.name };
            } catch { return { saved: false, profileName: '' }; }
        }
        const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const newName = `${strokeType.charAt(0).toUpperCase() + strokeType.slice(1)} - ${ts}`;
        const profile = this.saveAsProfile(newName, strokeType);
        return { saved: !!profile, profileName: profile?.name || '' };
    }

    static getLastSaveTime(): Date | null {
        const data = this.load();
        return data.lastUpdated ? new Date(data.lastUpdated) : null;
    }

    // ── Cloud persistence ─────────────────────────────────────────────────────
    static async saveToCloud(): Promise<{ ok: boolean; error?: string }> {
        if (!CalibrationCloudSync.isAvailable()) return { ok: false, error: 'Supabase not configured' };
        try {
            const res = await CalibrationCloudSync.uploadBundle(CLOUD_AUTO_KEY, this.exportBundle({ includeFrameImages: true }));
            return { ok: res.ok, error: res.message };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    static async loadFromCloud(): Promise<{ ok: boolean; imported?: number; error?: string }> {
        if (!CalibrationCloudSync.isAvailable()) return { ok: false, error: 'Supabase not configured' };
        try {
            const res = await CalibrationCloudSync.downloadBundle(CLOUD_AUTO_KEY);
            if (!res.ok || !res.bundleJson) return { ok: false, error: res.message };
            const result = this.importBundle(res.bundleJson, { mode: 'merge' });
            return { ok: result.ok, imported: result.importedExamples, error: result.message };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }
}