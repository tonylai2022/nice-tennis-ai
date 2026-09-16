import mockVideos from '../data/mock_videos.json';
import { supabase } from '../lib/supabase';

export interface ReferenceVideo {
  id: string;
  title: string;
  description: string;
  url: string; // URL to the video file
  thumbnailUrl?: string;
  uploadedBy: string;
  uploadedAt: string;
  tags: string[];
  sport?: 'tennis';
  duration?: number;
  /** Admin-set phase timestamps (seconds) for accurate ref frame selection */
  phaseTimestamps?: Record<string, number>;
}

const LIVE_TENNIS_SERVE_REFERENCE_STORAGE_KEY = 'motiontutor_live_tennis_serve_reference';

// Known skill tags — used to detect if a video is already correctly tagged
// Includes simple and compound tennis skills.
const SKILL_TAGS = new Set([
  'serve', 'forehand', 'backhand', 'volley', 'overhead',
  'drop', 'lob', 'forehand_volley', 'backhand_volley',
  // Tentative future skills
  'slice', 'topspin',
]);

/** Encode a human title into a filename-safe slug */
function toTitleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

/**
 * Derive sport + skill from a filename/URL string.
 * New-format filenames encode them explicitly:
 *   {sport}_{skillSlug}_{8charId}_{titleSlug}.ext
 * e.g. tennis_serve_abc12345_power-serve.mp4
 * titleFromSlug is the decoded human title embedded in that filename.
 */
function inferFromFileName(nameOrUrl: string): {
  sport?: 'tennis';
  skill?: string;
  titleHint?: string;        // e.g. 'Backhand Volley' (from keywords)
  titleFromSlug?: string;    // e.g. 'Pro Fh Shot' (decoded from new-format filename)
} {
  // Work on just the basename, lowercased
  const basename = (nameOrUrl.match(/[^/\\]+$/) ?? [nameOrUrl])[0];
  const s = basename.toLowerCase();

  // Remove extension to get the name parts
  const nameNoExt = s.replace(/\.[^/.]+$/, '');
  const parts = nameNoExt.split('_');

  // Try to parse new-format filename: {sport}_{skillSlug}_{8charBase36Id}_{titleSlug...}
  // The 8-char ID is exactly 8 lowercase alphanumeric chars (Date.now().toString(36)).
  // IMPORTANT: require at least one digit so pure-letter skill words like 'overhead',
  // 'forehand', 'backhand' (all 8 letters) are never mistaken for the random timestamp ID.
  const idIdx = parts.findIndex(p => /^[a-z0-9]{8}$/.test(p) && /[0-9]/.test(p));

  let sport: 'tennis' | undefined;
  let skill: string | undefined;
  let titleHint: string | undefined;
  let titleFromSlug: string | undefined;

  // If we found the 8-char ID, parse new format
  if (idIdx >= 1) {
    // parts[0] should be sport
    const sportPart = parts[0];
    if (sportPart === 'tennis' || sportPart === 'tn') sport = 'tennis';

    // parts[1] to parts[idIdx-1] should be the skill slug
    if (idIdx >= 1) {
      const skillSlug = parts.slice(1, idIdx).join('_');
      if (skillSlug && SKILL_TAGS.has(skillSlug)) {
        skill = skillSlug;
      }
    }

    // parts[idIdx+1] onwards is the title slug
    if (idIdx < parts.length - 1) {
      titleFromSlug = parts
        .slice(idIdx + 1)
        .join(' ')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    }
  }

  // Fallback: if new format didn't work, use keyword matching
  if (!sport) {
    if (s.includes('tennis') || s.includes('tn_')) sport = 'tennis';
  }

  if (!skill) {
    // Detect handedness modifier independently
    const isFH = s.includes('forehand') || s.includes('_fh_') || s.includes('_fh.') || s.startsWith('fh_');
    const isBH = s.includes('backhand') || s.includes('_bh_') || s.includes('_bh.') || s.startsWith('bh_');

    // Shot type (independent of handedness)
    const isVolley = s.includes('volley') || (s.includes('_vol') && !s.includes('volta'));
    if (s.includes('overhead') || s.includes('smash')) {
      skill = 'overhead';
    } else if (s.includes('serve') || s.includes('_srv')) {
      skill = 'serve';
    } else if (isVolley) {
      if (isBH) skill = 'backhand_volley';
      else if (isFH) skill = 'forehand_volley';
      else skill = 'volley';
    } else if (isFH) {
      skill = 'forehand';
    } else if (isBH) {
      skill = 'backhand';
    } else if (s.includes('drop')) {
      skill = 'drop';
    } else if (s.includes('lob')) {
      skill = 'lob';
    }
  }

  return { sport, skill, titleHint, titleFromSlug };
}

/**
 * Ensure every video has accurate sport + skill tags, derived from its
 * URL/filename when the stored tags are missing or incorrect.
 * Safe to call on mock data too (it already has good tags — no-op).
 */
function normalizeVideoTags(video: ReferenceVideo): ReferenceVideo {
  console.log('[normalizeVideoTags] Processing video:', video.title, { tags: video.tags, sport: video.sport });

  // For uploaded files, infer from filename
  // This helps ensure tags are consistent with the most recent filename logic
  const inferred = inferFromFileName(video.url || video.title || '');

  let tags = Array.from(new Set(video.tags.map(tag => tag.toLowerCase())));
  const sportFromTags: 'tennis' | undefined = tags.includes('tennis') ? 'tennis' : undefined;

  const sport: 'tennis' | undefined = inferred.sport ?? video.sport ?? sportFromTags;

  // Ensure sport tag is present and correct.
  if (sport) {
    tags = tags.filter(tag => tag !== 'tennis');
    tags.unshift(sport);
  }

  // When the filename encodes a skill, treat that as the source of truth and
  // strip conflicting stored skill tags so clips cannot leak into other libraries.
  if (inferred.skill) {
    tags = tags.filter(tag => !SKILL_TAGS.has(tag));
    const sportIdx = tags.findIndex(tag => tag === 'tennis');
    if (sportIdx >= 0) {
      tags.splice(sportIdx + 1, 0, inferred.skill);
    } else {
      tags.unshift(inferred.skill);
    }
  }

  const title = video.title
    .replace(/^\d{10,}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim() || video.title;

  console.log('[normalizeVideoTags] Normalized video:', video.title, { tags, sport });
  return { ...video, tags, sport, title };
}

/**
 * Service to manage Admin-uploaded reference videos.
 * Supports switching between Local Mock Data and Real Supabase Backend.
 */
class ReferenceVideoService {
  private videos: ReferenceVideo[] = [];
  private lastFetch: number = 0;
  private fetchCache: ReferenceVideo[] = [];

  setLiveTennisServeReference(video: ReferenceVideo): void {
    const isTennisServe = (video.sport === 'tennis' || video.tags.some(tag => tag.toLowerCase() === 'tennis'))
      && video.tags.some(tag => tag.toLowerCase() === 'serve');
    if (!isTennisServe) return;

    try {
      localStorage.setItem(LIVE_TENNIS_SERVE_REFERENCE_STORAGE_KEY, JSON.stringify(video));
    } catch (error) {
      console.warn('[ReferenceVideoService] Could not save live tennis serve reference', error);
    }
  }

  getLiveTennisServeReference(): ReferenceVideo | null {
    try {
      const stored = localStorage.getItem(LIVE_TENNIS_SERVE_REFERENCE_STORAGE_KEY);
      if (!stored) return null;

      const video = JSON.parse(stored) as ReferenceVideo;
      const isTennisServe = Array.isArray(video?.tags)
        && (video.sport === 'tennis' || video.tags.some(tag => tag.toLowerCase() === 'tennis'))
        && video.tags.some(tag => tag.toLowerCase() === 'serve');
      return isTennisServe && typeof video.url === 'string' ? video : null;
    } catch (error) {
      console.warn('[ReferenceVideoService] Could not load live tennis serve reference', error);
      return null;
    }
  }

  clearLiveTennisServeReference(): void {
    try {
      localStorage.removeItem(LIVE_TENNIS_SERVE_REFERENCE_STORAGE_KEY);
    } catch (error) {
      console.warn('[ReferenceVideoService] Could not clear live tennis serve reference', error);
    }
  }
  private deletedVideoUrls: Set<string> = new Set();
  private readonly DELETED_VIDEOS_STORAGE_KEY = 'motiontutor_deleted_videos';
  private readonly PHASE_TS_KEY = 'motiontutor_phase_timestamps_v1';

  constructor() {
    this.videos = mockVideos as ReferenceVideo[];
    console.log('[ReferenceVideoService] Constructor: loaded', this.videos.length, 'mock videos');
    if (this.videos.length > 0) {
      console.log('[ReferenceVideoService] First mock video:', this.videos[0]);
    }
    // Load deleted videos from localStorage
    this.loadDeletedVideosFromStorage();
  }

  /** Load all locally-saved phase timestamps (keyed by video URL). */
  private loadLocalPhaseTimestamps(): Record<string, Record<string, number>> {
    try {
      const raw = localStorage.getItem(this.PHASE_TS_KEY);
      if (raw) return JSON.parse(raw) as Record<string, Record<string, number>>;
    } catch { /* ignore */ }
    return {};
  }

  /** Persist phase timestamps to localStorage (keyed by video URL). */
  private saveLocalPhaseTimestamps(data: Record<string, Record<string, number>>): void {
    try {
      localStorage.setItem(this.PHASE_TS_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }

  /** Overlay locally-saved phase timestamps onto a video list. */
  private overlayLocalPhaseTimestamps(videos: ReferenceVideo[]): ReferenceVideo[] {
    const local = this.loadLocalPhaseTimestamps();
    if (Object.keys(local).length === 0) return videos;
    return videos.map(v => {
      const saved = local[v.url];
      if (saved && Object.keys(saved).length > 0) {
        return { ...v, phaseTimestamps: saved };
      }
      return v;
    });
  }

  /**
   * Load deletion history from localStorage to prevent re-showing deleted videos
   */
  private loadDeletedVideosFromStorage() {
    try {
      const stored = localStorage.getItem(this.DELETED_VIDEOS_STORAGE_KEY);
      if (stored) {
        this.deletedVideoUrls = new Set(JSON.parse(stored));
        console.log(`[ReferenceVideoService] Loaded ${this.deletedVideoUrls.size} deleted video URLs from localStorage`);
      }
    } catch (err) {
      console.warn('[ReferenceVideoService] Failed to load deleted videos from localStorage:', err);
    }
  }

  /**
   * Save deletion history to localStorage
   */
  private saveDeletedVideosToStorage() {
    try {
      localStorage.setItem(this.DELETED_VIDEOS_STORAGE_KEY, JSON.stringify(Array.from(this.deletedVideoUrls)));
      console.log(`[ReferenceVideoService] Saved ${this.deletedVideoUrls.size} deleted video URLs to localStorage`);
    } catch (err) {
      console.warn('[ReferenceVideoService] Failed to save deleted videos to localStorage:', err);
    }
  }

  /**
   * Invalidate cache to force re-fetch on next getAllVideos call
   */
  private invalidateCache() {
    this.lastFetch = 0;
    this.fetchCache = [];
    console.log('[ReferenceVideoService] Cache invalidated');
  }

  /**
   * Fetch all available reference videos.
   * Strategy: always list the storage bucket (source of truth for real files),
   * then enrich / supplement with DB records, then fall back to mock data.
   */
  async getAllVideos(): Promise<ReferenceVideo[]> {
    console.log('[ReferenceVideoService] getAllVideos called, supabase:', !!supabase);

    if (!supabase) {
      // No Supabase — use mock data, overlaid with any locally-saved phase timestamps.
      console.log('[ReferenceVideoService] No Supabase, returning mock data:', this.videos.length, 'videos');
      const normalized = this.videos.map(normalizeVideoTags);
      console.log('[ReferenceVideoService] After normalization:', normalized.length, 'videos');
      return this.overlayLocalPhaseTimestamps(normalized);
    }

    // ---- 1. List all files in storage bucket (always, not just when DB is empty) ----
    const bucketUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/videos`;
    let bucketVideos: ReferenceVideo[] = [];
    // Track files whose sport couldn't be inferred from filename — we'll recover
    // them from DB records during the merge step (old uploads without sport prefix).
    const unrecognizedFileUrls: string[] = [];

    try {
      const { data: files, error: storageError } = await supabase.storage
        .from('videos')
        .list(undefined, { limit: 1000 });
      console.log('[ReferenceVideoService] Bucket list result - Error:', storageError, 'Files found:', files?.length ?? 0);
      if (storageError) {
        console.error('[ReferenceVideoService] Storage listing error:', storageError);
      }
      if (files) {
        console.log('[ReferenceVideoService] Bucket files:', files.map(f => f.name).join(', '));
      }

      if (!storageError && files && files.length > 0) {
        bucketVideos = files
          .map(file => {
            const url = `${bucketUrl}/${file.name}`;
            const inferred = inferFromFileName(file.name);

            // If sport cannot be determined from the filename, remember the URL so we can
            // recover metadata from the DB record rather than discarding it entirely.
            if (!inferred.sport) {
              console.log(`[ReferenceVideoService] No sport detected in filename: ${file.name} — will try DB enrichment`);
              unrecognizedFileUrls.push(url);
              return null;
            }

            const sport = inferred.sport;
            const tags: string[] = [sport];
            if (inferred.skill) tags.push(inferred.skill);
            tags.push('pro', 'auto-discovered');

            const sportLabel = 'Tennis';
            const title =
              inferred.titleFromSlug
              ?? (inferred.titleHint ? `${sportLabel} ${inferred.titleHint}` : undefined)
              ?? (inferred.skill
                ? `${sportLabel} ${inferred.skill.charAt(0).toUpperCase() + inferred.skill.slice(1)}`
                : undefined)
              ?? (() => {
                const rawName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
                return rawName.replace(/^\d{10,}\s*/g, '').replace(/[a-z0-9]{6,}$/i, '').replace(/\s+/g, ' ').trim() || `${sportLabel} Video`;
              })();

            return {
              id: file.id || file.name,
              title,
              description: 'Auto-detected from storage',
              url,
              thumbnailUrl: '',
              uploadedBy: 'System',
              uploadedAt: file.created_at || new Date().toISOString(),
              tags,
              sport,
              duration: 0,
            } as ReferenceVideo;
          })
          .filter((v): v is ReferenceVideo => v !== null)
          // Run normalization on all bucket videos to ensure consistent tags/titles
          .map(normalizeVideoTags);
      }
    } catch (e) {
      console.warn('🎬 Bucket listing failed:', e);
    }

    // ---- 2. Fetch DB records (may have richer metadata / titles) ----
    let dbVideos: ReferenceVideo[] = [];
    try {
      const { data, error } = await supabase.from('reference_videos').select('*');
      if (!error && data && data.length > 0) {
        dbVideos = (data as ReferenceVideo[]).map(normalizeVideoTags);
      }
    } catch (e) {
      console.warn('🎬 DB fetch failed:', e);
    }

    // ---- 3. Merge: bucket is source of truth for file existence ----
    // Build a lookup of DB records by URL basename for enrichment
    const dbByBasename = new Map<string, ReferenceVideo>();
    for (const v of dbVideos) {
      const base = v.url.split('/').pop() ?? '';
      dbByBasename.set(base, v);
    }

    // Helper: extract phaseTimestamps from a DB row (snake_case → camelCase)
    const extractPhaseTimestamps = (row: any): Record<string, number> | undefined => {
      const pts = row?.phase_timestamps;
      if (!pts || typeof pts !== 'object') return undefined;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(pts)) {
        if (typeof v === 'number' && isFinite(v)) out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    };

    // Enrich bucket entries with DB metadata where available
    const merged: ReferenceVideo[] = bucketVideos.map(bv => {
      const base = bv.url.split('/').pop() ?? '';
      const dbRecord = dbByBasename.get(base);
      if (dbRecord) {
        // Use DB title/description but re-normalize tags from filename (DB tags may be wrong)
        const phaseTimestamps = extractPhaseTimestamps(dbRecord);
        return normalizeVideoTags({ ...dbRecord, url: bv.url, ...(phaseTimestamps ? { phaseTimestamps } : {}) });
      }
      return bv;
    });

    // Add any DB-only records (e.g. external URL videos not in this bucket)
    const bucketUrls = new Set(bucketVideos.map(v => v.url));
    for (const dv of dbVideos) {
      if (!bucketUrls.has(dv.url)) {
        // DB rows use snake_case (phase_timestamps). Convert to camelCase (phaseTimestamps)
        // so the frontend VideoPhaseCalibrator sees the saved timestamps on reload.
        const phaseTimestamps = extractPhaseTimestamps(dv);
        merged.push(phaseTimestamps ? { ...dv, phaseTimestamps } : dv);
      }
    }

    // Recover bucket files whose sport couldn't be inferred from filename (old uploads).
    // If the DB has a record for the file, use it — the DB tags carry the correct sport/skill.
    for (const url of unrecognizedFileUrls) {
      if (bucketUrls.has(url)) continue; // already in merged via bucket path (shouldn't happen)
      const base = url.split('/').pop() ?? '';
      const dbRecord = dbByBasename.get(base);
      if (dbRecord) {
        console.log(`[ReferenceVideoService] Recovered old-format file from DB record: ${base}`);
        const phaseTimestamps = extractPhaseTimestamps(dbRecord);
        merged.push(normalizeVideoTags({ ...dbRecord, url, ...(phaseTimestamps ? { phaseTimestamps } : {}) }));
      } else {
        console.log(`[ReferenceVideoService] No DB record for unrecognized file: ${base} — skipping`);
      }
    }

    // ---- 4. Always merge mock/local videos so they are visible even when Supabase has data ----
    // Mock videos (e.g. Novak reference clips) live at local /reference_videos/ paths and are
    // never uploaded to Supabase. Without this merge they disappear the moment any Supabase
    // video exists.
    const mockNormalized = this.videos.map(normalizeVideoTags);
    const supabaseUrls = new Set(merged.map(v => v.url));
    const mockToAdd = mockNormalized.filter(v => !supabaseUrls.has(v.url));
    if (mockToAdd.length > 0) {
      console.log(`🎬 Adding ${mockToAdd.length} local/mock videos alongside Supabase data`);
      merged.push(...mockToAdd);
    }

    // Filter out deleted videos across the full merged set
    const filtered = merged.filter(v =>
      !this.deletedVideoUrls.has(v.url)
      && (v.sport === 'tennis' || v.tags.includes('tennis'))
    );
    console.log(`🎬 Loaded ${filtered.length} videos (${bucketVideos.length} from bucket, ${dbVideos.length} from DB, ${mockToAdd.length} local, filtered out ${merged.length - filtered.length} deleted)`);
    // Overlay any locally-saved phase timestamps (localStorage is the source of truth;
    // Supabase is best-effort backup — this ensures timestamps survive regardless).
    return this.overlayLocalPhaseTimestamps(filtered);
  }

  /**
   * Fetch a single video by ID
   */
  async getVideoById(id: string): Promise<ReferenceVideo | undefined> {
    if (supabase) {
      const { data } = await supabase
        .from('reference_videos')
        .select('*')
        .eq('id', id)
        .single();
      if (data) return data as ReferenceVideo;
    }
    return this.videos.find(v => v.id === id);
  }

  // ... (upload logic would go here, requiring Authentication)

  /**
   * Delete a reference video from both DB and bucket storage.
   */
  async deleteVideo(video: ReferenceVideo): Promise<boolean> {
    if (!supabase) {
      console.warn('[ReferenceVideoService] Cannot delete: Supabase not configured');
      return false;
    }

    try {
      console.log(`[ReferenceVideoService] Deleting video: ${video.title} (${video.id}), URL: ${video.url}`);

      // 1. Extract filename from URL - handle both Supabase and external URLs
      let filename: string | null = null;

      // Try to extract from Supabase URL format
      if (video.url.includes('/storage/v1/object/public/videos/')) {
        filename = video.url.split('/').pop();
      } else if (video.url.includes('blob:')) {
        // Blob URLs can't be deleted from storage
        filename = null;
      } else {
        // Try standard extraction
        filename = video.url.split('/').pop();
      }

      // If we got a filename, try to delete from storage
      let storageDeleteSucceeded = false;
      if (filename && !filename.includes('blob')) {
        console.log(`[ReferenceVideoService] Attempting to delete file from storage: ${filename}`);
        const { error: storageError } = await supabase.storage
          .from('videos')
          .remove([filename]);

        if (storageError) {
          const errorMsg = JSON.stringify(storageError);
          console.error('[ReferenceVideoService] Storage removal error:', errorMsg);

          // Check if it's a permissions error
          if (errorMsg.includes('Unauthorized') || errorMsg.includes('Permission denied') || errorMsg.includes('not authorized')) {
            console.error('%c[FIX REQUIRED] Bucket DELETE permissions not set for anon users', 'color: red; font-weight: bold;');
            console.error('%c✓ To fix: Go to Supabase Dashboard → Storage → videos bucket → Policies → Create a policy:', 'color: orange;');
            console.error('%cTemplate policy for public bucket deletion:\nRole: anon\nPermission: DELETE\nTarget: authenticated or public\nWith expression: true', 'color: orange; font-family: monospace;');
            console.error('%cOr simpler: Allow everyone to delete from the "videos" bucket', 'color: orange;');
          }
        } else {
          console.log(`[ReferenceVideoService] Storage file removed successfully: ${filename}`);
          storageDeleteSucceeded = true;
        }
      } else if (!filename) {
        console.log('[ReferenceVideoService] Could not extract filename (likely blob or external URL)');
      }

      // Always blacklist the URL first so the video never reappears from the bucket,
      // regardless of which code path returns true below.
      this.deletedVideoUrls.add(video.url);
      this.saveDeletedVideosToStorage();
      console.log(`[ReferenceVideoService] Added to deletion blacklist: ${video.url}`);

      // 2. Delete from database table - try multiple conditions
      try {
        // First try deleting by ID
        const { error: idError, count: idCount } = await supabase
          .from('reference_videos')
          .delete()
          .eq('id', video.id);

        if (!idError) {
          console.log(`[ReferenceVideoService] DB record removed by ID. Rows deleted: ${idCount}`);
          this.invalidateCache();
          return true;
        }

        // If ID delete didn't work or returned error, try by URL
        const { error: urlError, count: urlCount } = await supabase
          .from('reference_videos')
          .delete()
          .eq('url', video.url);

        if (!urlError) {
          console.log(`[ReferenceVideoService] DB record removed by URL. Rows deleted: ${urlCount}`);
          this.invalidateCache();
          return true;
        }

        if (idError) console.error('[ReferenceVideoService] DB delete by ID error:', idError);
        if (urlError) console.error('[ReferenceVideoService] DB delete by URL error:', urlError);
      } catch (dbErr) {
        // Silently handle - video may still be removed from storage
        console.warn('[ReferenceVideoService] DB deletion failed or table may not exist:', dbErr);
      }

      this.invalidateCache();
      return true;

    } catch (err) {
      console.error('[ReferenceVideoService] Failed to delete video:', err);
      return false;
    }
  }

  /**
   * Search videos by tag or title
   */
  async searchVideos(query: string): Promise<ReferenceVideo[]> {
    const lowerQuery = query.toLowerCase();

    // In a real app with Supabase, you would use .ilike() or Full Text Search
    if (supabase) {
      const { data } = await supabase
        .from('reference_videos')
        .select('*')
        .or(`title.ilike.%${query}%,description.ilike.%${query}%`);
      if (data) return data as ReferenceVideo[];
    }

    return this.videos.filter(v =>
      v.title.toLowerCase().includes(lowerQuery) ||
      v.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Upload a video file to Supabase storage
   * Returns the public URL of the uploaded video
   */
  async uploadVideo(file: File, tags: string[] = [], customTitle?: string, phaseTimestampsArg?: Record<string, number>): Promise<{ url: string; video: ReferenceVideo } | null> {
    if (!supabase) {
      console.warn('Supabase not configured, cannot upload video');
      return null;
    }

    try {
      const ext = file.name.match(/\.[^/.]+$/)?.[0] ?? '.mp4';

      // Filename embeds sport, skill, unique-ID and (if provided) the custom title slug.
      // Format: {sport}_{skillSlug}_{8charBase36Id}_{titleSlug}.ext
      // This makes the title recoverable from the bucket even when the DB insert fails.
      const sport = 'tennis';
      const skills = tags.filter(t => !['tennis', 'pro'].includes(t));
      const skillSlug = skills.join('_') || 'general';
      const uniqueId = Date.now().toString(36); // 8 lowercase alphanumeric chars
      const titleSlug = customTitle ? toTitleSlug(customTitle) : '';
      const filename = titleSlug
        ? `${sport}_${skillSlug}_${uniqueId}_${titleSlug}${ext}`
        : `${sport}_${skillSlug}_${uniqueId}${ext}`;

      console.log(`[ReferenceVideoService] Uploading: ${filename}, tags: ${JSON.stringify(tags)}`);

      // Upload to storage bucket 'videos'
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('videos')
        .upload(filename, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('[ReferenceVideoService] Storage upload error:', {
          message: uploadError.message,
          statusCode: (uploadError as any).statusCode,
          error: uploadError
        });
        const rawMessage = uploadError.message || 'Unknown error';
        if (/failed to fetch/i.test(rawMessage)) {
          throw new Error(
            'Storage upload failed: Failed to reach Supabase Storage endpoint. ' +
            'Check VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY, network/ad-blockers, and bucket policies.'
          );
        }
        throw new Error(`Storage upload failed: ${rawMessage}`);
      }

      console.log(`[ReferenceVideoService] Storage upload succeeded: ${filename}`);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('videos')
        .getPublicUrl(filename);

      const publicUrl = urlData.publicUrl;
      console.log(`[ReferenceVideoService] Public URL: ${publicUrl}`);

      // Derive clean title: prefer customTitle, then titleFromSlug decoded from filename,
      // then auto-title from sport+skill hint.
      const sportLabel = 'Tennis';
      const { titleHint, titleFromSlug } = inferFromFileName(filename);
      const autoTitle =
        titleFromSlug
        ?? (titleHint ? `${sportLabel} ${titleHint}` : undefined)
        ?? (skillSlug !== 'general'
          ? `${sportLabel} ${skillSlug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`
          : sportLabel);
      const rawName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const cleanTitle = (customTitle?.trim() || autoTitle)
        .replace(/^\d{10,}\s*/g, '').replace(/\s+/g, ' ').trim() || rawName;

      // Full local record (for returning to caller)
      const videoRecord: Omit<ReferenceVideo, 'id'> = {
        title: cleanTitle,
        description: 'Uploaded reference video',
        url: publicUrl,
        thumbnailUrl: '',
        uploadedBy: 'User',
        uploadedAt: new Date().toISOString(),
        tags: tags.length > 0 ? tags : this.inferTags(file.name),
        sport,
        duration: 0,
      };

      console.log(`[ReferenceVideoService] Attempting DB insert: title="${cleanTitle}", tags=[${videoRecord.tags.join(',')}]`);

      // Only insert columns that exist in the Supabase schema.
      // 'sport', 'thumbnailUrl', 'duration' may not be present — omit them to avoid 400 errors.
      const dbInsert: Record<string, unknown> = {
        title: videoRecord.title,
        description: videoRecord.description,
        url: videoRecord.url,
        uploaded_by: videoRecord.uploadedBy,
        uploaded_at: videoRecord.uploadedAt,
        tags: videoRecord.tags,
      };
      // Include phase_timestamps if provided at upload time (optional)
      if (phaseTimestampsArg && Object.keys(phaseTimestampsArg).length > 0) {
        dbInsert.phase_timestamps = phaseTimestampsArg;
      }

      // Try to insert into database (optional — storage alone works for discovery)
      const { data: dbData, error: dbError } = await supabase
        .from('reference_videos')
        .insert(dbInsert)
        .select()
        .single();

      if (dbError) {
        console.warn('[ReferenceVideoService] DB insert failed (storage upload succeeded):', {
          message: dbError.message,
          code: (dbError as any).code,
          error: dbError
        });
        console.warn('[ReferenceVideoService] Returning video from storage anyway (graceful fallback)');
        return {
          url: publicUrl,
          video: { ...videoRecord, id: `storage_${uniqueId}` } as ReferenceVideo,
        };
      }

      console.log(`[ReferenceVideoService] Upload complete: ${videoRecord.title} (ID: ${(dbData as any).id})`);
      return {
        url: publicUrl,
        video: normalizeVideoTags({ ...videoRecord, id: (dbData as any).id ?? `storage_${uniqueId}` }),
      };
    } catch (error) {
      console.error('[ReferenceVideoService] Upload failed with exception:', {
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error; // Re-throw so caller can see the actual error
    }
  }

  /**
   * Infer tags from filename
   */
  private inferTags(filename: string): string[] {
    const lower = filename.toLowerCase();
    const tags: string[] = [];

    if (lower.includes('serve')) tags.push('serve');
    if (lower.includes('forehand')) tags.push('forehand');
    if (lower.includes('backhand')) tags.push('backhand');
    if (lower.includes('volley')) tags.push('volley');

    return tags.length > 0 ? tags : ['uncategorized'];
  }

  /**
   * Update phase timestamps for an existing reference video.
   * @param videoId - The Supabase DB row id or video url (tries both)
   * @param timestamps - Map of phase keys (e.g. "contact") to seconds
   */
  async updatePhaseTimestamps(videoId: string, timestamps: Record<string, number>, videoUrl?: string): Promise<boolean> {
    // ---- 1. Always save to localStorage first ----
    // This is the primary store — works regardless of Supabase configuration.
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(timestamps)) {
      if (typeof v === 'number' && isFinite(v)) clean[k] = v;
    }
    const urlKey = videoUrl ?? videoId; // use URL if available; fall back to ID
    if (urlKey) {
      const local = this.loadLocalPhaseTimestamps();
      local[urlKey] = clean;
      this.saveLocalPhaseTimestamps(local);
      console.log(`[ReferenceVideoService] Phase timestamps saved to localStorage for ${urlKey}:`, clean);
    }

    // ---- 2. Best-effort Supabase sync ----
    if (!supabase) {
      console.log('[ReferenceVideoService] Supabase not configured — localStorage-only save succeeded');
      return true;
    }
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(videoId);

      if (isUuid) {
        // Standard Supabase-inserted video — update by UUID
        const { error } = await supabase
          .from('reference_videos')
          .update({ phase_timestamps: clean })
          .eq('id', videoId);
        if (error) {
          console.warn('[ReferenceVideoService] Supabase updatePhaseTimestamps error (localStorage already saved):', error);
        }
      } else if (videoUrl) {
        // Local/mock video — try update by URL; insert row if it doesn't exist yet
        const { data: existing, error: selectErr } = await supabase
          .from('reference_videos')
          .select('id')
          .eq('url', videoUrl)
          .maybeSingle();
        if (selectErr) {
          console.warn('[ReferenceVideoService] Supabase lookup error (localStorage already saved):', selectErr);
        } else if (existing) {
          const { error } = await supabase
            .from('reference_videos')
            .update({ phase_timestamps: clean })
            .eq('url', videoUrl);
          if (error) {
            console.warn('[ReferenceVideoService] Supabase update by url error (localStorage already saved):', error);
          }
        } else {
          // Insert a minimal row so phase timestamps are persisted for this local video.
          const inferred = inferFromFileName(videoUrl);
          const baseTags: string[] = [];
          if (inferred.sport) baseTags.push(inferred.sport);
          if (inferred.skill) baseTags.push(inferred.skill);
          const { error } = await supabase
            .from('reference_videos')
            .insert({ url: videoUrl, title: videoId, tags: baseTags, sport: inferred.sport ?? undefined, phase_timestamps: clean });
          if (error) {
            console.warn('[ReferenceVideoService] Supabase insert error (localStorage already saved):', error);
          }
        }
      }

      this.invalidateCache();
      return true;
    } catch (e) {
      console.warn('[ReferenceVideoService] Supabase updatePhaseTimestamps exception (localStorage already saved):', e);
      return true;
    }
  }

  /**
   * Check if Supabase is configured and available
   */
  isSupabaseConfigured(): boolean {
    return supabase !== null;
  }
}

export const referenceVideoService = new ReferenceVideoService();
