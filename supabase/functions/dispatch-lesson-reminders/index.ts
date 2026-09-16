import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.0';
import webpush from 'npm:web-push@3.6.7';

type Lesson = { id: string; coach_id: string; student_id: string; title: string; starts_at: string };
type Preference = { user_id: string; reminder_offset_minutes: number; notifications_enabled: boolean };
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
    if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:notifications@example.com';
    if (!serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
        return Response.json({ error: 'Missing reminder dispatcher configuration' }, { status: 500, headers: corsHeaders });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date();
    const lookAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString();
    const { data: lessons, error: lessonsError } = await admin.from('lessons').select('id, coach_id, student_id, title, starts_at').eq('status', 'scheduled').gte('starts_at', now.toISOString()).lte('starts_at', lookAhead);
    if (lessonsError) return Response.json({ error: lessonsError.message }, { status: 500, headers: corsHeaders });

    const lessonRows = (lessons ?? []) as Lesson[];
    const participantIds = [...new Set(lessonRows.flatMap((lesson) => [lesson.coach_id, lesson.student_id]))];
    if (!participantIds.length) return Response.json({ delivered: 0 }, { headers: corsHeaders });

    const { data: students, error: studentsError } = await admin.from('students').select('id, auth_user_id').in('id', lessonRows.map((lesson) => lesson.student_id));
    if (studentsError) return Response.json({ error: studentsError.message }, { status: 500, headers: corsHeaders });
    const studentUsers = new Map((students ?? []).filter((student) => student.auth_user_id).map((student) => [student.id, student.auth_user_id as string]));
    const userIds = [...new Set([...lessonRows.map((lesson) => lesson.coach_id), ...lessonRows.map((lesson) => studentUsers.get(lesson.student_id)).filter((id): id is string => Boolean(id))])];

    const [{ data: preferences }, { data: subscriptions }] = await Promise.all([
        admin.from('user_notification_preferences').select('user_id, reminder_offset_minutes, notifications_enabled').in('user_id', userIds),
        admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds),
    ]);
    const preferenceByUser = new Map(((preferences ?? []) as Preference[]).map((preference) => [preference.user_id, preference]));
    const subscriptionsByUser = new Map<string, Subscription[]>();
    for (const subscription of (subscriptions ?? []) as Subscription[]) subscriptionsByUser.set(subscription.user_id, [...(subscriptionsByUser.get(subscription.user_id) ?? []), subscription]);

    let delivered = 0;
    const windowMs = 5 * 60 * 1000;
    for (const lesson of lessonRows) {
        const recipients = [lesson.coach_id, studentUsers.get(lesson.student_id)].filter((id): id is string => Boolean(id));
        for (const userId of recipients) {
            const preference = preferenceByUser.get(userId) ?? { user_id: userId, reminder_offset_minutes: 60, notifications_enabled: true };
            if (!preference.notifications_enabled) continue;
            const reminderAt = new Date(new Date(lesson.starts_at).getTime() - preference.reminder_offset_minutes * 60 * 1000);
            if (Math.abs(now.getTime() - reminderAt.getTime()) > windowMs / 2) continue;
            const { data: delivery, error: deliveryError } = await admin.from('lesson_reminder_deliveries').insert({ lesson_id: lesson.id, user_id: userId, reminder_at: reminderAt.toISOString() }).select('id').maybeSingle();
            if (deliveryError?.code === '23505') continue;
            if (deliveryError || !delivery) continue;
            const payload = JSON.stringify({ title: 'Lesson reminder', body: `${lesson.title} starts in ${preference.reminder_offset_minutes >= 60 ? `${preference.reminder_offset_minutes / 60} hour${preference.reminder_offset_minutes === 60 ? '' : 's'}` : `${preference.reminder_offset_minutes} minutes`}.`, lessonId: lesson.id, startsAt: lesson.starts_at, url: '/dashboard/schedule' });
            const targets = subscriptionsByUser.get(userId) ?? [];
            const results = await Promise.allSettled(targets.map((subscription) => webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload)));
            await Promise.all(results.map((result, index) => result.status === 'rejected' && /410|404/.test(String(result.reason)) ? admin.from('push_subscriptions').delete().eq('id', targets[index].id) : Promise.resolve()));
            delivered += results.filter((result) => result.status === 'fulfilled').length;
        }
    }
    return Response.json({ delivered }, { headers: corsHeaders });
});