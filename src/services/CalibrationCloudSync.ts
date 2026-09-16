import { supabase } from '../lib/supabase';

export interface CloudSyncStatus {
  ok: boolean;
  message?: string;
}

export class CalibrationCloudSync {
  static isAvailable(): boolean {
    return supabase !== null;
  }

  static async uploadBundle(syncKey: string, bundleJson: string): Promise<CloudSyncStatus> {
    if (!supabase) return { ok: false, message: 'Supabase not configured' };

    const key = (syncKey || '').trim();
    if (!key) return { ok: false, message: 'Sync key is required' };
    if (bundleJson.length < 10) return { ok: false, message: 'Bundle is empty' };

    try {
      const { error } = await supabase
        .from('calibration_sync')
        .upsert(
          {
            sync_key: key,
            bundle_json: bundleJson,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'sync_key' }
        );

      if (error) {
        return { ok: false, message: error.message };
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Upload failed' };
    }
  }

  static async downloadBundle(syncKey: string): Promise<{ ok: boolean; bundleJson?: string; message?: string }> {
    if (!supabase) return { ok: false, message: 'Supabase not configured' };

    const key = (syncKey || '').trim();
    if (!key) return { ok: false, message: 'Sync key is required' };

    try {
      const { data, error } = await supabase
        .from('calibration_sync')
        .select('bundle_json, updated_at')
        .eq('sync_key', key)
        .maybeSingle();

      if (error) {
        return { ok: false, message: error.message };
      }

      if (!data?.bundle_json) {
        return { ok: false, message: 'No calibration found for that sync key' };
      }

      return { ok: true, bundleJson: data.bundle_json as string };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Download failed' };
    }
  }

  /**
   * Delete all calibration sync data from Supabase (wipe cloud backup)
   */
  static async deleteAllSync(): Promise<CloudSyncStatus> {
    if (!supabase) return { ok: true, message: 'Supabase not configured (nothing to delete)' };

    try {
      const { error } = await supabase
        .from('calibration_sync')
        .delete()
        .neq('sync_key', ''); // Delete all rows

      if (error) {
        return { ok: false, message: error.message };
      }

      return { ok: true, message: 'All cloud calibration data deleted' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Delete failed' };
    }
  }
}
