import { Download, Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'motionTutor.installPromptDismissed';
const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function PwaInstallPrompt() {
    const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    useEffect(() => {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (!isMobile || isStandalone() || isWeChat() || localStorage.getItem(DISMISSED_KEY)) return;

        const reveal = () => setVisible(true);
        const onBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setInstallEvent(event as BeforeInstallPromptEvent);
            reveal();
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        if (isIos) reveal();

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        };
    }, []);

    const dismiss = () => {
        localStorage.setItem(DISMISSED_KEY, 'true');
        setVisible(false);
    };

    const install = async () => {
        if (!installEvent) return;
        await installEvent.prompt();
        const { outcome } = await installEvent.userChoice;
        if (outcome === 'accepted') setVisible(false);
        setInstallEvent(null);
    };

    if (!visible) return null;

    return (
        <aside className="pwa-install-prompt p-4 text-slate-50" role="dialog" aria-label="Install Nice Tennis">
            <button type="button" onClick={dismiss} className="absolute right-2 top-2 touch-target text-slate-400 hover:text-white" aria-label="Dismiss install prompt">
                <X size={20} aria-hidden="true" />
            </button>
            <div className="pr-10">
                <p className="font-semibold">Add Nice Tennis to your home screen</p>
                <p className="mt-1 text-sm text-slate-300">Open coaching like a real app, directly from your phone.</p>
            </div>
            {isIos ? (
                <p className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">
                    In Safari, tap <Share className="mx-1 inline align-text-bottom" size={16} aria-label="Share" /> then “Add to Home Screen”.
                </p>
            ) : (
                <button type="button" onClick={install} className="btn btn-primary mt-4 w-full !py-2.5">
                    <Download size={18} aria-hidden="true" /> Add to home screen
                </button>
            )}
        </aside>
    );
}