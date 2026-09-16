import { Bell, BellOff, ChevronDown, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const REMINDER_OPTIONS = [
    { value: 15, label: '15 mins before' },
    { value: 30, label: '30 mins before' },
    { value: 60, label: '1 hour before' },
    { value: 120, label: '2 hours before' },
    { value: 1440, label: '24 hours before' },
];

function toApplicationServerKey(value: string) {
    const normalizedValue = value.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(normalizedValue)) throw new Error('Push configuration contains an invalid VAPID public key character.');
    const padding = '='.repeat((4 - normalizedValue.length % 4) % 4);
    const bytes = atob((normalizedValue + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const key = Uint8Array.from(bytes, (character) => character.charCodeAt(0));
    if (key.byteLength !== 65 || key[0] !== 4) throw new Error('Push configuration has an invalid VAPID public key.');
    return key;
}

export function NotificationSettings({ className = 'crm-notification-trigger' }: { className?: string }) {
    const [offset, setOffset] = useState(60);
    const [enabled, setEnabled] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!supabase) return;
        void (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data } = await supabase.from('user_notification_preferences').select('reminder_offset_minutes, notifications_enabled').eq('user_id', user.id).maybeSingle();
            if (data) setOffset(data.reminder_offset_minutes);
            const registration = await navigator.serviceWorker.getRegistration('/');
            const subscription = await registration?.pushManager.getSubscription();
            setEnabled(Boolean(data?.notifications_enabled && subscription));
        })();
    }, []);

    const save = async (nextOffset = offset, nextEnabled = enabled) => {
        if (!supabase) return setMessage('Notifications are unavailable until the coaching database is connected.');
        setSaving(true);
        setMessage('');
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Sign in to manage notification settings.');
            const { error } = await supabase.from('user_notification_preferences').upsert({ user_id: user.id, reminder_offset_minutes: nextOffset, notifications_enabled: nextEnabled });
            if (error) throw error;
            setOffset(nextOffset);
            setEnabled(nextEnabled);
            setMessage('Reminder preferences saved.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to save reminder preferences.');
        } finally {
            setSaving(false);
        }
    };

    const enablePush = async () => {
        const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
        if (!publicKey) return setMessage('Push notifications are not configured for this app yet.');
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setMessage('Push notifications are not supported in this browser.');
        setSaving(true);
        setMessage('');
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('Allow notifications in your browser to receive reminders.');
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription()
                ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toApplicationServerKey(publicKey) });
            const keys = subscription.toJSON().keys;
            const { data: { user } } = await supabase!.auth.getUser();
            if (!user || !keys?.p256dh || !keys.auth) throw new Error('Unable to save this browser for reminders.');
            const { error } = await supabase!.from('push_subscriptions').upsert({ user_id: user.id, endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth, expiration_time: subscription.expirationTime ? new Date(subscription.expirationTime).toISOString() : null, user_agent: navigator.userAgent }, { onConflict: 'endpoint' });
            if (error) throw error;
            await save(offset, true);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to enable push notifications.');
        } finally {
            setSaving(false);
        }
    };

    const sendTestNotification = async () => {
        if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return setMessage('Turn on reminders and allow browser notifications first.');
        setSaving(true);
        setMessage('');
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification('Lesson reminder', {
                body: 'Notifications are working on this device.',
                icon: '/pwa-icon-192.png',
                badge: '/pwa-icon-192.png',
                tag: 'lesson-reminder-test',
                data: { url: '/dashboard/schedule' },
            });
            setMessage('Test notification sent. Check your system notification area.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to send a test notification.');
        } finally {
            setSaving(false);
        }
    };

    return <div className={`${className} crm-inline-notification-settings`} aria-label="Lesson reminder settings">
        <label className="crm-notification-toggle">
            <span><strong>Reminders</strong><small>{enabled ? 'On for this device' : 'Off'}</small></span>
            <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => event.target.checked ? void enablePush() : void save(offset, false)} />
            <i aria-hidden="true" />
        </label>
        <label className="crm-reminder-time"><span>Remind me</span><select value={offset} disabled={saving || !enabled} onChange={(event) => void save(Number(event.target.value), enabled)}>{REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden="true" /></label>
        <button type="button" className="crm-notification-test" disabled={saving || !enabled} onClick={() => void sendTestNotification()}><Send aria-hidden="true" /><span>Test</span></button>
        {message && <p className="crm-notification-message" role="status">{message}</p>}
    </div>;
}