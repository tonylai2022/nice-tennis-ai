import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { VideoTutorService } from './services/VideoTutor';
import { PhaseCalibration } from './components/PhaseCalibration';
import { ReportSettings } from './components/ReportSettings';

import { CalibrationService, StrokeType } from './services/CalibrationService';
import { MotionAnalysisService } from './services/MotionAnalysisRouter';

import type { Step, CompareMode, SkillType, TrimRange } from './types/app';
import { useAppRouting } from './hooks/useAppRouting';
import { useVideoSession } from './hooks/useVideoSession';
import { useAnalysisState } from './hooks/useAnalysisState';
import { usePoseProcessing } from './hooks/usePoseProcessing';
import { useVideoExport } from './hooks/useVideoExport';

import { Progress } from './components/Progress';
import { FeedbackPanel } from './components/FeedbackPanel';
import { AppHeader } from './components/AppHeader';
import { AdminPanel } from './components/AdminPanel';
import { ReferenceStep } from './components/ReferenceStep';
import { CompareStep } from './components/CompareStep';
import { LiveCoachingTennis } from './components/LiveCoachingTennis';
import { CoachCRMHome } from './components/CoachCRMHome';
import { NotFoundPage } from './components/NotFoundPage';
import { coachCRMService, type CRMProfile } from './services/CoachCRMService';

// SkillType and TrimRange are imported from src/types/app.ts

export default function App() {
  const pathname = (window.location.pathname.replace(/\/+$/, '') || '/').toLowerCase();

  if (pathname === '/tennis') {
    return <LegacyTennisRedirect />;
  }

  if (!isKnownPath(pathname)) {
    return <NotFoundPage />;
  }

  if (pathname !== '/' && pathname !== '/login') {
    return <RequireAuthentication><TennisApplication /></RequireAuthentication>;
  }

  return <TennisApplication />;
}

const KNOWN_PATHS = new Set([
  '/',
  '/login',
  '/dashboard',
  '/dashboard/schedule',
  '/dashboard/students',
  '/dashboard/students/overview',
  '/dashboard/feedback',
  '/dashboard/log',
  '/dashboard/homework',
  '/dashboard/assessments',
  '/dashboard/about',
  '/analysis',
  '/analysis/compare',
  '/analysis/feedback',
  '/live-coaching',
  '/library',
  '/settings',
]);

function isKnownPath(pathname: string) {
  return KNOWN_PATHS.has(pathname);
}

function RequireAuthentication({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'redirecting'>('checking');

  useEffect(() => {
    let active = true;

    if (!coachCRMService.isConfigured()) {
      setStatus('redirecting');
      window.location.replace('/login');
      return;
    }

    const unsubscribe = coachCRMService.onAuthStateChange((session) => {
      if (!active) return;
      if (session) setStatus('authenticated');
      else {
        setStatus('redirecting');
        window.location.replace('/login');
      }
    });

    const verifySession = async () => {
      try {
        const session = await coachCRMService.getSession();
        if (!active) return;
        if (session) setStatus('authenticated');
        else {
          setStatus('redirecting');
          window.location.replace('/login');
        }
      } catch {
        if (!active) return;
        setStatus('redirecting');
        window.location.replace('/login');
      }
    };

    void verifySession();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (status === 'authenticated') return <>{children}</>;

  return (
    <main className="auth-gate" aria-label={status === 'checking' ? 'Checking session' : 'Opening sign in'}>
      <span className="crm-loader" />
      <p>{status === 'checking' ? 'Checking your session' : 'Opening sign in'}</p>
    </main>
  );
}

function LegacyTennisRedirect() {
  useEffect(() => {
    window.location.replace(`/${window.location.search}${window.location.hash}`);
  }, []);

  return null;
}

function TennisApplication() {
  // ── Routing & Navigation ───────────────────────────────────────────────────
  const {
    pathname,
    sport,
    step, setStep,
    motionType, setMotionType,
    showSettings, setShowSettings,
    activeSport,
    navigate,
    resetNavState,
  } = useAppRouting();

  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [crmAccount, setCrmAccount] = useState<CRMProfile | null>(null);
  const [language, setLanguage] = useState<'en' | 'zh'>(() => localStorage.getItem('motionTutor.language') === 'zh' ? 'zh' : 'en');

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const toggleLanguage = () => {
    setLanguage((current) => {
      const next = current === 'en' ? 'zh' : 'en';
      localStorage.setItem('motionTutor.language', next);
      return next;
    });
  };

  const handleCrmAccountChange = useCallback((account: CRMProfile | null) => {
    setCrmAccount(account);
    if (account && pathname === '/login') navigate('/dashboard', true);
    if (!account && pathname.startsWith('/dashboard')) navigate('/login', true);
  }, [navigate, pathname]);

  // ── Video Session ──────────────────────────────────────────────────────────
  const {
    referenceFile,
    userFile,
    referenceUrl,
    userUrl,
    referenceDuration, setReferenceDuration,
    userDuration, setUserDuration,
    referenceTrim, setReferenceTrim,
    userTrim, setUserTrim,
    refVideoRef, userVideoRef,
    refMethod, setRefMethod,
    recordingTarget, setRecordingTarget,
    referencePhaseTimestamps,
    handleReferenceSelect,
    handleReferenceLibrarySelect,
    handleReferenceDelete: handleReferenceDeleteFromHook,
    handleUserSelect: handleUserSelectFromHook,
    resetVideoSession,
  } = useVideoSession(step);

  // ── Comparison & playback state ────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState<CompareMode>('split');
  const [overlayOpacity, setOverlayOpacity] = useState(0.45);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [exportLang, setExportLang] = useState<'en' | 'zhSimp' | 'zhTrad'>('en');
  const [autoDownload, setAutoDownload] = useState(false);
  const [reportMode, setReportMode] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [userManualPhaseTimestamps, setUserManualPhaseTimestamps] = useState<Record<string, number> | null>(null);
  const [calibrationVideoUrl, setCalibrationVideoUrl] = useState<string | null>(null);
  const [calibrationVideoName, setCalibrationVideoName] = useState<string>('reference');
  const [calibrationIsUserVideo, setCalibrationIsUserVideo] = useState(false);
  const [calibrationVideoId, setCalibrationVideoId] = useState<string | null>(null);
  const [calibrationStrokeType, setCalibrationStrokeType] = useState<StrokeType>('forehand');
  const [adminSubView, setAdminSubView] = useState<'main' | 'training'>('main');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  // ── Auto-export (skip compare page, download directly) ─────────────────────
  const { isExporting: isAutoExporting, progress: exportProgress, triggerExport: triggerAutoExport } = useVideoExport();
  const autoExportFiredRef = React.useRef(false);

  // ── Analysis State ─────────────────────────────────────────────────────────
  const {
    isAnalyzing,
    feedback, setFeedback,
    capturedFrames, setCapturedFrames,
    phaseSyncEnabled, setPhaseSyncEnabled,
    userPhaseTimestamps,
    refPhaseTimestamps,
    isAnalyzingPhases,
    analyzeMotion,
    analyzeMotionFree,
    freeFeedback,
    clearFreeFeedback,
    captureVideoFrames,
    resetAnalysisState,
  } = useAnalysisState({
    referenceUrl,
    userUrl,
    userFile,
    motionType,
    referenceDuration,
    userDuration,
    referenceTrim,
    userTrim,
    referencePhaseTimestamps,
    userManualPhaseTimestamps,
    onAnalysisComplete: () => setStep('feedback'),
    userVideoRef,
  });

  useEffect(() => {
    // Warm up the AI model on load so analysis is faster and respects user gesture
    VideoTutorService.warmup();
  }, []);

  useEffect(() => {
    // On startup, pull latest calibration from Supabase so admin-calibrated frames
    // survive a page refresh (localStorage is cleared in private browsing, etc.).
    CalibrationService.loadFromCloud().then(result => {
      if (result.ok && result.imported && result.imported > 0) {
        console.log(`[App] Synced ${result.imported} calibration example(s) from cloud on startup`);
      }
    }).catch(() => { /* Supabase may not be configured — silent */ });
  }, []);

  // Admin access via ?admin=true URL param (works on any page)
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('admin') === 'true') {
      setStep('admin');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Optional runtime tuning via query params:
    // - `timeout`: max analysis seconds (e.g. 180)
    // - `fps`: YOLO desktop FPS (e.g. 10 or 15)
    try {
      const qs = new URLSearchParams(window.location.search);
      const timeout = Number(qs.get('timeout'));
      const fps = Number(qs.get('fps'));

      const options: any = {};
      if (Number.isFinite(timeout) && timeout > 0) options.maxAnalysisSeconds = Math.round(timeout);
      if (Number.isFinite(fps) && fps > 0) options.yoloDesktopFps = Math.round(fps);

      if (Object.keys(options).length) {
        MotionAnalysisService.setAnalysisOptions(options);
        console.log('[MotionAnalysis] Applied URL analysis options', options);
      }
    } catch {
      // ignore
    }
  }, []);

  // Wrap handleReferenceDelete to also navigate away if needed
  const handleReferenceDelete = (deletedVideoUrl: string) => {
    handleReferenceDeleteFromHook(deletedVideoUrl, () => {
      if (step !== 'welcome' && step !== 'admin') setStep('reference');
    });
  };

  // Wrap handleUserSelect to also advance the step
  const handleUserSelect = (file: File) => {
    setUserManualPhaseTimestamps(null);
    setUploadError(null);

    const meta = `${file.name} | ${(file.size / 1024).toFixed(0)} KB | ${file.type || '(no type)'}`;
    console.debug('[upload] file selected:', meta);

    const tempVid = document.createElement('video');
    tempVid.preload = 'metadata';
    let tempUrl: string;
    try {
      tempUrl = URL.createObjectURL(file);
    } catch (err) {
      console.error('[upload] createObjectURL failed:', err);
      setUploadError(`Could not read video file. (${meta})`);
      return;
    }

    const cleanup = () => { try { URL.revokeObjectURL(tempUrl); } catch { /* ignore */ } };

    const accept = () => {
      cleanup();
      console.debug('[upload] accepted, calling hook');
      handleUserSelectFromHook(file, () => setStep('reference'));
    };

    tempVid.onloadedmetadata = () => {
      const dur = tempVid.duration;
      console.debug(`[upload] loadedmetadata duration=${dur?.toFixed(2)}s`);
      accept();
    };

    tempVid.onerror = (e) => {
      // Common on iOS with HEVC/MOV — the hidden video can't decode but the
      // real <video> element in the page usually can. Accept and let it try.
      console.warn('[upload] tempVid onerror (likely HEVC/iOS) — accepting anyway:', e, meta);
      accept();
    };

    // Fallback: if neither event fires within 4 s (seen on some Android), accept the file.
    const fallbackTimer = window.setTimeout(() => {
      console.warn('[upload] metadata timeout (4 s) — accepting anyway:', meta);
      accept();
    }, 4000);

    const origAccept = accept;
    // clear the timer once either path fires
    tempVid.onloadedmetadata = () => {
      window.clearTimeout(fallbackTimer);
      const dur = tempVid.duration;
      console.debug(`[upload] loadedmetadata duration=${dur?.toFixed(2)}s`);
      origAccept();
    };
    tempVid.onerror = (e) => {
      window.clearTimeout(fallbackTimer);
      console.warn('[upload] tempVid onerror — accepting anyway:', e, meta);
      origAccept();
    };

    tempVid.src = tempUrl;
  };

  const togglePlayback = () => {
    const refVideo = refVideoRef.current;
    const userVideo = userVideoRef.current;

    if (!refVideo || !userVideo) return;

    if (isPlaying) {
      refVideo.pause();
      userVideo.pause();
    } else {
      // On iOS Safari, play() can fail if the video hasn't buffered or is still
      // seeking. Catch the error and retry once after a short delay.
      const tryPlay = (v: HTMLVideoElement) => {
        v.play().catch(() => {
          setTimeout(() => v.play().catch(() => { }), 300);
        });
      };
      tryPlay(refVideo);
      tryPlay(userVideo);
    }
    setIsPlaying(!isPlaying);
  };

  const replay = () => {
    if (refVideoRef.current) {
      refVideoRef.current.currentTime = 0;
      if (isPlaying) refVideoRef.current.play();
    }
    if (userVideoRef.current) {
      userVideoRef.current.currentTime = 0;
      if (isPlaying) userVideoRef.current.play();
    }
  };

  // syncRefToUser is a cross-concern: it reads analysis state AND drives a video ref
  const syncRefToUser = useCallback((userTime: number) => {
    if (!phaseSyncEnabled || !userPhaseTimestamps || !refPhaseTimestamps || !refVideoRef.current) {
      return;
    }
    let phaseIdx = 0;
    for (let i = 0; i < userPhaseTimestamps.length - 1; i++) {
      if (userTime >= userPhaseTimestamps[i]) phaseIdx = i;
    }
    const phaseStart = userPhaseTimestamps[phaseIdx] || 0;
    const phaseEnd = userPhaseTimestamps[phaseIdx + 1] || userPhaseTimestamps[phaseIdx] || 1;
    const phaseDuration = phaseEnd - phaseStart || 1;
    const progress = Math.max(0, Math.min(1, (userTime - phaseStart) / phaseDuration));
    const refStart = refPhaseTimestamps[phaseIdx] || 0;
    const refEnd = refPhaseTimestamps[phaseIdx + 1] || refPhaseTimestamps[phaseIdx] || 1;
    const refTime = refStart + progress * (refEnd - refStart);
    if (Math.abs(refVideoRef.current.currentTime - refTime) > 0.05) {
      refVideoRef.current.currentTime = refTime;
    }
  }, [phaseSyncEnabled, userPhaseTimestamps, refPhaseTimestamps]);

  // Listen for user video time updates (overlay phase sync)
  useEffect(() => {
    const userVideo = userVideoRef.current;
    if (!userVideo || compareMode !== 'overlay' || !phaseSyncEnabled) return;
    const handleTimeUpdate = () => syncRefToUser(userVideo.currentTime);
    userVideo.addEventListener('timeupdate', handleTimeUpdate);
    return () => userVideo.removeEventListener('timeupdate', handleTimeUpdate);
  }, [compareMode, phaseSyncEnabled, syncRefToUser]);

  const reset = () => {
    resetVideoSession();
    resetAnalysisState();
    resetNavState();
    setIsPlaying(false);
    setCompareMode('split');
    setOverlayOpacity(0.45);
    setUserManualPhaseTimestamps(null);
  };



  const openCalibration = ({ strokeType }: { strokeType: StrokeType }) => {
    setCalibrationStrokeType(strokeType);
    setCalibrationVideoUrl(null);
    setCalibrationVideoName('reference');
    setCalibrationIsUserVideo(false);
    setCalibrationVideoId(null);
    setShowCalibration(true);
  };

  // Reset training sub-view when navigating away from admin
  useEffect(() => {
    if (step !== 'admin') {
      setAdminSubView('main');
      setAdminUnlocked(false);
      setAdminPin('');
    }
  }, [step]);

  // ── Pose Pre-Processing (background) ───────────────────────────────────────
  // Start as soon as URLs are available (reference step onwards) so pose is
  // done — or nearly done — by the time user hits Compare. Previously this
  // only started on the compare step, causing the loading screen to be long.
  const { refPoseFrames, userPoseFrames, isProcessingPose, poseProgress } = usePoseProcessing(
    referenceUrl,
    userUrl,
  );

  const canAnalyze = useMemo(() => Boolean(referenceUrl && userUrl), [referenceUrl, userUrl]);

  // Auto-trigger free analysis once pose processing is done — no user action needed.
  const hasAutoAnalyzedRef = React.useRef(false);

  // Fire auto-export once feedback is ready (skip compare page entirely)
  useEffect(() => {
    if (
      step === 'compare' &&
      autoDownload &&
      freeFeedback &&
      referenceUrl && userUrl &&
      !isAutoExporting &&
      !autoExportFiredRef.current
    ) {
      autoExportFiredRef.current = true;
      setAutoDownload(false); // clear flag so we won't re-trigger on re-render
      triggerAutoExport(
        {
          refVideoUrl: referenceUrl,
          userVideoUrl: userUrl,
          refPoseFrames: refPoseFrames ?? null,
          userPoseFrames: userPoseFrames ?? null,
          referenceTrim,
          userTrim,
          referenceDuration,
          userDuration,
          feedback: freeFeedback,
          motionType,
          sport,
          showSkeleton,
          lang: exportLang,
        },
        `${motionType}-comparison.mp4`,
      ).finally(() => {
        autoExportFiredRef.current = false;
        setStep('reference');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, autoDownload, freeFeedback, isAutoExporting, referenceUrl, userUrl]);

  // Reset guard when leaving compare step
  useEffect(() => {
    if (step !== 'compare') autoExportFiredRef.current = false;
  }, [step]);
  // Auto-navigate to feedback step when in report mode and analysis is done
  useEffect(() => {
    if (reportMode && freeFeedback && step === 'compare' && !isProcessingPose && !isAnalyzing) {
      setReportMode(false);
      setStep('feedback');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportMode, freeFeedback, step, isProcessingPose, isAnalyzing]);
  useEffect(() => {
    if (step !== 'compare') {
      hasAutoAnalyzedRef.current = false;
      // When navigating to the feedback page we must KEEP freeFeedback — the panel needs it.
      // For every other departure (back to reference, reset, etc.) clear stale data.
      if (step !== 'feedback') {
        clearFreeFeedback();
      }
      return;
    }
    // Entering compare: if freeFeedback is still set from a previous feedback-page visit
    // (retake flow), clear it first so analysis runs fresh.
    if (!hasAutoAnalyzedRef.current && freeFeedback && !isProcessingPose && !isAnalyzing) {
      clearFreeFeedback();
      return; // effect will re-run once freeFeedback is null
    }
    // Fire as soon as pose is done (null → array), even if results are empty.
    // Guarding on length > 0 caused a permanent stuck state when pose returned []
    // (e.g. after a background tab-switch interrupts the WASM worker).
    // analyzeMotionFree handles empty arrays gracefully via its fallback path.
    if (
      !isProcessingPose &&
      refPoseFrames !== null &&
      userPoseFrames !== null &&
      !isAnalyzing && !freeFeedback &&
      !hasAutoAnalyzedRef.current
    ) {
      hasAutoAnalyzedRef.current = true;
      analyzeMotionFree(userPoseFrames, refPoseFrames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, refPoseFrames, userPoseFrames, isAnalyzing, freeFeedback, isProcessingPose]);

  // Re-trigger analysis when returning from a background tab.
  // On mobile, switching tabs suspends JS/WASM. When the user comes back the
  // analysis may have silently failed (empty results) so hasAutoAnalyzedRef is
  // still false and the loading screen stays forever. visibilitychange fires
  // when the tab becomes active again so we can kick off a retry.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (step !== 'compare' || freeFeedback || isAnalyzing || isProcessingPose) return;
      if (refPoseFrames !== null && userPoseFrames !== null && !hasAutoAnalyzedRef.current) {
        hasAutoAnalyzedRef.current = true;
        analyzeMotionFree(userPoseFrames, refPoseFrames);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, freeFeedback, isAnalyzing, isProcessingPose, refPoseFrames, userPoseFrames]);

  // Hard-escape for the loading screen: if we've been stuck for 20s show a
  // "Skip" button; after 60s auto-advance (generates generic feedback).
  const [loadingStuckSecs, setLoadingStuckSecs] = React.useState(0);
  const loadingStuckRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnLoadingScreen = step === 'compare' && (isProcessingPose || isAnalyzing || !freeFeedback);
  useEffect(() => {
    if (!isOnLoadingScreen) {
      setLoadingStuckSecs(0);
      if (loadingStuckRef.current) { clearInterval(loadingStuckRef.current); loadingStuckRef.current = null; }
      return;
    }
    loadingStuckRef.current = setInterval(() => {
      setLoadingStuckSecs(s => s + 1);
    }, 1000);
    return () => { if (loadingStuckRef.current) clearInterval(loadingStuckRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnLoadingScreen]);
  // Auto-escape after 60s or when user presses Skip
  useEffect(() => {
    if (!isOnLoadingScreen) return;
    if (loadingStuckSecs >= 60 && !isAnalyzing && !hasAutoAnalyzedRef.current) {
      hasAutoAnalyzedRef.current = true;
      analyzeMotionFree(userPoseFrames ?? [], refPoseFrames ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingStuckSecs, isOnLoadingScreen]);

  // captureVideoFrames is provided by useAnalysisState hook

  // Render settings modal if showSettings is true
  if (showSettings) {
    return <ReportSettings onClose={() => navigate('/dashboard')} />;
  }

  if (pathname === '/live-coaching') {
    return <LiveCoachingTennis onClose={() => navigate('/dashboard')} />;
  }

  const isCoachWorkspace = step === 'welcome';

  return (
    <div className={`app-shell text-slate-50${isCoachWorkspace ? ' app-shell-coach' : ''}`}>
      {!isCoachWorkspace && <AppHeader
        activeSport={activeSport}
        step={step}
        setStep={setStep}
        account={crmAccount}
        onStartAnalysis={() => setStep('reference')}
        onOpenAdmin={() => setStep('admin')}
        language={language}
        onToggleLanguage={toggleLanguage}
      />}

      <main className={`app-workspace${isCoachWorkspace ? ' app-workspace-coach' : ''}`}>
        {step === 'admin' && <Progress step={step} />}

        {step === 'welcome' && (
          <CoachCRMHome
            onStartAnalysis={() => { setMotionType('forehand'); setStep('reference'); }}
            onLiveCoaching={() => navigate('/live-coaching')}
            onAccountChange={handleCrmAccountChange}
            language={language}
            onToggleLanguage={toggleLanguage}
          />
        )}

        {step === 'admin' && (
          !adminUnlocked ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
              <h2 className="text-xl font-bold text-slate-200">Admin Access</h2>
              <form
                className="flex flex-col items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (adminPin === '0379') {
                    setAdminUnlocked(true);
                    setAdminPin('');
                  } else {
                    setAdminPin('');
                  }
                }}
              >
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Enter PIN"
                  className="w-36 text-center text-2xl tracking-[0.4em] rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
                <button type="submit" className="btn btn-primary w-36 !py-2.5">Unlock</button>
                <button type="button" className="text-xs text-slate-500 hover:text-slate-300" onClick={() => { setStep('welcome'); setAdminPin(''); }}>Cancel</button>
              </form>
            </div>
          ) : (
            <AdminPanel
              adminSubView={adminSubView}
              setAdminSubView={setAdminSubView}
              adminRefreshKey={adminRefreshKey}
              setAdminRefreshKey={setAdminRefreshKey}
              onBack={() => { setStep('welcome'); setAdminUnlocked(false); }}
              onOpenCalibration={openCalibration}
            />
          )
        )}

        {step === 'reference' && (
          <ReferenceStep
            refMethod={refMethod}
            setRefMethod={setRefMethod}
            motionType={motionType}
            sport={sport}
            referenceUrl={referenceUrl}
            userUrl={userUrl}
            userDuration={userDuration}
            setUserDuration={setUserDuration}
            userTrim={userTrim}
            setUserTrim={setUserTrim}
            userVideoRef={userVideoRef}
            recordingTarget={recordingTarget}
            setRecordingTarget={setRecordingTarget}
            handleReferenceLibrarySelect={handleReferenceLibrarySelect}
            handleReferenceSelect={handleReferenceSelect}
            handleReferenceDelete={handleReferenceDelete}
            handleUserSelect={handleUserSelect}
            uploadError={uploadError}
            onBack={() => setStep('welcome')}
            onContinue={() => setStep('compare')}
            userManualPhaseTimestamps={userManualPhaseTimestamps}
            onManualCalibrationSave={setUserManualPhaseTimestamps}
            showSkeleton={showSkeleton}
            onSkeletonToggle={setShowSkeleton}
            exportLang={exportLang}
            onExportLangChange={setExportLang}
          />
        )}

        {step === 'compare' && (isProcessingPose || isAnalyzing || !freeFeedback || isAutoExporting) && (
          (() => {
            const displayPct = isAutoExporting
              ? Math.round(exportProgress)
              : isProcessingPose
                ? Math.round(poseProgress * 0.65)
                : isAnalyzing
                  ? 80
                  : 100;
            const label = isAutoExporting
              ? 'Preparing your video…'
              : isProcessingPose
                ? 'Analysing your swing…'
                : 'Generating feedback…';
            const canSkip = !isAutoExporting && loadingStuckSecs >= 20 && !isAnalyzing;
            const handleSkip = () => {
              if (!hasAutoAnalyzedRef.current) {
                hasAutoAnalyzedRef.current = true;
                analyzeMotionFree(userPoseFrames ?? [], refPoseFrames ?? []);
              }
            };
            return (
              <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-6">
                <img
                  src="/images/NT_logo.png"
                  alt="logo"
                  className="h-20 w-auto opacity-90"
                />
                <p className="text-slate-300 text-sm tracking-widest uppercase">{label}</p>
                <div className="w-56 bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full bg-accent rounded-full transition-all duration-500${isAnalyzing && !isAutoExporting ? ' animate-pulse' : ''}`}
                    style={{ width: `${displayPct}%` }}
                  />
                </div>
                <p className="text-accent font-bold text-2xl tabular-nums">{displayPct}%</p>
                {canSkip && (
                  <button
                    onClick={handleSkip}
                    className="mt-2 px-5 py-2 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
                  >
                    Taking too long? Skip →
                  </button>
                )}
              </div>
            );
          })()
        )}

        {step === 'compare' && !isProcessingPose && !isAnalyzing && freeFeedback && !isAutoExporting && !autoDownload && (
          <CompareStep
            sport={sport}
            motionType={motionType}
            referenceUrl={referenceUrl}
            userUrl={userUrl}
            referenceDuration={referenceDuration}
            referenceTrim={referenceTrim}
            userDuration={userDuration}
            userTrim={userTrim}
            refVideoRef={refVideoRef}
            userVideoRef={userVideoRef}
            isPlaying={isPlaying}
            onTogglePlayback={togglePlayback}
            onReplay={replay}
            canAnalyze={canAnalyze}
            isAnalyzing={isAnalyzing}
            onAnalyze={() => analyzeMotionFree(userPoseFrames ?? [], refPoseFrames ?? [])}
            onBack={() => setStep('reference')}
            onReport={() => { setReportMode(true); setStep('compare'); }}
            refPoseFrames={refPoseFrames}
            userPoseFrames={userPoseFrames}
            isProcessingPose={isProcessingPose}
            showSkeleton={showSkeleton}
            onSkeletonToggle={setShowSkeleton}
            freeFeedback={freeFeedback ?? null}
            exportLang={exportLang}
          />
        )}

        {step === 'feedback' && (feedback || freeFeedback) && (
          <FeedbackPanel
            feedback={feedback}
            freeFeedback={freeFeedback ?? undefined}
            freeMode={true}
            userVideoUrl={userUrl}
            refVideoUrl={referenceUrl}
            onRetake={() => setStep('compare')}
            onReset={reset}
            sport={sport}
            motionType={motionType}
            showReport={showReport}
            capturedFrames={capturedFrames}
            onShowReport={async () => {
              // Capture frames before showing report
              const frames = await captureVideoFrames();
              if (frames.length > 0) {
                setCapturedFrames(frames);
              }
              setShowReport(true);
            }}
            onHideReport={() => setShowReport(false)}
            refPoseFrames={refPoseFrames}
            userPoseFrames={userPoseFrames}
            referenceTrim={referenceTrim}
            userTrim={userTrim}
            referenceDuration={referenceDuration}
            userDuration={userDuration}
            showSkeleton={showSkeleton}
            exportLang={exportLang}
          />
        )}
      </main>

      {/* Phase Calibration Modal */}
      {showCalibration && (
        <PhaseCalibration
          videoUrl={calibrationVideoUrl}
          strokeType={calibrationStrokeType}
          videoName={calibrationVideoName}
          isUserVideo={calibrationIsUserVideo}
          videoId={calibrationVideoId || undefined}
          onClose={() => { setShowCalibration(false); setAdminRefreshKey(k => k + 1); }}
          onCalibrationComplete={() => setAdminRefreshKey(k => k + 1)}
        />
      )}


    </div>
  );
}
