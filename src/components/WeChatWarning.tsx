import { useState } from 'react';
import { Compass, Copy, Check, ExternalLink, CornerUpRight, Smartphone, Apple } from 'lucide-react';

/**
 * Checks whether the current browser user-agent is WeChat (MicroMessenger).
 */
export const isWeChat = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /MicroMessenger/i.test(navigator.userAgent);
};

/**
 * Detects iOS devices (iPhone, iPad, iPod).
 */
export const isIOS = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
};

export function WeChatWarning() {
    const [copied, setCopied] = useState(false);
    const inWeChat = isWeChat();
    const ios = isIOS();

    if (!inWeChat) return null;

    const copyUrl = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // Fallback for older webviews
            const textarea = document.createElement('textarea');
            textarea.value = window.location.href;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[999999] flex flex-col justify-between overflow-y-auto bg-slate-950/98 text-slate-100 p-6 backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Open in external browser"
        >
            {/* Top-Right Pointer Visual Guidance to WeChat's "..." Button */}
            <div className="flex flex-col items-end pr-2 pt-1 animate-bounce">
                <div className="flex items-center gap-2 rounded-full border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-emerald-300 shadow-lg shadow-emerald-500/20">
                    <span className="text-sm font-bold tracking-wide">
                        Tap <span className="rounded bg-emerald-500/30 px-1.5 py-0.5 font-mono text-base font-extrabold text-white">...</span> in top-right
                    </span>
                    <CornerUpRight size={20} className="stroke-[2.5]" />
                </div>
                <span className="mt-1 text-xs text-emerald-400/80 pr-2 font-medium">
                    点击右上角三个点
                </span>
            </div>

            {/* Main Visual Content */}
            <div className="my-auto mx-auto w-full max-w-md py-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-md">
                    {/* Header with App Title */}
                    <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/30">
                            NT
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white tracking-tight">Nice Tennis</h2>
                            <p className="text-xs text-slate-400">Tennis Motion Analysis</p>
                        </div>
                    </div>

                    {/* Warning message */}
                    <div className="mt-5">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400 border border-amber-500/30">
                            <Compass size={14} /> WeChat Webview Detected
                        </div>
                        <h3 className="mt-3 text-xl font-bold text-white leading-snug">
                            Please Open in External Browser
                        </h3>
                        <p className="mt-1 text-sm font-medium text-slate-300">
                            请在系统默认浏览器中打开
                        </p>
                        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                            WeChat's in-app browser does not support full PWA installation, home screen launcher, or high-performance camera motion analysis.
                        </p>
                    </div>

                    {/* Step-by-Step Instructions */}
                    <div className="mt-6 space-y-3">
                        <div className="flex items-start gap-3.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 font-bold text-emerald-400 text-xs">
                                1
                            </div>
                            <div className="text-xs leading-relaxed text-slate-200">
                                <span className="font-semibold text-white">Tap the three dots</span> in the top-right corner of WeChat.
                                <div className="text-[11px] text-slate-400 mt-0.5">点击右上角菜单按钮 <strong className="text-emerald-400">【···】</strong></div>
                            </div>
                        </div>

                        {/* OS Specific Instruction: iOS vs Android */}
                        <div className="flex items-start gap-3.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500 font-bold text-slate-950 text-xs">
                                2
                            </div>
                            <div className="text-xs leading-relaxed text-slate-200">
                                {ios ? (
                                    <>
                                        <div className="flex items-center gap-1.5 font-semibold text-white">
                                            <Apple size={14} className="text-slate-200" /> Select <span className="underline decoration-emerald-400 font-bold text-emerald-300">"Open in Safari"</span>
                                        </div>
                                        <div className="text-[11px] text-slate-300 mt-0.5">
                                            在弹出菜单中选择 <strong className="text-emerald-400">“在 Safari 中打开”</strong>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-1.5 font-semibold text-white">
                                            <Smartphone size={14} className="text-slate-200" /> Select <span className="underline decoration-emerald-400 font-bold text-emerald-300">"Open in Browser"</span>
                                        </div>
                                        <div className="text-[11px] text-slate-300 mt-0.5">
                                            在弹出菜单中选择 <strong className="text-emerald-400">“在浏览器打开”</strong> (Chrome / 系统浏览器)
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Both options reminder */}
                        <div className="flex items-center justify-between px-2 text-[11px] text-slate-500">
                            <span>iOS: "Open in Safari"</span>
                            <span>•</span>
                            <span>Android: "Open in Browser"</span>
                        </div>
                    </div>

                    {/* Copy Link Option as Convenience */}
                    <div className="mt-6 pt-4 border-t border-slate-800">
                        <button
                            type="button"
                            onClick={copyUrl}
                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-xs font-semibold text-slate-200 hover:bg-slate-700 active:scale-98 transition-all"
                        >
                            {copied ? (
                                <>
                                    <Check size={16} className="text-emerald-400" />
                                    <span className="text-emerald-300">Link Copied! Open Safari / Chrome & Paste</span>
                                </>
                            ) : (
                                <>
                                    <Copy size={16} />
                                    <span>Copy App Link / 复制链接到外部浏览器</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom Tip for PWA Installation */}
            <div className="mx-auto w-full max-w-md pb-2 text-center text-xs text-slate-400">
                <p className="flex items-center justify-center gap-1.5 text-slate-300">
                    <ExternalLink size={14} /> Full PWA and camera recording supported in Safari & Chrome.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                    在外部浏览器打开后，可添加至主屏幕作为独立 App 使用
                </p>
            </div>
        </div>
    );
}
