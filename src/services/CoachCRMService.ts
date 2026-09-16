import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type CRMRole = 'coach' | 'student';
export type StudentAgeRange = 'under_13' | '13_to_17' | '18_to_25' | '26_to_44' | '45_plus' | 'prefer_not_to_say';
export const CRM_OAUTH_ROLE_KEY = 'motionTutor.crmOAuthRole';

export interface CRMProfile {
    id: string;
    role: CRMRole;
    full_name: string;
}

export interface Student {
    id: string;
    full_name: string;
    email: string;
    invitation_status: 'pending' | 'active' | 'disabled';
    created_at: string;
    date_of_birth: string | null;
    age_range: StudentAgeRange | null;
    gender: 'female' | 'male' | 'nonbinary' | 'prefer_not_to_say' | null;
    level: string | null;
    dominant_hand: 'left' | 'right' | null;
    dominant_eye: 'left' | 'right' | null;
    racket_brand: string | null;
    racket_model: string | null;
    racket_string: string | null;
    racket_head_size_sq_in: number | null;
    racket_weight_g: number | null;
    racket_string_tension_lbs: number | null;
    shoes_used: string | null;
    goals: string | null;
    restrictions: string | null;
    last_lesson_at: string | null;
    student_archived_at: string | null;
    remaining_credits: number;
}

export interface StudentProfileInput {
    full_name: string;
    email: string;
    date_of_birth: string | null;
    gender: Student['gender'];
    level: string | null;
    dominant_hand: Student['dominant_hand'];
    dominant_eye: Student['dominant_eye'];
    racket_brand: string | null;
    racket_model: string | null;
    racket_string: string | null;
    racket_head_size_sq_in: number | null;
    racket_weight_g: number | null;
    racket_string_tension_lbs: number | null;
    shoes_used: string | null;
    goals: string | null;
    restrictions: string | null;
    last_lesson_at: string | null;
}

const STUDENT_FIELDS = 'id, full_name, email, invitation_status, created_at, date_of_birth, age_range, gender, level, dominant_hand, dominant_eye, racket_brand, racket_model, racket_string, racket_head_size_sq_in, racket_weight_g, racket_string_tension_lbs, shoes_used, goals, restrictions, last_lesson_at, student_archived_at, remaining_credits';
const COACH_RECORD_FIELDS = 'id, student_id, title, body, lesson_date, skill, focus_area, evidence_links, is_published, created_at, updated_at, published_at';

export interface CoachRecord {
    id: string;
    student_id: string;
    title: string;
    body: string;
    lesson_date: string | null;
    skill: string | null;
    focus_area: string | null;
    evidence_links: string[];
    is_published: boolean;
    created_at: string;
    updated_at: string;
    published_at: string | null;
}

export interface CoachRecordInput {
    title: string;
    body: string;
    lesson_date: string | null;
    skill: string | null;
    focus_area: string | null;
    evidence_links: string[];
}

export interface StudentRecord {
    id: string;
    student_id: string;
    title: string;
    body: string;
    created_at: string;
}

export interface StudentRecordMedia {
    id: string;
    student_record_id: string;
    media_type: 'image' | 'video';
    original_name: string;
    signed_url: string;
}

export type AttendanceStatus = 'unmarked' | 'present' | 'absent' | 'late';
export type PaymentStatus = 'unpaid' | 'paid' | 'waived';

export interface ClassSession {
    id: string;
    title: string;
    starts_at: string;
    duration_minutes: number;
    location: string | null;
    notes: string | null;
    created_at: string;
}

export interface ClassSessionStudent {
    id: string;
    class_session_id: string;
    student_id: string;
    attendance_status: AttendanceStatus;
    payment_status: PaymentStatus;
    payment_amount: number | null;
    payment_note: string | null;
}

export type LessonPaymentType = 'package' | 'single';
export type LessonPaymentMethod = 'cash' | 'online_transfer' | 'zelle' | 'fps' | 'other';
export type LessonPaymentStatus = 'paid' | 'pending';

export interface Lesson {
    id: string;
    coach_id: string;
    student_id: string;
    title: string;
    starts_at: string;
    duration_minutes: number;
    location: string | null;
    timezone: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    payment_type: LessonPaymentType;
    payment_method: LessonPaymentMethod | null;
    payment_status: LessonPaymentStatus;
    amount_paid: number | null;
    package_id: string | null;
    payment_received_at: string | null;
    completed_at: string | null;
    created_at: string;
}

export interface StudentScheduleItem {
    id: string;
    title: string;
    starts_at: string;
    duration_minutes: number;
    location: string | null;
    timezone: string;
    kind: 'lesson' | 'class';
}

export interface LessonBookingInput {
    student_id: string;
    title: string;
    starts_at: string;
    duration_minutes: number;
    location: string;
    timezone: string;
    payment_type: LessonPaymentType;
    payment_method: LessonPaymentMethod | null;
    payment_status: LessonPaymentStatus;
    amount_paid: number | null;
}

export type LessonUpdateInput = Pick<Lesson, 'title' | 'starts_at' | 'duration_minutes' | 'location' | 'timezone'>;
export type LessonStatusUpdateInput = Pick<Lesson, 'status' | 'payment_status'> & Partial<Pick<Lesson, 'payment_method' | 'amount_paid'>>;

export interface LessonPackage {
    id: string;
    coach_id: string;
    student_id: string;
    session_count: number;
    session_duration_minutes: number;
    price: number;
    remaining_credits: number;
    created_at: string;
}

export interface CoachRecordMediaDraft {
    file: File;
    kind: 'image' | 'video';
    landmarks: unknown;
    poseFrames?: unknown[];
    annotations: unknown[];
}

export interface CoachRecordMedia {
    id: string;
    coach_record_id: string;
    storage_path: string;
    media_type: 'image' | 'video';
    original_name: string;
    mime_type: string;
    file_size_bytes: number;
    pose_landmarks: unknown;
    annotations: unknown[];
    created_at: string;
    signed_url: string;
}

export interface HomeworkAssignment {
    id: string;
    student_id: string;
    title: string;
    instructions: string;
    drill_category: string | null;
    due_at: string | null;
    status: 'assigned' | 'completed' | 'reviewed';
    student_reflection: string | null;
    completed_at: string | null;
    created_at: string;
}

export interface HomeworkEvidence {
    id: string;
    homework_assignment_id: string;
    original_name: string;
    mime_type: string;
    file_size_bytes: number;
    created_at: string;
    signed_url: string;
}

export interface HomeworkResourceMedia {
    id: string;
    homework_assignment_id: string;
    media_type: 'image' | 'video';
    original_name: string;
    mime_type: string;
    file_size_bytes: number;
    created_at: string;
    signed_url: string;
}

export type AssessmentChallengeType = 'rally_count' | 'serve_in_percentage' | 'target_hit_rate' | 'rubric_score';
export type AssessmentStatus = 'assigned' | 'in_progress' | 'achieved' | 'not_achieved';

export interface StudentAssessment {
    id: string;
    student_id: string;
    title: string;
    challenge_type: AssessmentChallengeType;
    target_value: number;
    unit: string;
    result_value: number | null;
    score: number | null;
    status: AssessmentStatus;
    achieved_at: string | null;
    notes: string | null;
    student_reflection: string | null;
    is_published: boolean;
    published_at: string | null;
    created_at: string;
}

export interface AssessmentAttempt {
    id: string;
    student_assessment_id: string;
    result_value: number | null;
    score: number | null;
    notes: string | null;
    created_at: string;
}

export interface AssessmentEvidence {
    id: string;
    student_assessment_id: string;
    external_url: string | null;
    label: string | null;
    notes: string | null;
    created_at: string;
}

export interface AssessmentInput {
    title: string;
    challenge_type: AssessmentChallengeType;
    target_value: number;
    unit: string;
    notes: string | null;
}

export const CAPABILITY_DIMENSIONS = ['forehand_drive', 'backhand_drive', 'forehand_volley', 'backhand_volley', 'forehand_slice', 'backhand_slice', 'serve_and_return', 'footwork'] as const;
export type CapabilityDimension = typeof CAPABILITY_DIMENSIONS[number];
export type CapabilityScores = Record<CapabilityDimension, number>;

export interface CapabilityAssessmentSnapshot {
    id: string;
    student_id: string;
    capability_scores: CapabilityScores;
    coach_notes: string | null;
    assessed_at: string;
    created_at: string;
}

export interface CapabilitySnapshotSource {
    id: string;
    capability_snapshot_id: string;
    source_coach_record_id: string | null;
    source_coach_record_media_id: string | null;
    source_student_assessment_id: string | null;
    created_at: string;
}

export interface GrowthReportContent {
    summary: string;
    strengths: string;
    priorities: string;
    next_steps: string;
}

export interface GrowthReportSnapshot {
    id: string;
    student_id: string;
    capability_snapshot_id: string | null;
    title: string;
    report_content: GrowthReportContent;
    status: 'draft' | 'published';
    published_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface StudentPortfolioSnapshot {
    id: string;
    capability_scores: CapabilityScores;
    assessed_at: string;
}

export interface StudentPortfolioEvidence {
    id: string;
    capability_snapshot_id: string;
    source_coach_record_id: string | null;
    source_coach_record_media_id: string | null;
    source_student_assessment_id: string | null;
    created_at: string;
}

export interface StudentSelfProfileInput {
    age_range: StudentAgeRange | null;
    gender: Student['gender'];
    dominant_hand: Student['dominant_hand'];
    dominant_eye: Student['dominant_eye'];
    goals: string | null;
    restrictions: string | null;
}

const HOMEWORK_FIELDS = 'id, student_id, title, instructions, drill_category, due_at, status, student_reflection, completed_at, created_at';
const ASSESSMENT_FIELDS = 'id, student_id, title, challenge_type, target_value, unit, result_value, score, status, achieved_at, notes, student_reflection, is_published, published_at, created_at';

function requireSupabase() {
    if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    return supabase;
}

function throwIfError(error: { message: string; code?: string } | null) {
    if (!error) return;
    const isMissingMigration = error.code === '42703' || error.code === '42P01' || /column .* does not exist|relation .* does not exist/i.test(error.message);
    throw new Error(isMissingMigration ? 'The CRM database schema is outdated. Apply every pending file in supabase/migrations in numeric order in Supabase SQL Editor, then retry.' : error.message);
}

export const coachCRMService = {
    isConfigured: () => Boolean(supabase),

    async getSession(): Promise<Session | null> {
        const client = requireSupabase();
        const { data, error } = await client.auth.getSession();
        throwIfError(error);
        return data.session;
    },

    onAuthStateChange(callback: (session: Session | null) => void): () => void {
        const client = requireSupabase();
        const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
        return () => data.subscription.unsubscribe();
    },

    async signInWithGoogle(role: CRMRole) {
        const client = requireSupabase();
        sessionStorage.setItem(CRM_OAUTH_ROLE_KEY, role);
        const redirectUrl = new URL('/login', window.location.origin);
        redirectUrl.searchParams.set('crmRole', role);
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: redirectUrl.toString() },
        });
        throwIfError(error);
    },

    async signInWithPassword(email: string, password: string): Promise<void> {
        const client = requireSupabase();
        const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        throwIfError(error);
    },

    async signUpWithPassword(role: CRMRole, fullName: string, email: string, password: string): Promise<boolean> {
        const client = requireSupabase();
        const { data, error } = await client.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: { data: { role, full_name: fullName.trim() } },
        });
        throwIfError(error);
        return Boolean(data.session);
    },

    async resendEmailConfirmation(email: string): Promise<void> {
        const client = requireSupabase();
        const redirectTo = new URL('/login', window.location.origin).toString();
        const { error } = await client.auth.resend({ type: 'signup', email: email.trim().toLowerCase(), options: { emailRedirectTo: redirectTo } });
        throwIfError(error);
    },

    async completeGoogleSignIn(role: CRMRole): Promise<CRMProfile> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('complete_google_crm_sign_in', { requested_role: role });
        throwIfError(error);
        return data as CRMProfile;
    },

    async signOut() {
        const client = requireSupabase();
        const { error } = await client.auth.signOut({ scope: 'local' });
        throwIfError(error);
        sessionStorage.removeItem(CRM_OAUTH_ROLE_KEY);
    },

    async loadProfile(userId: string): Promise<CRMProfile> {
        const client = requireSupabase();
        const { data, error } = await client.from('profiles').select('id, role, full_name').eq('id', userId).single();
        throwIfError(error);
        return data as CRMProfile;
    },

    async loadCoachStudents(): Promise<Student[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('students').select(STUDENT_FIELDS).order('created_at', { ascending: false });
        throwIfError(error);
        return (data ?? []) as Student[];
    },

    async loadClassSchedule(): Promise<{ sessions: ClassSession[]; attendees: ClassSessionStudent[] }> {
        const client = requireSupabase();
        const { data: sessions, error: sessionsError } = await client.from('class_sessions').select('id, title, starts_at, duration_minutes, location, notes, created_at').order('starts_at', { ascending: true });
        throwIfError(sessionsError);
        const sessionIds = (sessions ?? []).map((session) => session.id as string);
        if (!sessionIds.length) return { sessions: [], attendees: [] };
        const { data: attendees, error: attendeesError } = await client.from('class_session_students').select('id, class_session_id, student_id, attendance_status, payment_status, payment_amount, payment_note').in('class_session_id', sessionIds);
        throwIfError(attendeesError);
        return { sessions: (sessions ?? []) as ClassSession[], attendees: (attendees ?? []) as ClassSessionStudent[] };
    },

    async loadLessons(): Promise<Lesson[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('lessons').select('id, coach_id, student_id, title, starts_at, duration_minutes, location, timezone, status, payment_type, payment_method, payment_status, amount_paid, package_id, payment_received_at, completed_at, created_at').order('starts_at', { ascending: true });
        throwIfError(error);
        return (data ?? []) as Lesson[];
    },

    async loadMyLessons(): Promise<Lesson[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('lessons').select('id, coach_id, student_id, title, starts_at, duration_minutes, location, timezone, status, payment_type, payment_method, payment_status, amount_paid, package_id, payment_received_at, completed_at, created_at').order('starts_at', { ascending: true });
        throwIfError(error);
        return (data ?? []) as Lesson[];
    },

    async loadMyClassSessions(): Promise<ClassSession[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('class_sessions').select('id, title, starts_at, duration_minutes, location, notes, created_at').order('starts_at', { ascending: true });
        throwIfError(error);
        return (data ?? []) as ClassSession[];
    },

    async loadMySchedule(): Promise<StudentScheduleItem[]> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('load_my_schedule');
        throwIfError(error);
        return (data ?? []) as StudentScheduleItem[];
    },

    async bookLesson(input: LessonBookingInput): Promise<Lesson> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('book_lesson_with_timezone', {
            p_student_id: input.student_id, p_title: input.title, p_starts_at: input.starts_at,
            p_duration_minutes: input.duration_minutes, p_location: input.location, p_timezone: input.timezone, p_payment_type: input.payment_type,
            p_payment_method: input.payment_method, p_payment_status: input.payment_status, p_amount_paid: input.amount_paid,
        });
        throwIfError(error);
        return data as Lesson;
    },

    async updateLesson(id: string, input: LessonStatusUpdateInput): Promise<Lesson> {
        const client = requireSupabase();
        const { data, error } = await client.from('lessons').update(input).eq('id', id).select('id, coach_id, student_id, title, starts_at, duration_minutes, location, timezone, status, payment_type, payment_method, payment_status, amount_paid, package_id, payment_received_at, completed_at, created_at').single();
        throwIfError(error);
        return data as Lesson;
    },

    async updateScheduledLesson(id: string, input: LessonUpdateInput): Promise<Lesson> {
        const client = requireSupabase();
        const { data, error } = await client.from('lessons').update(input).eq('id', id).eq('status', 'scheduled').select('id, coach_id, student_id, title, starts_at, duration_minutes, location, timezone, status, payment_type, payment_method, payment_status, amount_paid, package_id, payment_received_at, completed_at, created_at').single();
        throwIfError(error);
        return data as Lesson;
    },

    async deleteScheduledLesson(id: string): Promise<void> {
        const client = requireSupabase();
        const { data, error } = await client.from('lessons').delete().eq('id', id).eq('status', 'scheduled').select('id').maybeSingle();
        throwIfError(error);
        if (!data) throw new Error('This lesson is no longer scheduled.');
    },

    async updateLessonPaymentRecord(id: string, input: LessonStatusUpdateInput): Promise<Lesson> {
        return this.updateLesson(id, input);
    },

    async deleteLessonPaymentRecord(id: string): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('delete_lesson_payment_record', { p_lesson_id: id });
        throwIfError(error);
        return data as Student;
    },

    async updateLessonPackageRecord(packageId: string, sessionCount: number, sessionDurationMinutes: number, price: number): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('update_lesson_package_record', { p_package_id: packageId, p_session_count: sessionCount, p_session_duration_minutes: sessionDurationMinutes, p_price: price });
        throwIfError(error);
        return data as Student;
    },

    async deleteLessonPackageRecord(packageId: string): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('delete_lesson_package_record', { p_package_id: packageId });
        throwIfError(error);
        return data as Student;
    },

    async loadLessonPackages(): Promise<LessonPackage[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('lesson_packages').select('id, coach_id, student_id, session_count, session_duration_minutes, price, remaining_credits, created_at').order('created_at', { ascending: false });
        throwIfError(error);
        return (data ?? []) as LessonPackage[];
    },

    async purchaseLessonPackage(studentId: string, sessionCount: number, sessionDurationMinutes: number, price: number): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('purchase_lesson_package', { p_student_id: studentId, p_session_count: sessionCount, p_session_duration_minutes: sessionDurationMinutes, p_price: price });
        throwIfError(error);
        return data as Student;
    },

    async createClassSession(input: Omit<ClassSession, 'id' | 'created_at'>, studentIds: string[]): Promise<void> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const { data: session, error: sessionError } = await client.from('class_sessions').insert({ ...input, coach_id: identity.user.id }).select('id').single();
        throwIfError(sessionError);
        if (!studentIds.length) return;
        const { error: attendeesError } = await client.from('class_session_students').insert(studentIds.map((student_id) => ({ class_session_id: session.id, student_id })));
        throwIfError(attendeesError);
    },

    async updateClassSessionStudent(id: string, input: Pick<ClassSessionStudent, 'attendance_status' | 'payment_status' | 'payment_amount' | 'payment_note'>): Promise<ClassSessionStudent> {
        const client = requireSupabase();
        const { data, error } = await client.from('class_session_students').update(input).eq('id', id).select('id, class_session_id, student_id, attendance_status, payment_status, payment_amount, payment_note').single();
        throwIfError(error);
        return data as ClassSessionStudent;
    },

    async updateStudent(studentId: string, input: StudentProfileInput): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.from('students').update(input).eq('id', studentId).select(STUDENT_FIELDS).single();
        throwIfError(error);
        return data as Student;
    },

    async markStudentLesson(studentId: string): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.from('students').update({ last_lesson_at: new Date().toISOString() }).eq('id', studentId).select(STUDENT_FIELDS).single();
        throwIfError(error);
        return data as Student;
    },

    async archiveStudent(studentId: string): Promise<void> {
        const client = requireSupabase();
        const { error } = await client.from('students').update({ invitation_status: 'disabled', student_archived_at: new Date().toISOString() }).eq('id', studentId);
        throwIfError(error);
    },

    async restoreStudent(studentId: string): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.from('students').update({ invitation_status: 'active', student_archived_at: null }).eq('id', studentId).select(STUDENT_FIELDS).single();
        throwIfError(error);
        return data as Student;
    },

    async loadCoachRecords(): Promise<CoachRecord[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('coach_records').select(COACH_RECORD_FIELDS).order('created_at', { ascending: false });
        throwIfError(error);
        return (data ?? []) as CoachRecord[];
    },

    async loadCoachStudentRecords(): Promise<StudentRecord[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('student_records').select('id, student_id, title, body, created_at').order('created_at', { ascending: false });
        throwIfError(error);
        return (data ?? []) as StudentRecord[];
    },

    async loadCoachHomework(): Promise<{ assignments: HomeworkAssignment[]; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[] }> {
        const client = requireSupabase();
        const { data: assignments, error: assignmentsError } = await client.from('homework_assignments')
            .select(HOMEWORK_FIELDS)
            .order('due_at', { ascending: true, nullsFirst: false });
        throwIfError(assignmentsError);
        const assignmentIds = (assignments ?? []).map((assignment) => assignment.id as string);
        if (!assignmentIds.length) return { assignments: [], evidence: [], resources: [] };
        const { data: evidenceRows, error: evidenceError } = await client.from('homework_evidence')
            .select('id, homework_assignment_id, storage_path, original_name, mime_type, file_size_bytes, created_at')
            .in('homework_assignment_id', assignmentIds)
            .order('created_at', { ascending: true });
        throwIfError(evidenceError);
        const evidence = await Promise.all((evidenceRows ?? []).map(async (row) => {
            const { data: signed, error: signedError } = await client.storage.from('homework-evidence').createSignedUrl(row.storage_path, 60 * 60);
            throwIfError(signedError);
            return { ...row, signed_url: signed.signedUrl } as HomeworkEvidence;
        }));
        const { data: resourceRows, error: resourceError } = await client.from('homework_resource_media')
            .select('id, homework_assignment_id, storage_path, media_type, original_name, mime_type, file_size_bytes, created_at')
            .in('homework_assignment_id', assignmentIds)
            .order('created_at', { ascending: true });
        throwIfError(resourceError);
        const resources = await Promise.all((resourceRows ?? []).map(async (row) => {
            const { data: signed, error: signedError } = await client.storage.from('homework-resources').createSignedUrl(row.storage_path, 60 * 60);
            throwIfError(signedError);
            return { ...row, signed_url: signed.signedUrl } as HomeworkResourceMedia;
        }));
        return { assignments: assignments as HomeworkAssignment[], evidence, resources };
    },

    async createCoachHomework(studentIds: string[], title: string, instructions: string, dueAt: string | null, drillCategory: string | null, files: File[]): Promise<HomeworkAssignment[]> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const recipientIds = [...new Set(studentIds)];
        if (!recipientIds.length) throw new Error('Select at least one student.');
        const { data, error } = await client.from('homework_assignments').insert(recipientIds.map((studentId) => ({
            coach_id: identity.user.id,
            student_id: studentId,
            title,
            instructions,
            drill_category: drillCategory,
            due_at: dueAt,
        }))).select(HOMEWORK_FIELDS);
        throwIfError(error);
        const assignments = (data ?? []) as HomeworkAssignment[];
        for (const assignment of assignments) await this.uploadCoachHomeworkResources(assignment.id, files);
        return assignments;
    },

    async uploadCoachHomeworkResources(homeworkId: string, files: File[]): Promise<void> {
        if (!files.length) return;
        const invalidFile = files.find((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
        if (invalidFile) throw new Error('Homework resources must be images or videos.');
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const uploadedPaths: string[] = [];
        const rows = [];
        try {
            for (const file of files) {
                const extension = file.name.split('.').pop()?.toLowerCase() || (file.type.startsWith('image/') ? 'jpg' : 'mp4');
                const path = `${identity.user.id}/${homeworkId}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await client.storage.from('homework-resources').upload(path, file, { contentType: file.type, upsert: false });
                throwIfError(uploadError);
                uploadedPaths.push(path);
                rows.push({ homework_assignment_id: homeworkId, storage_path: path, media_type: file.type.startsWith('image/') ? 'image' : 'video', original_name: file.name, mime_type: file.type, file_size_bytes: file.size });
            }
            const { error } = await client.from('homework_resource_media').insert(rows);
            throwIfError(error);
        } catch (error) {
            if (uploadedPaths.length) await client.storage.from('homework-resources').remove(uploadedPaths);
            throw error;
        }
    },

    async reviewCoachHomework(homeworkId: string): Promise<HomeworkAssignment> {
        const client = requireSupabase();
        const { data, error } = await client.from('homework_assignments').update({ status: 'reviewed' }).eq('id', homeworkId).select(HOMEWORK_FIELDS).single();
        throwIfError(error);
        return data as HomeworkAssignment;
    },

    async loadCoachAssessments(): Promise<{ assessments: StudentAssessment[]; attempts: AssessmentAttempt[]; evidence: AssessmentEvidence[] }> {
        const client = requireSupabase();
        const { data: assessments, error: assessmentError } = await client.from('student_assessments').select(ASSESSMENT_FIELDS).order('created_at', { ascending: false });
        throwIfError(assessmentError);
        const assessmentIds = (assessments ?? []).map((assessment) => assessment.id as string);
        if (!assessmentIds.length) return { assessments: [], attempts: [], evidence: [] };
        const [{ data: attempts, error: attemptError }, { data: evidence, error: evidenceError }] = await Promise.all([
            client.from('assessment_attempts').select('id, student_assessment_id, result_value, score, notes, created_at').in('student_assessment_id', assessmentIds).order('created_at', { ascending: false }),
            client.from('assessment_evidence').select('id, student_assessment_id, external_url, label, notes, created_at').in('student_assessment_id', assessmentIds).order('created_at', { ascending: false }),
        ]);
        throwIfError(attemptError);
        throwIfError(evidenceError);
        return { assessments: assessments as StudentAssessment[], attempts: (attempts ?? []) as AssessmentAttempt[], evidence: (evidence ?? []) as AssessmentEvidence[] };
    },

    async createStudentAssessments(studentIds: string[], input: AssessmentInput, publish: boolean): Promise<StudentAssessment[]> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const recipientIds = [...new Set(studentIds)];
        if (!recipientIds.length) throw new Error('Select at least one student.');
        const { data, error } = await client.from('student_assessments').insert(recipientIds.map((studentId) => ({
            coach_id: identity.user.id,
            student_id: studentId,
            ...input,
            is_published: publish,
            published_at: publish ? new Date().toISOString() : null,
        }))).select(ASSESSMENT_FIELDS);
        throwIfError(error);
        return (data ?? []) as StudentAssessment[];
    },

    async recordAssessmentOutcome(assessmentId: string, resultValue: number | null, score: number | null, notes: string | null, status: AssessmentStatus, publish: boolean): Promise<StudentAssessment> {
        const client = requireSupabase();
        const { data, error } = await client.from('student_assessments').update({
            result_value: resultValue,
            score,
            notes,
            status,
            achieved_at: status === 'achieved' ? new Date().toISOString() : null,
            is_published: publish,
            published_at: publish ? new Date().toISOString() : null,
        }).eq('id', assessmentId).select(ASSESSMENT_FIELDS).single();
        throwIfError(error);
        return data as StudentAssessment;
    },

    async createAssessmentAttempt(assessmentId: string, resultValue: number | null, score: number | null, notes: string | null): Promise<AssessmentAttempt> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const { data, error } = await client.from('assessment_attempts').insert({ student_assessment_id: assessmentId, coach_id: identity.user.id, result_value: resultValue, score, notes }).select('id, student_assessment_id, result_value, score, notes, created_at').single();
        throwIfError(error);
        return data as AssessmentAttempt;
    },

    async addAssessmentEvidence(assessmentId: string, externalUrl: string, label: string | null): Promise<AssessmentEvidence> {
        const url = new URL(externalUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Evidence links must use http:// or https://.');
        const client = requireSupabase();
        const { data, error } = await client.from('assessment_evidence').insert({ student_assessment_id: assessmentId, external_url: externalUrl, label }).select('id, student_assessment_id, external_url, label, notes, created_at').single();
        throwIfError(error);
        return data as AssessmentEvidence;
    },

    async loadCoachPortfolio(): Promise<{ snapshots: CapabilityAssessmentSnapshot[]; sources: CapabilitySnapshotSource[]; reports: GrowthReportSnapshot[] }> {
        const client = requireSupabase();
        const [{ data: snapshots, error: snapshotError }, { data: reports, error: reportError }] = await Promise.all([
            client.from('capability_assessment_snapshots').select('id, student_id, capability_scores, coach_notes, assessed_at, created_at').order('assessed_at', { ascending: false }),
            client.from('growth_report_snapshots').select('id, student_id, capability_snapshot_id, title, report_content, status, published_at, created_at, updated_at').order('created_at', { ascending: false }),
        ]);
        throwIfError(snapshotError);
        throwIfError(reportError);
        const snapshotIds = (snapshots ?? []).map((snapshot) => snapshot.id as string);
        if (!snapshotIds.length) return { snapshots: (snapshots ?? []) as CapabilityAssessmentSnapshot[], sources: [], reports: (reports ?? []) as GrowthReportSnapshot[] };
        const { data: sources, error: sourceError } = await client.from('capability_snapshot_sources').select('id, capability_snapshot_id, source_coach_record_id, source_coach_record_media_id, source_student_assessment_id, created_at').in('capability_snapshot_id', snapshotIds).order('created_at', { ascending: true });
        throwIfError(sourceError);
        return { snapshots: (snapshots ?? []) as CapabilityAssessmentSnapshot[], sources: (sources ?? []) as CapabilitySnapshotSource[], reports: (reports ?? []) as GrowthReportSnapshot[] };
    },

    async createCapabilitySnapshot(studentId: string, scores: CapabilityScores, coachNotes: string | null, sourceIds: { coachRecordIds: string[]; assessmentIds: string[] }): Promise<CapabilityAssessmentSnapshot> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const { data, error } = await client.from('capability_assessment_snapshots').insert({ coach_id: identity.user.id, student_id: studentId, capability_scores: scores, coach_notes: coachNotes }).select('id, student_id, capability_scores, coach_notes, assessed_at, created_at').single();
        throwIfError(error);
        const snapshot = data as CapabilityAssessmentSnapshot;
        const rows = [
            ...[...new Set(sourceIds.coachRecordIds)].map((source_coach_record_id) => ({ capability_snapshot_id: snapshot.id, source_coach_record_id })),
            ...[...new Set(sourceIds.assessmentIds)].map((source_student_assessment_id) => ({ capability_snapshot_id: snapshot.id, source_student_assessment_id })),
        ];
        if (rows.length) {
            const { error: sourceError } = await client.from('capability_snapshot_sources').insert(rows);
            throwIfError(sourceError);
        }
        return snapshot;
    },

    async createGrowthReport(studentId: string, capabilitySnapshotId: string | null, title: string, content: GrowthReportContent): Promise<GrowthReportSnapshot> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const { data, error } = await client.from('growth_report_snapshots').insert({ coach_id: identity.user.id, student_id: studentId, capability_snapshot_id: capabilitySnapshotId, title, report_content: content }).select('id, student_id, capability_snapshot_id, title, report_content, status, published_at, created_at, updated_at').single();
        throwIfError(error);
        return data as GrowthReportSnapshot;
    },

    async updateGrowthReport(reportId: string, title: string, content: GrowthReportContent): Promise<GrowthReportSnapshot> {
        const client = requireSupabase();
        const { data, error } = await client.from('growth_report_snapshots').update({ title, report_content: content }).eq('id', reportId).select('id, student_id, capability_snapshot_id, title, report_content, status, published_at, created_at, updated_at').single();
        throwIfError(error);
        return data as GrowthReportSnapshot;
    },

    async publishGrowthReport(reportId: string): Promise<GrowthReportSnapshot> {
        const client = requireSupabase();
        const { data, error } = await client.from('growth_report_snapshots').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', reportId).select('id, student_id, capability_snapshot_id, title, report_content, status, published_at, created_at, updated_at').single();
        throwIfError(error);
        return data as GrowthReportSnapshot;
    },

    async createCoachRecord(studentId: string, input: CoachRecordInput, publish: boolean): Promise<CoachRecord> {
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const { data, error } = await client.from('coach_records').insert({
            coach_id: identity.user.id,
            student_id: studentId,
            ...input,
            is_published: publish,
            published_at: publish ? new Date().toISOString() : null,
        }).select(COACH_RECORD_FIELDS).single();
        throwIfError(error);
        return data as CoachRecord;
    },

    async updateCoachRecord(recordId: string, input: CoachRecordInput, publish: boolean): Promise<CoachRecord> {
        const client = requireSupabase();
        const { data, error } = await client.from('coach_records').update({
            ...input,
            is_published: publish,
            published_at: publish ? new Date().toISOString() : null,
        }).eq('id', recordId).select(COACH_RECORD_FIELDS).single();
        throwIfError(error);
        return data as CoachRecord;
    },

    async deleteCoachRecord(recordId: string): Promise<void> {
        const client = requireSupabase();
        const { data: media, error: mediaError } = await client.from('coach_record_media').select('storage_path').eq('coach_record_id', recordId);
        throwIfError(mediaError);
        const paths = (media ?? []).map((item) => item.storage_path as string);
        if (paths.length) {
            const { error: storageError } = await client.storage.from('coach-record-media').remove(paths);
            throwIfError(storageError);
        }
        const { error } = await client.from('coach_records').delete().eq('id', recordId);
        throwIfError(error);
    },

    async uploadCoachRecordMedia(recordId: string, drafts: CoachRecordMediaDraft[]) {
        if (!drafts.length) return;
        const client = requireSupabase();
        const { data: identity, error: identityError } = await client.auth.getUser();
        throwIfError(identityError);
        if (!identity.user) throw new Error('Your session has expired. Please sign in again.');
        const rows = [];
        const uploadedPaths: string[] = [];
        try {
            for (const draft of drafts) {
                const extension = draft.file.name.split('.').pop()?.toLowerCase() || (draft.kind === 'image' ? 'jpg' : 'mp4');
                const path = `${identity.user.id}/${recordId}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await client.storage.from('coach-record-media').upload(path, draft.file, { contentType: draft.file.type, upsert: false });
                throwIfError(uploadError);
                uploadedPaths.push(path);
                rows.push({ coach_record_id: recordId, storage_path: path, media_type: draft.kind, original_name: draft.file.name, mime_type: draft.file.type, file_size_bytes: draft.file.size, pose_landmarks: draft.kind === 'video' && draft.poseFrames?.length ? { frames: draft.poseFrames } : draft.landmarks, annotations: draft.annotations });
            }
            const { error } = await client.from('coach_record_media').insert(rows);
            throwIfError(error);
        } catch (error) {
            if (uploadedPaths.length) await client.storage.from('coach-record-media').remove(uploadedPaths);
            throw error;
        }
    },

    async loadCoachRecordMedia(recordIds: string[]): Promise<CoachRecordMedia[]> {
        if (!recordIds.length) return [];
        const client = requireSupabase();
        const { data, error } = await client.from('coach_record_media').select('id, coach_record_id, storage_path, media_type, original_name, mime_type, file_size_bytes, pose_landmarks, annotations, created_at').in('coach_record_id', recordIds).order('created_at', { ascending: true });
        throwIfError(error);
        return Promise.all((data ?? []).map(async (media) => {
            const { data: signed, error: signedError } = await client.storage.from('coach-record-media').createSignedUrl(media.storage_path, 60 * 60);
            throwIfError(signedError);
            return { ...media, signed_url: signed.signedUrl } as CoachRecordMedia;
        }));
    },

    async inviteStudent(fullName: string, email: string) {
        return this.createStudent({ full_name: fullName, email, date_of_birth: null, gender: null, level: null, dominant_hand: null, dominant_eye: null, racket_brand: null, racket_model: null, racket_string: null, racket_head_size_sq_in: null, racket_weight_g: null, racket_string_tension_lbs: null, shoes_used: null, goals: null, restrictions: null, last_lesson_at: null });
    },

    async createStudent(input: StudentProfileInput): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.functions.invoke('invite-student', { body: { fullName: input.full_name, email: input.email, profile: input } });
        if (error) {
            const context = (error as { context?: unknown }).context;
            const details = context && typeof (context as { json?: unknown }).json === 'function'
                ? await (context as { json: () => Promise<unknown> }).json().catch(() => null) as { error?: string } | null
                : context as { error?: string } | null;
            throw new Error(details?.error || error.message);
        }
        if (!data?.student) throw new Error('The invitation could not be created.');
        return data.student as Student;
    },

    async loadStudentContext() {
        const client = requireSupabase();
        const { error: activationError } = await client.rpc('activate_my_student_account');
        throwIfError(activationError);
        const { data: student, error: studentError } = await client.from('students').select(STUDENT_FIELDS).single();
        throwIfError(studentError);
        const studentId = student.id as string;
        const { data: coachRecords, error: coachRecordsError } = await client.from('coach_records')
            .select(COACH_RECORD_FIELDS)
            .eq('student_id', studentId)
            .eq('is_published', true)
            .order('published_at', { ascending: false });
        throwIfError(coachRecordsError);
        return { student: student as Student, coachRecords: (coachRecords ?? []) as CoachRecord[] };
    },

    async loadStudentPortfolio(): Promise<{ snapshots: StudentPortfolioSnapshot[]; evidence: StudentPortfolioEvidence[]; reports: GrowthReportSnapshot[] }> {
        const client = requireSupabase();
        const { data: reports, error: reportError } = await client.from('growth_report_snapshots')
            .select('id, student_id, capability_snapshot_id, title, report_content, status, published_at, created_at, updated_at')
            .eq('status', 'published')
            .order('published_at', { ascending: false });
        throwIfError(reportError);

        const snapshotIds = [...new Set((reports ?? []).map((report) => report.capability_snapshot_id as string | null).filter((id): id is string => Boolean(id)))];
        if (!snapshotIds.length) return { snapshots: [], evidence: [], reports: (reports ?? []) as GrowthReportSnapshot[] };

        const { data: snapshots, error: snapshotError } = await client.from('capability_assessment_snapshots')
            .select('id, capability_scores, assessed_at')
            .in('id', snapshotIds)
            .order('assessed_at', { ascending: true });
        throwIfError(snapshotError);

        const { data: evidence, error: evidenceError } = await client.from('capability_snapshot_sources')
            .select('id, capability_snapshot_id, source_coach_record_id, source_coach_record_media_id, source_student_assessment_id, created_at')
            .in('capability_snapshot_id', snapshotIds)
            .order('created_at', { ascending: true });
        throwIfError(evidenceError);
        return { snapshots: (snapshots ?? []) as StudentPortfolioSnapshot[], evidence: (evidence ?? []) as StudentPortfolioEvidence[], reports: (reports ?? []) as GrowthReportSnapshot[] };
    },

    async updateMyStudentProfile(input: StudentSelfProfileInput): Promise<Student> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('update_my_student_profile', {
            next_age_range: input.age_range,
            next_gender: input.gender,
            next_dominant_hand: input.dominant_hand,
            next_dominant_eye: input.dominant_eye,
            next_goals: input.goals,
            next_restrictions: input.restrictions,
        });
        throwIfError(error);
        return data as Student;
    },

    async loadStudentAssessments(): Promise<{ assessments: StudentAssessment[]; attempts: AssessmentAttempt[]; evidence: AssessmentEvidence[] }> {
        const client = requireSupabase();
        const { data: assessments, error: assessmentError } = await client.from('student_assessments').select(ASSESSMENT_FIELDS).eq('is_published', true).order('created_at', { ascending: false });
        throwIfError(assessmentError);
        const assessmentIds = (assessments ?? []).map((assessment) => assessment.id as string);
        if (!assessmentIds.length) return { assessments: [], attempts: [], evidence: [] };
        const [{ data: attempts, error: attemptError }, { data: evidence, error: evidenceError }] = await Promise.all([
            client.from('assessment_attempts').select('id, student_assessment_id, result_value, score, notes, created_at').in('student_assessment_id', assessmentIds).order('created_at', { ascending: false }),
            client.from('assessment_evidence').select('id, student_assessment_id, external_url, label, notes, created_at').in('student_assessment_id', assessmentIds).order('created_at', { ascending: false }),
        ]);
        throwIfError(attemptError);
        throwIfError(evidenceError);
        return { assessments: assessments as StudentAssessment[], attempts: (attempts ?? []) as AssessmentAttempt[], evidence: (evidence ?? []) as AssessmentEvidence[] };
    },

    async updateMyAssessmentReflection(assessmentId: string, reflection: string): Promise<StudentAssessment> {
        const client = requireSupabase();
        const { data, error } = await client.rpc('update_my_assessment_reflection', { assessment_id: assessmentId, reflection });
        throwIfError(error);
        return data as StudentAssessment;
    },

    async loadStudentHomework(): Promise<{ assignments: HomeworkAssignment[]; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[] }> {
        const client = requireSupabase();
        const { data: assignments, error: assignmentsError } = await client.from('homework_assignments')
            .select(HOMEWORK_FIELDS)
            .eq('is_published', true)
            .order('due_at', { ascending: true, nullsFirst: false });
        throwIfError(assignmentsError);
        const assignmentIds = (assignments ?? []).map((assignment) => assignment.id as string);
        if (!assignmentIds.length) return { assignments: [], evidence: [], resources: [] };
        const { data: evidenceRows, error: evidenceError } = await client.from('homework_evidence')
            .select('id, homework_assignment_id, storage_path, original_name, mime_type, file_size_bytes, created_at')
            .in('homework_assignment_id', assignmentIds)
            .order('created_at', { ascending: true });
        throwIfError(evidenceError);
        const evidence = await Promise.all((evidenceRows ?? []).map(async (row) => {
            const { data: signed, error: signedError } = await client.storage.from('homework-evidence').createSignedUrl(row.storage_path, 60 * 60);
            throwIfError(signedError);
            return { ...row, signed_url: signed.signedUrl } as HomeworkEvidence;
        }));
        const { data: resourceRows, error: resourceError } = await client.from('homework_resource_media')
            .select('id, homework_assignment_id, storage_path, media_type, original_name, mime_type, file_size_bytes, created_at')
            .in('homework_assignment_id', assignmentIds)
            .order('created_at', { ascending: true });
        throwIfError(resourceError);
        const resources = await Promise.all((resourceRows ?? []).map(async (row) => {
            const { data: signed, error: signedError } = await client.storage.from('homework-resources').createSignedUrl(row.storage_path, 60 * 60);
            throwIfError(signedError);
            return { ...row, signed_url: signed.signedUrl } as HomeworkResourceMedia;
        }));
        return { assignments: assignments as HomeworkAssignment[], evidence, resources };
    },

    async completeStudentHomework(homeworkId: string, reflection: string, files: File[]): Promise<void> {
        const client = requireSupabase();
        const { data: assignment, error: completionError } = await client.rpc('complete_my_homework', { homework_id: homeworkId, reflection });
        throwIfError(completionError);
        const studentId = (assignment as HomeworkAssignment).student_id;
        const uploadedPaths: string[] = [];
        try {
            const evidenceRows = [];
            for (const file of files) {
                const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
                const path = `${studentId}/${homeworkId}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await client.storage.from('homework-evidence').upload(path, file, { contentType: file.type, upsert: false });
                throwIfError(uploadError);
                uploadedPaths.push(path);
                evidenceRows.push({ homework_assignment_id: homeworkId, student_id: studentId, storage_path: path, original_name: file.name, mime_type: file.type, file_size_bytes: file.size });
            }
            if (evidenceRows.length) {
                const { error: evidenceError } = await client.from('homework_evidence').insert(evidenceRows);
                throwIfError(evidenceError);
            }
        } catch (error) {
            if (uploadedPaths.length) await client.storage.from('homework-evidence').remove(uploadedPaths);
            throw error;
        }
    },

    async createStudentRecord(studentId: string, title: string, body: string, files: File[] = []) {
        const client = requireSupabase();
        const { data: record, error } = await client.from('student_records').insert({ student_id: studentId, title, body }).select('id').single();
        throwIfError(error);
        const uploadedPaths: string[] = [];
        try {
            const mediaRows = [];
            for (const file of files) {
                const extension = file.name.split('.').pop()?.toLowerCase() || (file.type.startsWith('image/') ? 'jpg' : 'mp4');
                const path = `${studentId}/${record.id}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await client.storage.from('student-record-media').upload(path, file, { contentType: file.type, upsert: false });
                throwIfError(uploadError);
                uploadedPaths.push(path);
                mediaRows.push({ student_record_id: record.id, storage_path: path, media_type: file.type.startsWith('image/') ? 'image' : 'video', original_name: file.name, mime_type: file.type, file_size_bytes: file.size });
            }
            if (mediaRows.length) {
                const { error: mediaError } = await client.from('student_record_media').insert(mediaRows);
                throwIfError(mediaError);
            }
        } catch (uploadError) {
            if (uploadedPaths.length) await client.storage.from('student-record-media').remove(uploadedPaths);
            await client.from('student_records').delete().eq('id', record.id);
            throw uploadError;
        }
    },

    async loadMyStudentRecords(): Promise<StudentRecord[]> {
        const client = requireSupabase();
        const { data, error } = await client.from('student_records').select('id, student_id, title, body, created_at').order('created_at', { ascending: false });
        throwIfError(error);
        return (data ?? []) as StudentRecord[];
    },

    async loadStudentRecordMedia(recordIds: string[]): Promise<StudentRecordMedia[]> {
        if (!recordIds.length) return [];
        const client = requireSupabase();
        const { data, error } = await client.from('student_record_media').select('id, student_record_id, storage_path, media_type, original_name').in('student_record_id', recordIds).order('created_at', { ascending: true });
        throwIfError(error);
        return Promise.all((data ?? []).map(async (media) => {
            const { data: signed, error: signedError } = await client.storage.from('student-record-media').createSignedUrl(media.storage_path, 60 * 60);
            throwIfError(signedError);
            return { ...media, signed_url: signed.signedUrl } as StudentRecordMedia;
        }));
    },
};