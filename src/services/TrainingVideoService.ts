/**
 * TrainingVideoService
 * Manages training videos stored in the 'trainingvideolib' Supabase bucket.
 * Kept separate from ReferenceVideoService ('videos' bucket).
 * Admin must create the 'trainingvideolib' bucket in Supabase dashboard
 * (Storage → New bucket, name: trainingvideolib, Public: true) before
 * video uploads will work.
 */
import { supabase } from '../lib/supabase';
import { ReferenceVideo } from './ReferenceVideoService';

const BUCKET = 'trainingvideolib';

class TrainingVideoService {
    private cache: ReferenceVideo[] = [];
    private lastFetch = 0;
    private readonly CACHE_TTL_MS = 30_000;

    isSupabaseConfigured(): boolean {
        return supabase !== null;
    }

    async getAllVideos(): Promise<ReferenceVideo[]> {
        if (!supabase) return [];
        const now = Date.now();
        if (this.cache.length > 0 && now - this.lastFetch < this.CACHE_TTL_MS) {
            return this.cache;
        }
        try {
            const { data: files, error } = await supabase.storage
                .from(BUCKET)
                .list(undefined, { limit: 1000 });
            if (error || !files) return [];
            const bucketUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;
            const videos: ReferenceVideo[] = files.map(file => ({
                id: file.id || file.name,
                title: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim(),
                description: 'Training video',
                url: `${bucketUrl}/${encodeURIComponent(file.name)}`,
                uploadedBy: 'Admin',
                uploadedAt: file.created_at || new Date().toISOString(),
                tags: this.inferTagsFromName(file.name),
            }));
            this.cache = videos;
            this.lastFetch = now;
            return videos;
        } catch (e) {
            console.warn('[TrainingVideoService] Error listing videos:', e);
            return [];
        }
    }

    async uploadVideo(
        file: File,
        tags: string[] = [],
    ): Promise<{ url: string; video: ReferenceVideo } | null> {
        if (!supabase) return null;
        try {
            const ext = file.name.match(/\.[^/.]+$/)?.[0] ?? '.mp4';
            const sport = 'tennis';
            const skill = tags.find(t => t !== 'tennis') ?? 'general';
            const uniqueId = Date.now().toString(36);
            const filename = `${sport}_${skill}_${uniqueId}${ext}`;
            const { error: uploadError } = await supabase.storage
                .from(BUCKET)
                .upload(filename, file, { cacheControl: '3600', upsert: false });
            if (uploadError) {
                console.error('[TrainingVideoService] Upload error:', uploadError);
                return null;
            }
            const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename);
            this.lastFetch = 0;
            const video: ReferenceVideo = {
                id: `training_${uniqueId}`,
                title: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim(),
                description: 'Training video',
                url: urlData.publicUrl,
                uploadedBy: 'Admin',
                uploadedAt: new Date().toISOString(),
                tags: tags.length > 0 ? tags : [sport, skill],
                sport,
            };
            return { url: urlData.publicUrl, video };
        } catch (e) {
            console.error('[TrainingVideoService] Upload failed:', e);
            return null;
        }
    }

    async deleteVideo(video: ReferenceVideo): Promise<boolean> {
        if (!supabase) return false;
        try {
            const filename = video.url.split('/').pop();
            if (!filename) return false;
            const { error } = await supabase.storage
                .from(BUCKET)
                .remove([decodeURIComponent(filename)]);
            if (error) return false;
            this.lastFetch = 0;
            return true;
        } catch {
            return false;
        }
    }

    private inferTagsFromName(name: string): string[] {
        const s = name.toLowerCase();
        const tags: string[] = [];
        tags.push('tennis');
        for (const skill of [
            'forehand', 'backhand', 'serve', 'volley', 'overhead',
            'drop', 'lob',
        ]) {
            if (s.includes(skill)) {
                tags.push(skill);
                break;
            }
        }
        return tags;
    }
}

export const trainingVideoService = new TrainingVideoService();
