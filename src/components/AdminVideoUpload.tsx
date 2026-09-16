import React, { useState, useRef } from 'react';
import { referenceVideoService } from '../services/ReferenceVideoService';
import { ReferenceLibrary } from './ReferenceLibrary';
import { ReportSettings } from './ReportSettings';
import { VideoPhaseCalibrator } from './VideoPhaseCalibrator';

interface AdminVideoUploadProps {
    onUploadComplete?: () => void;
}

const SKILL_OPTIONS = [
    { value: 'serve', label: '🎾 Serve' },
    { value: 'forehand', label: '🎾 Forehand Groundstroke' },
    { value: 'backhand', label: '🎾 Backhand Groundstroke' },
    { value: 'forehand_volley', label: '🎾 Forehand Volley' },
    { value: 'backhand_volley', label: '🎾 Backhand Volley' },
    { value: 'overhead', label: '🎾 Forehand Overhead' },
    { value: 'lob', label: '🎾 Lob' },
];

// Compound skill values → expanded tag arrays (primary skill tag listed first)
const COMPOUND_SKILLS: Record<string, string[]> = {
    forehand_volley: ['volley', 'forehand'],
    backhand_volley: ['volley', 'backhand'],
};

// Phase fields to show per primary skill when admin wants to set timestamps
const PHASE_FIELDS: Record<string, { key: string; label: string }[]> = {
    forehand: [
        { key: 'unitTurn', label: 'Unit Turn' },
        { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact Point' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    backhand: [
        { key: 'unitTurn', label: 'Unit Turn' },
        { key: 'racketDrop', label: 'Racket Drop' },
        { key: 'contact', label: 'Contact Point' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    serve: [
        { key: 'prep', label: 'Preparation' },
        { key: 'tossPeak', label: 'Ball Toss' },
        { key: 'loading', label: 'Trophy Position' },
        { key: 'contact', label: 'Contact Point' },
        { key: 'finish', label: 'Follow Through' },
    ],
    forehand_volley: [
        { key: 'contact', label: 'Contact Point' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    backhand_volley: [
        { key: 'contact', label: 'Contact Point' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
    overhead: [
        { key: 'contact', label: 'Contact Point' },
        { key: 'followThrough', label: 'Follow Through' },
    ],
};

export const AdminVideoUpload: React.FC<AdminVideoUploadProps> = ({ onUploadComplete }) => {
    const [activeTab, setActiveTab] = useState<'videos' | 'reports'>('videos');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const sport = 'tennis' as const;
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [customTitle, setCustomTitle] = useState('');
    const [description, setDescription] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
    const [phaseTimestamps, setPhaseTimestamps] = useState<Record<string, number>>({});
    const [showCalibrator, setShowCalibrator] = useState(false);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [liveTennisServeReferenceUrl, setLiveTennisServeReferenceUrl] = useState<string | null>(
        () => referenceVideoService.getLiveTennisServeReference()?.url ?? null
    );
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFile = (file: File) => {
        if (!file.type.startsWith('video/')) return;
        setSelectedFile(file);
        setUploadResult(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(file));
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) loadFile(file);
    };

    const handleFileDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    };

    const handleSkillToggle = (skill: string) => {
        setSelectedSkills(prev =>
            prev.includes(skill)
                ? prev.filter(s => s !== skill)
                : [...prev, skill]
        );
        // Reset phase timestamps when skill selection changes
        setPhaseTimestamps({});
    };

    const handleUpload = async () => {
        if (!selectedFile) {
            setUploadResult({ type: 'error', message: 'Please select a video file first' });
            return;
        }

        if (selectedSkills.length === 0) {
            setUploadResult({ type: 'error', message: 'Please select at least one skill/stroke type' });
            return;
        }

        if (!referenceVideoService.isSupabaseConfigured()) {
            setUploadResult({
                type: 'error',
                message: 'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.'
            });
            return;
        }

        setIsUploading(true);
        setUploadResult(null);

        try {
            // Use skill values as-is, don't expand compound skills
            // This keeps forehand_volley as a single tag instead of mixing it with forehand/volley
            const tags = [sport, ...selectedSkills, 'pro'];
            console.log('[AdminVideoUpload] Starting upload with tags:', tags);

            // Parse phase timestamps
            const parsedTimestamps: Record<string, number> = {};
            for (const [k, v] of Object.entries(phaseTimestamps)) {
                if (isFinite(v) && v >= 0) parsedTimestamps[k] = v;
            }

            const result = await referenceVideoService.uploadVideo(
                selectedFile,
                tags,
                customTitle || undefined,
                Object.keys(parsedTimestamps).length > 0 ? parsedTimestamps : undefined
            );

            if (result) {
                const skillLabels = selectedSkills.map(s => {
                    const opt = SKILL_OPTIONS.find(o => o.value === s);
                    return opt ? opt.label.replace(/^[^\s]+ /, '') : s; // strip emoji
                }).join(' / ');
                setUploadResult({
                    type: 'success',
                    message: `Video "${result.video.title}" uploaded successfully! Available in the Reference Library under ${sport} - ${skillLabels}.`
                });

                // Reset form
                setSelectedFile(null);
                setSelectedSkills([]);
                setCustomTitle('');
                setDescription('');
                setPhaseTimestamps({});
                if (previewUrl) {
                    URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                }
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }

                // Refresh the library so the new video appears immediately
                setLibraryRefreshKey(k => k + 1);
                // Trigger callback
                onUploadComplete?.();
            }
        } catch (error) {
            console.error('[AdminVideoUpload] Upload error:', error);
            const errorMsg = error instanceof Error ? error.message : String(error);

            let helpText = '';
            if (errorMsg.includes('Storage upload failed')) {
                helpText = ' Check that: 1) bucket "videos" exists, 2) bucket is PUBLIC, 3) Storage policies allow anon INSERT and SELECT for bucket_id = "videos", 4) VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY point to the correct project.';
            } else if (errorMsg.includes('DB insert failed') || errorMsg.includes('reference_videos')) {
                helpText = ' The "reference_videos" table might not exist in your Supabase database, or you don\'t have insert permissions. The video was stored successfully though.';
            }

            setUploadResult({
                type: 'error',
                message: `Upload failed: ${errorMsg}${helpText}`
            });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="card !p-0 overflow-hidden">
                {/* Tab Navigation */}
                <div className="flex border-b border-slate-800 bg-slate-900/50">
                    <button
                        onClick={() => setActiveTab('videos')}
                        className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${activeTab === 'videos'
                            ? 'text-accent border-b-2 border-accent bg-accent/5'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                            }`}
                    >
                        <span>🎬</span> Reference Videos
                    </button>
                    <button
                        onClick={() => setActiveTab('reports')}
                        className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${activeTab === 'reports'
                            ? 'text-accent border-b-2 border-accent bg-accent/5'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                            }`}
                    >
                        <span>📊</span> Report Settings
                    </button>
                </div>

                <div className="p-6">
                    {activeTab === 'videos' ? (
                        <>
                            <div className="flex items-center gap-3 mb-6">
                                <div className="bg-accent/20 p-3 rounded-lg">
                                    <span className="text-2xl">⚡</span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">Reference Video Management</h2>
                                    <p className="text-sm text-slate-400">Add or remove professional reference videos</p>
                                </div>
                            </div>

                            <div className="mb-6">
                                <label className="text-sm font-semibold text-slate-300 mb-2 block">Manage Library</label>
                                <p className="text-xs text-slate-500 mb-4">View and delete existing reference videos from the database and storage.</p>
                                <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4 max-h-[600px] overflow-y-auto custom-scrollbar">
                                    <ReferenceLibrary
                                        showAdminControls={true}
                                        filterSport={sport}
                                        refreshTrigger={libraryRefreshKey}
                                        onSelect={(video) => {
                                            referenceVideoService.setLiveTennisServeReference(video);
                                            setLiveTennisServeReferenceUrl(video.url);
                                            setUploadResult({
                                                type: 'success',
                                                message: `${video.title} is now the Tennis Live Coaching reference.`,
                                            });
                                        }}
                                        selectionLabel="Use for Live Tennis Coaching"
                                        isSelectable={(video) => video.tags.some((tag) => tag.toLowerCase() === 'serve')}
                                        selectedVideoUrl={liveTennisServeReferenceUrl}
                                        onDeleteSuccess={() => {
                                            setLibraryRefreshKey(k => k + 1);
                                            onUploadComplete?.();
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="h-px bg-slate-800 my-8 shadow-sm"></div>

                            {/* File Selection — drag & drop zone */}
                            <div className="mb-6">
                                <label className="text-sm font-semibold text-slate-300 mb-3 block">Upload New Video</label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="video/*"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                    id="video-upload"
                                />
                                <div
                                    className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer ${isDraggingFile
                                        ? 'border-accent bg-accent/5 shadow-[0_0_20px_rgba(34,197,94,0.2)]'
                                        : selectedFile
                                            ? 'border-slate-600 bg-slate-800/40'
                                            : 'border-slate-700 hover:border-slate-500 bg-slate-800/20'
                                        }`}
                                    onDragOver={e => { e.preventDefault(); setIsDraggingFile(true); }}
                                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingFile(false); }}
                                    onDrop={handleFileDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {selectedFile && previewUrl ? (
                                        <div className="flex items-center gap-4 p-4">
                                            <video
                                                src={previewUrl}
                                                className="w-32 h-20 object-cover rounded-lg border border-slate-600 shrink-0"
                                                muted
                                                onClick={e => e.stopPropagation()}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-white truncate">{selectedFile.name}</p>
                                                <p className="text-xs text-slate-400 mt-1">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                                                <p className="text-xs text-slate-500 mt-2">Click or drag to replace</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center gap-2 py-10">
                                            <span className="text-3xl">{isDraggingFile ? '📥' : '📽️'}</span>
                                            <span className="text-sm font-medium text-slate-300">
                                                {isDraggingFile ? 'Drop to load' : 'Drag video here or click to browse'}
                                            </span>
                                            <span className="text-xs text-slate-500">MP4, MOV, WebM</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Skills Selection */}
                            <div className="mb-6">
                                <label className="text-sm font-semibold text-slate-300 mb-3 block">
                                    Skills/Strokes (select all that apply)
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {SKILL_OPTIONS.map((skill) => (
                                        <button
                                            key={skill.value}
                                            onClick={() => handleSkillToggle(skill.value)}
                                            className={`p-3 rounded-lg text-sm font-medium transition-all text-left ${selectedSkills.includes(skill.value)
                                                ? 'bg-accent/20 border border-accent/50 text-accent'
                                                : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-750'
                                                }`}
                                        >
                                            {skill.label}
                                        </button>
                                    ))}
                                </div>
                                {selectedSkills.length > 0 && (
                                    <div className="mt-2">
                                        <p className="text-xs text-slate-400">
                                            Selected: {selectedSkills.join(', ')}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Phase Timestamps — calibration button */}
                            {(() => {
                                const singleSkill = selectedSkills.length === 1 ? selectedSkills[0] : null;
                                const fields = singleSkill ? PHASE_FIELDS[singleSkill] : null;
                                if (!fields) return null;
                                const markedCount = Object.keys(phaseTimestamps).length;
                                return (
                                    <div className="mb-6">
                                        <button
                                            onClick={() => setShowCalibrator(true)}
                                            disabled={!previewUrl}
                                            className={`w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${!previewUrl
                                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                                : markedCount > 0
                                                    ? 'bg-green-500/15 hover:bg-green-500/25 border border-green-500/50 text-green-400'
                                                    : 'bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/40 text-blue-400'
                                                }`}
                                        >
                                            {markedCount > 0
                                                ? `✅ ${markedCount}/${fields.length} phases calibrated — Edit`
                                                : '🎯 Calibrate Phase Timestamps (optional)'}
                                        </button>
                                        {!previewUrl && (
                                            <p className="text-xs text-slate-600 mt-1.5 text-center">Select a video file first to calibrate phases</p>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Calibrator modal */}
                            {showCalibrator && (() => {
                                const singleSkill = selectedSkills.length === 1 ? selectedSkills[0] : null;
                                const fields = singleSkill ? PHASE_FIELDS[singleSkill] : null;
                                if (!fields) return null;
                                return (
                                    <VideoPhaseCalibrator
                                        videoUrl={previewUrl}
                                        phaseFields={fields}
                                        initialTimestamps={phaseTimestamps}
                                        onSave={ts => { setPhaseTimestamps(ts); setShowCalibrator(false); }}
                                        onClose={() => setShowCalibrator(false)}
                                        title={`${sport.charAt(0).toUpperCase() + sport.slice(1)} — ${selectedSkills[0]}`}
                                    />
                                );
                            })()}

                            {/* Optional Details */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                                <div>
                                    <label className="text-sm font-semibold text-slate-300 mb-2 block">
                                        Custom Title <span className="text-slate-500 font-normal">(optional)</span>
                                    </label>
                                    {/* Compute auto-title for placeholder */}
                                    {(() => {
                                        const sportLabel = 'Tennis';
                                        const autoLabel = selectedSkills.length > 0
                                            ? `${sportLabel} ${SKILL_OPTIONS
                                                .filter(o => selectedSkills.includes(o.value))
                                                .map(o => o.label.replace(/^[^\s]+ /, ''))
                                                .join(' + ')}`
                                            : `${sportLabel} video`;
                                        return (
                                            <>
                                                <input
                                                    type="text"
                                                    value={customTitle}
                                                    onChange={(e) => setCustomTitle(e.target.value)}
                                                    placeholder={`Auto: "${autoLabel}"`}
                                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                                                />
                                                {!customTitle && (
                                                    <p className="text-xs text-slate-600 mt-1">
                                                        Will save as: <span className="text-slate-400">{autoLabel}</span>
                                                    </p>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                                <div>
                                    <label className="text-sm font-semibold text-slate-300 mb-2 block">
                                        Description (optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="Professional demonstration video"
                                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                                    />
                                </div>
                            </div>

                            {/* Upload Button */}
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={handleUpload}
                                    disabled={!selectedFile || selectedSkills.length === 0 || isUploading}
                                    className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent mr-2" />
                                            Uploading...
                                        </>
                                    ) : (
                                        '⬆️ Upload Reference Video'
                                    )}
                                </button>

                                {/* Status Messages */}
                                {uploadResult && (
                                    <div
                                        className={`p-3 rounded-lg text-sm ${uploadResult.type === 'success'
                                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                                            : 'bg-red-500/10 border border-red-500/30 text-red-400'
                                            }`}
                                    >
                                        {uploadResult.message}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="bg-blue-500/20 p-3 rounded-lg">
                                    <span className="text-2xl">📊</span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">Report Customization</h2>
                                    <p className="text-sm text-slate-400">Configure how student analysis reports look and feel</p>
                                </div>
                            </div>
                            <ReportSettings />
                        </div>
                    )}
                </div>
            </div>

            {activeTab === 'videos' && (
                <>
                    {/* Instructions */}
                    <div className="card bg-slate-900/30">
                        <h3 className="text-lg font-semibold text-white mb-3">📋 Upload Guidelines</h3>
                        <div className="text-sm text-slate-400 space-y-2">
                            <p>• <strong>Video Quality:</strong> High resolution recommended, format: MP4, MOV, or WebM</p>
                            <p>• <strong>Duration:</strong> 10-60 seconds works best for analysis</p>
                            <p>• <strong>Angle:</strong> Side view preferred for stroke analysis</p>
                            <p>• <strong>Lighting:</strong> Good lighting helps with pose detection</p>
                            <p>• <strong>Background:</strong> Plain backgrounds work better than busy ones</p>
                            <p>• <strong>Tags:</strong> Videos are automatically tagged with sport + selected skills + "pro"</p>
                            <p>• <strong>Library:</strong> Uploaded videos immediately appear in the Reference Library for users to select</p>
                        </div>
                    </div>

                    {/* Supabase Setup Guide */}
                    <div className="card bg-blue-900/20 border border-blue-500/20">
                        <h3 className="text-lg font-semibold text-blue-300 mb-3">⚙️ Supabase Storage Setup</h3>
                        <div className="text-sm text-slate-300 space-y-3">
                            <p className="text-blue-200"><strong>If uploads are failing:</strong></p>
                            <ol className="space-y-2 list-decimal list-inside text-slate-400">
                                <li><strong>Check browser console</strong> (F12) for detailed error messages — they appear as <code className="bg-slate-800 px-1 rounded text-blue-300">[ReferenceVideoService]</code> logs</li>
                                <li>Verify the <code className="bg-slate-800 px-2 py-1 rounded text-blue-300">videos</code> bucket exists in Supabase Storage</li>
                                <li>Make sure the bucket is set to <strong>PUBLIC</strong></li>
                                <li>If errors mention <code className="bg-slate-800 px-1 rounded text-blue-300">reference_videos</code> table, you may need to create it in your database</li>
                                <li>Videos upload to storage even if DB insert fails (graceful fallback)</li>
                            </ol>
                        </div>
                    </div>

                    <div className="card bg-purple-900/20 border border-purple-500/20">
                        <h3 className="text-lg font-semibold text-purple-300 mb-3">🗄️ Optional: Create DB Table</h3>
                        <div className="text-sm text-slate-300">
                            <p className="mb-2">If you want richer metadata storage, create this table in Supabase SQL Editor:</p>
                            <code className="block bg-slate-800 p-3 rounded text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
                                {`CREATE TABLE reference_videos (
  id bigserial PRIMARY KEY,
  title text,
  description text,
  url text,
  uploaded_by text,
  uploaded_at timestamp,
  tags text[],
  phase_timestamps jsonb,
  created_at timestamp default now()
);

ALTER TABLE reference_videos 
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read" ON reference_videos
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert" ON reference_videos
  FOR INSERT WITH CHECK (true);`}
                            </code>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};