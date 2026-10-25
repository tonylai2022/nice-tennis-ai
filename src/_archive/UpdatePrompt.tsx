import { useState, useEffect } from 'react';
import { RefreshCw, X, Sparkles } from 'lucide-react';
import { swManager } from '../services/serviceWorkerManager';

export function UpdatePrompt() {
    const [showUpdate, setShowUpdate] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        // Subscribe to service worker update events
        const unsubscribe = swManager.subscribe(() => {
            setShowUpdate(true);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const handleUpdate = () => {
        setIsUpdating(true);
        swManager.applyUpdate();
    };

    const handleDismiss = () => {
        setShowUpdate(false);
    };

    if (!showUpdate) return null;

    return (
        <aside
            role="alert"
            aria-live="polite"
            className="fixed top-4 left-4 right-4 z-[99998] mx-auto max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-4 text-slate-50 shadow-2xl shadow-black/60 backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-4 duration-300"
            style={{
                marginTop: 'env(safe-area-inset-top, 0px)',
            }}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                        <Sparkles size={22} className="animate-pulse" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold tracking-wide text-white">
                            Update Available / 新版本就绪
                        </h4>
                        <p className="mt-0.5 text-xs text-slate-300">
                            A fresh version of Nice Tennis is available. Update now to get the latest coaching improvements.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleDismiss}
                    className="touch-target -mr-1 -mt-1 p-1 text-slate-400 hover:text-white transition-colors"
                    aria-label="Dismiss update notification"
                >
                    <X size={18} />
                </button>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                    Later / 稍后
                </button>
                <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className="btn btn-primary inline-flex items-center gap-2 !px-4 !py-1.5 !text-xs font-semibold shadow-lg shadow-emerald-500/20"
                >
                    <RefreshCw size={14} className={isUpdating ? 'animate-spin' : ''} />
                    {isUpdating ? 'Updating...' : 'Update Now / 立即更新'}
                </button>
            </div>
        </aside>
    );
}
