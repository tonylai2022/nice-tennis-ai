/**
 * Service Worker Update Manager
 * Coordinates service worker registration, detects updates, periodically checks
 * for fresh deployments, and notifies clients when a new version is available.
 */

type UpdateCallback = () => void;

class ServiceWorkerManager {
    private registration: ServiceWorkerRegistration | null = null;
    private listeners: Set<UpdateCallback> = new Set();
    private updateAvailable = false;
    private hasControllerOnLoad = false;
    private updateCheckInterval: number | null = null;

    constructor() {
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            this.hasControllerOnLoad = Boolean(navigator.serviceWorker.controller);
        }
    }

    public register(): void {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

        const log = (stage: string, detail?: unknown) => {
            if (typeof (window as any).__motionTutorMobileLog === 'function') {
                (window as any).__motionTutorMobileLog(stage, detail);
            }
        };

        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register('/service-worker.js')
                .then((reg) => {
                    this.registration = reg;
                    log('Service worker registered', reg.scope);
                    this.setupRegistrationListeners(reg);
                    this.setupPeriodicUpdateChecks(reg);
                })
                .catch((error) => {
                    console.warn('[SW] Registration failed:', error);
                    log('Service worker registration failed', error);
                });

            // Listen for service worker controller changes (new worker activated)
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                log('Service worker controller changed');
                // If there was already a controller when the page loaded, this change represents an update
                if (this.hasControllerOnLoad) {
                    this.notifyUpdateAvailable();
                }
            });

            // Listen for messages from the service worker
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'SW_ACTIVATED' && this.hasControllerOnLoad) {
                    log('Service worker activated message received');
                    this.notifyUpdateAvailable();
                }
            });
        });
    }

    private setupRegistrationListeners(reg: ServiceWorkerRegistration): void {
        // If there's already a worker waiting, an update is ready
        if (reg.waiting) {
            this.notifyUpdateAvailable();
            return;
        }

        // If an update is currently installing, wait for it to install
        if (reg.installing) {
            this.trackInstallingWorker(reg.installing);
        }

        // Listen for new updates discovered by the browser
        reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
                this.trackInstallingWorker(installingWorker);
            }
        });
    }

    private trackInstallingWorker(worker: ServiceWorker): void {
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                    // There was an active worker and a new one was installed -> Update available!
                    this.notifyUpdateAvailable();
                }
            }
        });
    }

    private setupPeriodicUpdateChecks(reg: ServiceWorkerRegistration): void {
        // Check for updates when the app regains visibility (common on mobile home screens)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.checkForUpdate();
            }
        });

        // Check for updates on window focus
        window.addEventListener('focus', () => {
            this.checkForUpdate();
        });

        // Periodically check for updates every 60 seconds
        this.updateCheckInterval = window.setInterval(() => {
            this.checkForUpdate();
        }, 60 * 1000);
    }

    public checkForUpdate(): void {
        if (!this.registration) return;
        this.registration.update().catch((err) => {
            console.debug('[SW] Periodic update check skipped or failed:', err);
        });
    }

    public subscribe(callback: UpdateCallback): () => void {
        this.listeners.add(callback);
        if (this.updateAvailable) {
            callback();
        }
        return () => {
            this.listeners.delete(callback);
        };
    }

    public isUpdateAvailable(): boolean {
        return this.updateAvailable;
    }

    private notifyUpdateAvailable(): void {
        this.updateAvailable = true;
        this.listeners.forEach((listener) => {
            try {
                listener();
            } catch (err) {
                console.error('[SW] Error running update listener:', err);
            }
        });
    }

    /**
     * Activates the waiting service worker (if any) and reloads the application.
     */
    public applyUpdate(): void {
        if (this.registration?.waiting) {
            this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        // Small delay to allow SKIP_WAITING to be processed before reload
        setTimeout(() => {
            window.location.reload();
        }, 150);
    }
}

export const swManager = new ServiceWorkerManager();
