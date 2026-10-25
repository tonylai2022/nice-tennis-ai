import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, Check, CircleUserRound, Clock3, CreditCard, Mic, Plus, Search, UsersRound, X, Zap } from 'lucide-react';
import { CAPABILITY_DIMENSIONS, coachCRMService, CRM_OAUTH_ROLE_KEY, type AssessmentAttempt, type AssessmentChallengeType, type AssessmentEvidence, type AssessmentStatus, type AttendanceStatus, type CapabilityAssessmentSnapshot, type CapabilityDimension, type CapabilityScores, type ClassSession, type ClassSessionStudent, type CoachRecord, type CoachRecordInput, type CoachRecordMedia, type CRMProfile, type GrowthReportContent, type GrowthReportSnapshot, type HomeworkAssignment, type HomeworkEvidence, type HomeworkResourceMedia, type Lesson, type LessonPackage, type PaymentStatus, type Student, type StudentAssessment, type StudentPortfolioEvidence, type StudentPortfolioSnapshot, type StudentProfileInput, type StudentRecord, type StudentRecordMedia, type StudentScheduleItem, type StudentSelfProfileInput } from '../services/CoachCRMService';
import { CoachMediaWorkbench, drawAnnotation, drawSkeleton, type WorkbenchAnnotation, type WorkbenchMediaDraft } from './CoachMediaWorkbench';
import { FinancialDashboard } from './FinancialDashboard';
import { NotificationSettings } from './NotificationSettings';
import { ScheduleCalendar } from './ScheduleCalendar';
import { isCrmTranslatableAttribute, translateCrmText } from '../lib/crmTranslations';
import { mediaPipeVideoPoseService } from '../services/pose/MediaPipeVideoPoseService';
import { StudentVideoAIFeedback, type AIFeedbackPublishPayload } from './StudentVideoAIFeedback';

interface CoachCRMHomeProps {
    onAccountChange: (account: CRMProfile | null) => void;
    language: 'en' | 'zh';
    onToggleLanguage: () => void;
}

type NoticeState = { text: string; tone: 'success' | 'error' } | null;
type CoachPanel = 'schedule' | 'student-overview' | 'directory' | 'feedback' | 'log' | 'homework' | 'assessment' | 'growth-portfolio';
type StudentPanel = 'growth-profile' | 'schedule' | 'feedback' | 'homework' | 'assessment' | 'growth-portfolio';
type MobileSheetState = { mode: 'quick-note'; studentId: string } | { mode: 'add-student' } | null;
type MobileStudentView = 'actions' | 'profile' | 'payment' | 'log' | 'history' | 'report' | 'report-history' | null;

const COACH_PANEL_PATHS: Record<CoachPanel, string> = {
    schedule: '/dashboard/schedule',
    'student-overview': '/dashboard/students/overview',
    directory: '/dashboard/students',
    feedback: '/dashboard/feedback',
    log: '/dashboard/log',
    homework: '/dashboard/homework',
    assessment: '/dashboard/assessments',
    'growth-portfolio': '/dashboard',
};

const STUDENT_PANEL_PATHS: Record<StudentPanel, string> = {
    'growth-profile': '/dashboard/log',
    schedule: '/dashboard/schedule',
    feedback: '/dashboard/log',
    homework: '/dashboard/homework',
    assessment: '/dashboard/assessments',
    'growth-portfolio': '/dashboard/about',
};

function panelFromPath<T extends string>(paths: Record<T, string>, fallback: T): T {
    const pathname = window.location.pathname.replace(/\/$/, '') || '/';
    return (Object.entries(paths).find(([, path]) => path === pathname)?.[0] as T | undefined) ?? fallback;
}

function pushPanelPath(pathname: string) {
    if (window.location.pathname !== pathname) {
        window.history.pushState({}, '', `${pathname}${window.location.search}${window.location.hash}`);
    }
}

const messageFrom = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

async function aiFeedbackFramesToDrafts(payload: AIFeedbackPublishPayload, sourceName: string): Promise<WorkbenchMediaDraft[]> {
    const safeSourceName = sourceName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || 'video';
    return Promise.all(payload.frames.map(async (frame, index) => {
        const response = await fetch(frame.imageUrl);
        if (!response.ok) throw new Error('One of the AI feedback frames could not be prepared for upload.');
        const blob = await response.blob();
        const file = new File([blob], `${safeSourceName}-${index + 1}-${frame.key}.jpg`, { type: 'image/jpeg' });
        return { id: crypto.randomUUID(), file, url: frame.imageUrl, kind: 'image' as const, landmarks: null, poseFrames: [], annotations: [] };
    }));
}

export function CoachCRMHome({ onAccountChange, language, onToggleLanguage }: CoachCRMHomeProps) {
    const [profile, setProfile] = useState<CRMProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<NoticeState>(null);
    const pageRef = useRef<HTMLElement>(null);
    const textSources = useRef(new WeakMap<Text, string>());
    const attributeSources = useRef(new WeakMap<Element, Map<string, string>>());

    useEffect(() => {
        const root = pageRef.current;
        if (!root) return;
        let isUpdating = false;
        const translate = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const textNode = node as Text;
                if ((textNode.parentElement as Element | null)?.closest('.crm-language-toggle, .app-language-toggle')) return;
                const source = textSources.current.get(textNode) ?? textNode.data;
                const translated = translateCrmText(source, language);
                if (language === 'en' && !/[\u4e00-\u9fa5]/.test(translated)) {
                    textSources.current.set(textNode, translated);
                } else if (language === 'zh' && !/[\u4e00-\u9fa5]/.test(source)) {
                    textSources.current.set(textNode, source);
                }
                if (textNode.data !== translated) textNode.data = translated;
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const element = node as Element;
            if (element.closest('.crm-language-toggle, .app-language-toggle')) return;
            for (const attribute of Array.from(element.attributes)) {
                if (!isCrmTranslatableAttribute(attribute.name)) continue;
                const sources = attributeSources.current.get(element) ?? new Map<string, string>();
                const source = sources.get(attribute.name) ?? attribute.value;
                const translated = translateCrmText(source, language);
                if (language === 'en' && !/[\u4e00-\u9fa5]/.test(translated)) {
                    sources.set(attribute.name, translated);
                } else if (language === 'zh' && !/[\u4e00-\u9fa5]/.test(source)) {
                    sources.set(attribute.name, source);
                }
                attributeSources.current.set(element, sources);
                if (attribute.value !== translated) element.setAttribute(attribute.name, translated);
            }
            Array.from(element.childNodes).forEach(translate);
        };
        const refresh = () => {
            isUpdating = true;
            translate(root);
            isUpdating = false;
        };
        const observer = new MutationObserver((mutations) => {
            if (isUpdating) return;
            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData' || mutation.type === 'attributes') translate(mutation.target);
                else mutation.addedNodes.forEach(translate);
            });
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
        refresh();
        return () => observer.disconnect();
    }, [language]);

    const updateAccount = (account: CRMProfile | null) => {
        setProfile(account);
        onAccountChange(account);
    };

    const refreshSession = async () => {
        if (!coachCRMService.isConfigured()) {
            setLoading(false);
            return;
        }

        try {
            const session = await coachCRMService.getSession();
            if (!session) {
                updateAccount(null);
                return;
            }

            const url = new URL(window.location.href);
            const storedRole = sessionStorage.getItem(CRM_OAUTH_ROLE_KEY);
            const requestedRole = url.searchParams.get('crmRole') ?? storedRole;
            const nextProfile = requestedRole === 'coach' || requestedRole === 'student'
                ? await coachCRMService.completeGoogleSignIn(requestedRole)
                : await coachCRMService.loadProfile(session.user.id);

            if (!requestedRole && nextProfile.role === 'student') {
                await coachCRMService.linkMyStudentAccount();
            }

            if (requestedRole) {
                sessionStorage.removeItem(CRM_OAUTH_ROLE_KEY);
                url.searchParams.delete('crmRole');
                window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
            }
            updateAccount(nextProfile);
        } catch (error) {
            setNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void refreshSession(); }, []);

    useEffect(() => {
        if (!notice) return;
        const timeoutId = window.setTimeout(() => setNotice(null), 2000);
        return () => window.clearTimeout(timeoutId);
    }, [notice]);

    const signOut = async () => {
        try {
            await coachCRMService.signOut();
            updateAccount(null);
            setNotice({ text: 'You have been signed out.', tone: 'success' });
        } catch (error) {
            setNotice({ text: messageFrom(error), tone: 'error' });
        }
    };

    if (loading) {
        return <section className="crm-page crm-loading" aria-label="Loading workspace"><span className="crm-loader" /><p>Opening your workspace</p></section>;
    }

    if (!coachCRMService.isConfigured()) return <SetupNotice />;

    return <section ref={pageRef} className="crm-page" aria-label="Nice Tennis CRM">
        {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
        {!profile && <AuthPanel onNotice={setNotice} onAuthenticated={() => void refreshSession()} />}
        {profile?.role === 'coach' && <CoachWorkspace profile={profile} onNotice={setNotice} onSignOut={() => void signOut()} language={language} onToggleLanguage={onToggleLanguage} />}
        {profile?.role === 'student' && <StudentWorkspace profile={profile} onNotice={setNotice} onSignOut={() => void signOut()} language={language} onToggleLanguage={onToggleLanguage} />}
    </section>;
}

function SetupNotice() {
    return <section className="crm-page"><div className="crm-setup"><p className="crm-eyebrow">Configuration needed</p><h1>Connect the secure coaching workspace.</h1><p>Set the Supabase URL and anon key, run the CRM migration, then enable Google Auth. No student or coaching data is stored in this browser.</p></div></section>;
}

function AuthPanel({ onNotice, onAuthenticated }: { onNotice: (notice: NoticeState) => void; onAuthenticated: () => void }) {
    const [startingRole, setStartingRole] = useState<'coach' | 'student' | null>(null);
    const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
    const [role, setRole] = useState<'coach' | 'student'>('coach');
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [confirmationRequired, setConfirmationRequired] = useState(false);
    const continueWithGoogle = async (role: 'coach' | 'student') => {
        setStartingRole(role);
        try {
            await coachCRMService.signInWithGoogle(role);
        } catch (error) {
            setStartingRole(null);
            onNotice({ text: messageFrom(error), tone: 'error' });
        }
    };

    const useAnotherAccount = async () => {
        try {
            await coachCRMService.signOut();
            onNotice({ text: 'Signed out. Choose the Google account you want to use.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        }
    };

    const submitCredentials = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (mode === 'sign-up' && !fullName.trim()) return onNotice({ text: 'Enter your name to create an account.', tone: 'error' });
        if (password.length < 6) return onNotice({ text: 'Use a password with at least 6 characters.', tone: 'error' });
        setSubmitting(true); setConfirmationRequired(false);
        try {
            if (mode === 'sign-in') { await coachCRMService.signInWithPassword(email, password); onAuthenticated(); }
            else {
                const signedIn = await coachCRMService.signUpWithPassword(role, fullName, email, password);
                if (signedIn) onAuthenticated(); else onNotice({ text: 'Account created. Check your email to confirm your address, then sign in.', tone: 'success' });
            }
        } catch (error) {
            const message = messageFrom(error);
            if (/email not confirmed/i.test(message)) { setConfirmationRequired(true); onNotice({ text: 'Confirm your email before signing in. Check your inbox or resend the confirmation below.', tone: 'error' }); }
            else onNotice({ text: message, tone: 'error' });
        } finally { setSubmitting(false); }
    };

    const resendConfirmation = async () => {
        if (!email.trim()) return;
        setSubmitting(true);
        try { await coachCRMService.resendEmailConfirmation(email); onNotice({ text: 'Confirmation email sent. Open it, then return here to sign in.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { setSubmitting(false); }
    };

    return <div className="crm-auth crm-auth-simple">
        <div className="crm-auth-intro">
            <img className="crm-auth-logo" src="/images/NT_logo.png" alt="Nice Tennis" />
            <h1>Your tennis coaching, in one place.</h1>
            <p>Lessons, practice logs, and progress reports.</p>
        </div>
        <div className="crm-auth-actions">
            <article className="crm-login-card crm-login-coach">
                <p className="crm-eyebrow">Welcome</p>
                <h2>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</h2>
                <div className="crm-auth-mode"><button type="button" data-active={mode === 'sign-in'} onClick={() => setMode('sign-in')}>Sign in</button><button type="button" data-active={mode === 'sign-up'} onClick={() => setMode('sign-up')}>Sign up</button></div>
                <form className="crm-credential-form" onSubmit={submitCredentials}>
                    {mode === 'sign-up' && <Field label="Name" value={fullName} onChange={setFullName} required />}
                    {mode === 'sign-up' && <div className="crm-auth-mode"><button type="button" data-active={role === 'coach'} onClick={() => setRole('coach')}>Coach</button><button type="button" data-active={role === 'student'} onClick={() => setRole('student')}>Student</button></div>}
                    <Field label="Email" type="email" value={email} onChange={setEmail} required />
                    <Field label="Password" type="password" value={password} onChange={setPassword} required />
                    <button disabled={submitting} className="crm-button crm-button-primary">{submitting ? 'Please wait...' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
                </form>
                {confirmationRequired && <div className="crm-auth-confirmation"><strong>Email confirmation required</strong><span>Open the verification email sent to {email}, then sign in.</span><button type="button" disabled={submitting} onClick={() => void resendConfirmation()}>Resend confirmation email</button></div>}
                <p className="crm-auth-divider">or continue with Google</p>
                <button type="button" disabled={startingRole !== null} onClick={() => void continueWithGoogle('coach')} className="crm-button crm-button-primary">
                    {startingRole === 'coach' ? 'Opening Google...' : 'Coach sign in'}
                </button>
                <button type="button" disabled={startingRole !== null} onClick={() => void continueWithGoogle('student')} className="crm-button crm-button-secondary">
                    {startingRole === 'student' ? 'Opening Google...' : 'Student sign in'}
                </button>
            </article>
        </div>
    </div>;
}

function CoachWorkspace({ profile, onNotice, onSignOut, language, onToggleLanguage }: { profile: CRMProfile; onNotice: (notice: NoticeState) => void; onSignOut: () => void; language: 'en' | 'zh'; onToggleLanguage: () => void }) {
    const [students, setStudents] = useState<Student[]>([]);
    const [records, setRecords] = useState<CoachRecord[]>([]);
    const [recordMedia, setRecordMedia] = useState<CoachRecordMedia[]>([]);
    const [studentFeedback, setStudentFeedback] = useState<StudentRecord[]>([]);
    const [studentFeedbackMedia, setStudentFeedbackMedia] = useState<StudentRecordMedia[]>([]);
    const [homework, setHomework] = useState<HomeworkAssignment[]>([]);
    const [homeworkEvidence, setHomeworkEvidence] = useState<HomeworkEvidence[]>([]);
    const [homeworkResources, setHomeworkResources] = useState<HomeworkResourceMedia[]>([]);
    const [assessments, setAssessments] = useState<StudentAssessment[]>([]);
    const [assessmentAttempts, setAssessmentAttempts] = useState<AssessmentAttempt[]>([]);
    const [assessmentEvidence, setAssessmentEvidence] = useState<AssessmentEvidence[]>([]);
    const [capabilitySnapshots, setCapabilitySnapshots] = useState<CapabilityAssessmentSnapshot[]>([]);
    const [growthReports, setGrowthReports] = useState<GrowthReportSnapshot[]>([]);
    const [classSessions, setClassSessions] = useState<ClassSession[]>([]);
    const [classSessionStudents, setClassSessionStudents] = useState<ClassSessionStudent[]>([]);
    const [lessons, setLessons] = useState<Lesson[]>([]);
    const [lessonPackages, setLessonPackages] = useState<LessonPackage[]>([]);
    const [studentId, setStudentId] = useState('');
    const [studentSearch, setStudentSearch] = useState('');
    const [rosterFilter, setRosterFilter] = useState<'all' | 'active' | 'inactive' | 'archived'>('all');
    const [levelFilter, setLevelFilter] = useState('all');
    const [genderFilter, setGenderFilter] = useState('all');
    const [handFilter, setHandFilter] = useState('all');
    const [ageFilter, setAgeFilter] = useState('all');
    const [rosterLoading, setRosterLoading] = useState(true);
    const [recordTitle, setRecordTitle] = useState('');
    const [recordBody, setRecordBody] = useState('');
    const [recordLessonDate, setRecordLessonDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [recordSkill, setRecordSkill] = useState('');
    const [recordFocusArea, setRecordFocusArea] = useState('');
    const [recordEvidenceLinks, setRecordEvidenceLinks] = useState('');
    const [mediaDrafts, setMediaDrafts] = useState<WorkbenchMediaDraft[]>([]);
    const [aiFeedbackPayload, setAIFeedbackPayload] = useState<AIFeedbackPublishPayload | null>(null);
    const [publish, setPublish] = useState(true);
    const [homeworkTitle, setHomeworkTitle] = useState('');
    const [homeworkInstructions, setHomeworkInstructions] = useState('');
    const [homeworkDueAt, setHomeworkDueAt] = useState('');
    const [homeworkStudentIds, setHomeworkStudentIds] = useState<string[]>([]);
    const [homeworkCategory, setHomeworkCategory] = useState('');
    const [homeworkResourceFiles, setHomeworkResourceFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [activePanel, setActivePanel] = useState<CoachPanel>(() => panelFromPath(COACH_PANEL_PATHS, 'directory'));
    const [mobileSheet, setMobileSheet] = useState<MobileSheetState>(null);
    const [mobileStudentView, setMobileStudentView] = useState<MobileStudentView>(null);
    const [logStudentIds, setLogStudentIds] = useState<string[]>([]);
    const [logNote, setLogNote] = useState('');

    const openPanel = useCallback((panel: CoachPanel) => {
        setActivePanel(panel);
        pushPanelPath(COACH_PANEL_PATHS[panel]);
    }, []);

    useEffect(() => {
        const handlePopState = () => setActivePanel(panelFromPath(COACH_PANEL_PATHS, 'directory'));
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const load = async () => {
        setRosterLoading(true);
        try {
            const [nextStudents, nextRecords, nextStudentFeedback, nextHomework, nextAssessments, nextPortfolio, nextSchedule, nextLessons, nextLessonPackages] = await Promise.all([
                coachCRMService.loadCoachStudents(),
                coachCRMService.loadCoachRecords(),
                coachCRMService.loadCoachStudentRecords(),
                coachCRMService.loadCoachHomework(),
                coachCRMService.loadCoachAssessments(),
                coachCRMService.loadCoachPortfolio(),
                coachCRMService.loadClassSchedule(),
                coachCRMService.loadLessons(),
                coachCRMService.loadLessonPackages(),
            ]);
            setStudents(nextStudents);
            setRecords(nextRecords);
            setStudentFeedback(nextStudentFeedback);
            setStudentFeedbackMedia(await coachCRMService.loadStudentRecordMedia(nextStudentFeedback.map((record) => record.id)));
            setHomework(nextHomework.assignments);
            setHomeworkEvidence(nextHomework.evidence);
            setHomeworkResources(nextHomework.resources);
            setAssessments(nextAssessments.assessments);
            setAssessmentAttempts(nextAssessments.attempts);
            setAssessmentEvidence(nextAssessments.evidence);
            setCapabilitySnapshots(nextPortfolio.snapshots);
            setGrowthReports(nextPortfolio.reports);
            setClassSessions(nextSchedule.sessions);
            setClassSessionStudents(nextSchedule.attendees);
            setLessons(nextLessons);
            setLessonPackages(nextLessonPackages);
            setRecordMedia(await coachCRMService.loadCoachRecordMedia(nextRecords.map((record) => record.id)));
            setStudentId((currentId) => currentId || '');
            setHomeworkStudentIds((currentIds) => currentIds.length ? currentIds.filter((id) => nextStudents.some((student) => student.id === id && !student.student_archived_at)) : nextStudents[0] ? [nextStudents[0].id] : []);
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setRosterLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    const saveRecord = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!studentId) return;
        if (publish && !window.confirm('Publish this feedback and its attachments to the student growth profile?')) return;
        setBusy(true);
        try {
            const body = aiFeedbackPayload ? `${recordBody.trim()}\n\n${aiFeedbackPayload.body}` : recordBody;
            const record = await coachCRMService.createCoachRecord(studentId, toCoachRecordInput({ title: recordTitle, body, lessonDate: recordLessonDate, skill: recordSkill, focusArea: recordFocusArea, evidenceLinks: recordEvidenceLinks }), publish);
            const aiDrafts = aiFeedbackPayload ? await aiFeedbackFramesToDrafts(aiFeedbackPayload, 'ai-feedback') : [];
            await coachCRMService.uploadCoachRecordMedia(record.id, [...mediaDrafts, ...aiDrafts]);
            const updatedStudent = await coachCRMService.markStudentLesson(studentId);
            setStudents((current) => current.map((student) => student.id === updatedStudent.id ? updatedStudent : student));
            setRecordTitle('');
            setRecordBody('');
            setRecordLessonDate(new Date().toISOString().slice(0, 10));
            setRecordSkill('');
            setRecordFocusArea('');
            setRecordEvidenceLinks('');
            setMediaDrafts([]);
            setAIFeedbackPayload(null);
            await load();
            onNotice({ text: publish ? 'Record published to the student.' : 'Private coaching record saved.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const updateDraftRecord = async (recordId: string, input: CoachRecordInput, publishRecord: boolean) => {
        if (publishRecord && !window.confirm('Publish this draft to the student growth profile?')) return;
        setBusy(true);
        try {
            await coachCRMService.updateCoachRecord(recordId, input, publishRecord);
            await load();
            onNotice({ text: publishRecord ? 'Draft published to the student.' : 'Draft updated.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
            throw error;
        } finally {
            setBusy(false);
        }
    };

    const deleteRecord = async (record: CoachRecord) => {
        if (!window.confirm(`Delete "${record.title}" and its attached media? This cannot be undone.`)) return;
        setBusy(true);
        try {
            await coachCRMService.deleteCoachRecord(record.id);
            await load();
            onNotice({ text: 'Feedback record and related media deleted.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const publishVideoAIFeedback = async (targetStudentId: string, sourceName: string, payload: AIFeedbackPublishPayload) => {
        setBusy(true);
        const input: CoachRecordInput = {
            title: payload.title,
            body: payload.body,
            lesson_date: new Date().toISOString().slice(0, 10),
            skill: 'Video analysis',
            focus_area: payload.priorityCue,
            evidence_links: [],
        };
        try {
            const record = await coachCRMService.createCoachRecord(targetStudentId, input, false);
            const drafts = await aiFeedbackFramesToDrafts(payload, sourceName);
            await coachCRMService.uploadCoachRecordMedia(record.id, drafts);
            await coachCRMService.updateCoachRecord(record.id, input, true);
            await load();
            onNotice({ text: 'AI feedback and all 3 frames published to the student.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
            throw error;
        } finally {
            setBusy(false);
        }
    };

    const saveHomework = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!homeworkStudentIds.length) {
            onNotice({ text: 'Select at least one student for this assignment.', tone: 'error' });
            return;
        }
        setBusy(true);
        try {
            const assignments = await coachCRMService.createCoachHomework(homeworkStudentIds, homeworkTitle.trim(), homeworkInstructions.trim(), homeworkDueAt ? new Date(homeworkDueAt).toISOString() : null, nullableText(homeworkCategory), homeworkResourceFiles);
            setHomeworkTitle('');
            setHomeworkInstructions('');
            setHomeworkDueAt('');
            setHomeworkCategory('');
            setHomeworkResourceFiles([]);
            await load();
            onNotice({ text: `Homework assigned to ${assignments.length} student${assignments.length === 1 ? '' : 's'}.`, tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const openQuickNote = (studentId: string) => {
        setStudentId(studentId);
        setMobileSheet({ mode: 'quick-note', studentId });
    };

    const startVoiceInput = (studentId: string) => {
        const speechWindow = window as typeof window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
        const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
        if (!Recognition) {
            onNotice({ text: 'Voice input is not available in this browser. Use Quick Note instead.', tone: 'error' });
            setStudentId(studentId);
            openPanel('feedback');
            return;
        }
        const recognition = new Recognition();
        recognition.lang = navigator.language || 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event: any) => {
            const transcript = event.results[0]?.[0]?.transcript?.trim();
            if (transcript) setRecordBody((current) => current ? `${current}\n${transcript}` : transcript);
            setStudentId(studentId);
            openPanel('feedback');
        };
        recognition.onerror = () => onNotice({ text: 'Voice input could not start. Try again or use Quick Note.', tone: 'error' });
        recognition.start();
    };

    const reviewHomework = async (homeworkId: string) => {
        setBusy(true);
        try {
            const updatedHomework = await coachCRMService.reviewCoachHomework(homeworkId);
            setHomework((current) => current.map((assignment) => assignment.id === updatedHomework.id ? updatedHomework : assignment));
            onNotice({ text: 'Homework marked as reviewed.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const saveMultiStudentLog = async () => {
        if (!logStudentIds.length) {
            onNotice({ text: 'Select at least one student to log.', tone: 'error' });
            return;
        }
        if (!logNote.trim()) {
            onNotice({ text: 'Add a note before saving.', tone: 'error' });
            return;
        }
        setBusy(true);
        try {
            await Promise.all(logStudentIds.map((nextStudentId) => coachCRMService.createCoachRecord(nextStudentId, { title: 'Quick court log', body: logNote.trim(), lesson_date: new Date().toISOString().slice(0, 10), skill: null, focus_area: null, evidence_links: [] }, false)));
            setLogNote('');
            setLogStudentIds([]);
            await load();
            onNotice({ text: 'Private court log saved.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const selectedStudent = students.find((student) => student.id === studentId) ?? null;
    const normalizedSearch = studentSearch.trim().toLowerCase();
    const visibleStudents = students.filter((student) => {
        const matchesSearch = !normalizedSearch || `${student.full_name} ${student.email}`.toLowerCase().includes(normalizedSearch);
        const status = getStudentActivityStatus(student);
        const age = getStudentAge(student.date_of_birth);
        const matchesAge = ageFilter === 'all' || (ageFilter === 'under-13' && age !== null && age < 13) || (ageFilter === '13-17' && age !== null && age >= 13 && age <= 17) || (ageFilter === '18-plus' && age !== null && age >= 18) || (ageFilter === 'unknown' && age === null);
        return matchesSearch && (rosterFilter === 'all' || status === rosterFilter) && (levelFilter === 'all' || student.level === levelFilter) && (genderFilter === 'all' || student.gender === genderFilter) && (handFilter === 'all' || student.dominant_hand === handFilter) && matchesAge;
    });
    const rosterSummary = getRosterSummary(students);
    const rosterLevels = [...new Set(students.map((student) => student.level).filter((level): level is string => Boolean(level)))].sort();
    const selectedPlayerFeedback = selectedStudent ? studentFeedback.filter((record) => record.student_id === selectedStudent.id) : [];
    const panelTitles: Record<CoachPanel, { eyebrow: string; title: string; detail: string }> = {
        schedule: language === 'zh' ? { eyebrow: '教练工作台', title: '日程', detail: '规划课程、训练时段和场地时间。' } : { eyebrow: 'Coach workspace', title: 'Schedule', detail: 'Plan lessons, sessions, and court time.' },
        'student-overview': language === 'zh' ? { eyebrow: '学员工作台', title: '学员概览', detail: '查看所选学员的教练记录和训练反馈。' } : { eyebrow: 'Student workspace', title: 'Student overview', detail: 'Review the selected student’s coaching records and practice reflections.' },
        directory: language === 'zh' ? { eyebrow: '学员工作台', title: '学员管理', detail: '维护学员名单和每节课所需的档案资料。' } : { eyebrow: 'Student workspace', title: 'Student management', detail: 'Maintain your roster and the profile details that guide each lesson.' },
        feedback: language === 'zh' ? { eyebrow: '课程工作台', title: '课后反馈', detail: '记录训练结果、辅助媒体和下一步练习。' } : { eyebrow: 'Lesson workspace', title: 'Feedback', detail: 'Capture a concise outcome, supporting media, and next practice step.' },
        log: language === 'zh' ? { eyebrow: '场上工作台', title: '日志', detail: '为一位或多位学员记录教练笔记。' } : { eyebrow: 'On-court workspace', title: 'Log', detail: 'Capture one coaching note for one or more students.' },
        homework: language === 'zh' ? { eyebrow: '练习工作台', title: '课后作业', detail: '布置并查看两节课之间的练习。' } : { eyebrow: 'Practice workspace', title: 'Homework', detail: 'Assign and review student practice between lessons.' },
        assessment: language === 'zh' ? { eyebrow: '进步工作台', title: '评估', detail: '设定里程碑并记录进步证据。' } : { eyebrow: 'Progress workspace', title: 'Assessment', detail: 'Set milestones and capture evidence of progress.' },
        'growth-portfolio': language === 'zh' ? { eyebrow: '教练工作台', title: '数据面板', detail: '查看学员名单、课程和训练进展。' } : { eyebrow: 'Coach workspace', title: 'Dashboard', detail: 'Review your roster, classes, and student progress.' },
    };
    const panelTitle = panelTitles[activePanel];

    return <div className="crm-app-layout crm-coach-layout">
        <WorkspaceNav role="coach" selectedStudent={selectedStudent} activePanel={activePanel} onPanelChange={(panel) => { openPanel(panel); if (panel === 'growth-portfolio') void load(); if (panel !== 'directory') setMobileStudentView(null); }} language={language} />
        <div className="crm-workspace">
            <MobileWorkspaceHeader profile={profile} onSignOut={onSignOut} language={language} onToggleLanguage={onToggleLanguage} />
            <header className={`crm-content-header${activePanel === 'directory' ? ' crm-directory-content-header' : ''}`}>
                <div><p className="crm-eyebrow">{panelTitle.eyebrow}</p><h1>{panelTitle.title}</h1><p>{panelTitle.detail}</p></div>
                <div className="crm-header-account"><span className="crm-avatar">{initials(profile.full_name)}</span><div><strong>{profile.full_name}</strong><small>{language === 'zh' ? '教练账户' : 'Coach account'}</small></div><button type="button" className="crm-language-toggle" onClick={onToggleLanguage}>{language === 'zh' ? 'EN' : '中文'}</button><button type="button" onClick={onSignOut}>{language === 'zh' ? '退出登录' : 'Sign out'}</button></div>
            </header>
            {activePanel === 'schedule' && <section className="crm-panel crm-single-panel"><div className="crm-schedule-reminder-bar"><div><p className="crm-eyebrow">Lesson reminders</p><span>Choose when this device receives booking alerts.</span></div><NotificationSettings className="crm-schedule-notification-button" /></div><ScheduleCalendar students={students.filter((student) => !student.student_archived_at)} lessons={lessons} language={language} onLessonsChange={setLessons} onStudentsChange={setStudents} onNotice={(text, tone) => onNotice({ text, tone })} /></section>}
            {activePanel === 'student-overview' && <section className="crm-panel crm-single-panel">
                <div className="crm-panel-heading"><div><p className="crm-eyebrow">Student overview</p><h2>Students</h2></div><span className="crm-count">{students.filter((student) => !student.student_archived_at).length}</span></div>
                <StudentOverviewCards students={students.filter((student) => !student.student_archived_at)} selectedId={studentId} onSelect={setStudentId} onOpenProfile={(nextStudentId) => { setStudentId(nextStudentId); openPanel('directory'); }} />
                {selectedStudent && <PlayerDesk student={selectedStudent} coachRecords={records} studentFeedback={selectedPlayerFeedback} recordMedia={recordMedia} assessments={assessments} attempts={assessmentAttempts} />}
            </section>}

            {activePanel === 'directory' && <section className="crm-panel crm-roster-panel crm-single-panel" data-mobile-student-detail-open={Boolean(mobileStudentView)}>
                <div className="crm-panel-heading"><div><p className="crm-eyebrow">Student management</p><h2>Roster and player profiles</h2></div><span className="crm-count">{students.length}</span></div>
                <div className="crm-roster-summary" aria-label="Roster summary"><Metric value={rosterSummary.active} label="Active" detail="Lesson in 30 days" /><Metric value={rosterSummary.inactive} label="Inactive" detail="No recent lesson" accent="amber" /><Metric value={rosterSummary.archived} label="Archived" detail="Access disabled" accent="sky" /><Metric value={rosterSummary.female + rosterSummary.male + rosterSummary.nonbinary} label="Profiled" detail={`${rosterSummary.female} female · ${rosterSummary.male} male`} /></div>
                <RosterInsights summary={rosterSummary} />
                <div className="crm-roster-tools"><label className="crm-search-field"><span><Search aria-hidden="true" />Find a student</span><input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search student by name..." /></label><FilterField label="Roster status" value={rosterFilter} onChange={(value) => setRosterFilter(value as typeof rosterFilter)} options={[['all', 'All students'], ['active', 'Active'], ['inactive', 'Inactive'], ['archived', 'Archived']]} /><FilterField label="Level" value={levelFilter} onChange={setLevelFilter} options={[['all', 'All levels'], ...rosterLevels.map((level) => [level, level] as [string, string])]} /><FilterField label="Gender" value={genderFilter} onChange={setGenderFilter} options={[['all', 'All genders'], ['female', 'Female'], ['male', 'Male'], ['nonbinary', 'Nonbinary'], ['prefer_not_to_say', 'Prefer not to say']]} /><FilterField label="Dominant hand" value={handFilter} onChange={setHandFilter} options={[['all', 'All hands'], ['right', 'Right'], ['left', 'Left']]} /><FilterField label="Age range" value={ageFilter} onChange={setAgeFilter} options={[['all', 'All ages'], ['under-13', 'Under 13'], ['13-17', '13-17'], ['18-plus', '18+'], ['unknown', 'Not recorded']]} /></div>
                <StudentList students={visibleStudents} selectedId={studentId} onSelect={(nextStudentId) => { setStudentId(nextStudentId); setMobileStudentView('actions'); }} onQuickNote={openQuickNote} onVoiceInput={startVoiceInput} coachRecords={records} studentFeedback={studentFeedback} loading={rosterLoading} emptyMessage={normalizedSearch || rosterFilter !== 'all' || levelFilter !== 'all' || genderFilter !== 'all' || handFilter !== 'all' || ageFilter !== 'all' ? 'No students match those filters.' : undefined} />
                {selectedStudent && mobileStudentView === 'actions' && <MobileStudentActions student={selectedStudent} onBack={() => setMobileStudentView(null)} onSelect={(view) => { if (view === 'log') setLogStudentIds([selectedStudent.id]); setMobileStudentView(view); }} />}
                {selectedStudent && mobileStudentView === 'profile' && <MobileStudentProfile student={selectedStudent} onBack={() => setMobileStudentView('actions')}><StudentProfileEditor student={selectedStudent} onSaved={(student) => setStudents((current) => current.map((item) => item.id === student.id ? student : item))} onArchive={async (student) => { await coachCRMService.archiveStudent(student.id); setStudents((current) => current.map((item) => item.id === student.id ? { ...item, invitation_status: 'disabled', student_archived_at: new Date().toISOString() } : item)); onNotice({ text: `${student.full_name} has been archived.`, tone: 'success' }); }} onRestore={async (student) => { const restoredStudent = await coachCRMService.restoreStudent(student.id); setStudents((current) => current.map((item) => item.id === restoredStudent.id ? restoredStudent : item)); onNotice({ text: `${student.full_name} has been restored.`, tone: 'success' }); }} /></MobileStudentProfile>}
                {selectedStudent && mobileStudentView === 'payment' && <StudentPaymentPage student={selectedStudent} packages={lessonPackages.filter((item) => item.student_id === selectedStudent.id)} lessons={lessons.filter((item) => item.student_id === selectedStudent.id)} language={language} onBack={() => setMobileStudentView('actions')} onRefresh={load} onPackagePurchased={(student) => { setStudents((current) => current.map((item) => item.id === student.id ? student : item)); void coachCRMService.loadLessonPackages().then(setLessonPackages); onNotice({ text: `${student.full_name} package added to their booking balance.`, tone: 'success' }); }} onNotice={onNotice} />}
                {selectedStudent && mobileStudentView === 'log' && <MobileStudentLog student={selectedStudent} onBack={() => setMobileStudentView('actions')}><form className="crm-record-form" onSubmit={saveRecord}><Field label="Lesson focus" value={recordTitle} onChange={setRecordTitle} required /><TextArea label="Feedback and next practice step" value={recordBody} onChange={setRecordBody} placeholder="What improved today, what to practice, and what to revisit next lesson." required /><label className="crm-field">Lesson date<input type="date" value={recordLessonDate} onChange={(event) => setRecordLessonDate(event.target.value)} /></label><TextArea label="Evidence links" value={recordEvidenceLinks} onChange={setRecordEvidenceLinks} placeholder="One https:// link per line." /><CoachMediaWorkbench onChange={setMediaDrafts} onUseSuggestion={(suggestion) => setRecordBody((current) => current ? `${current}\n\n${suggestion}` : suggestion)} onAIFeedbackChange={setAIFeedbackPayload} /><label className="crm-publish-toggle"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /><span><strong>Share with student & family</strong><small>Only published records appear in the player growth profile.</small></span></label><button disabled={busy} className="crm-button crm-button-primary">{publish ? 'Publish feedback' : 'Save private log'}</button></form></MobileStudentLog>}
                {selectedStudent && mobileStudentView === 'history' && <MobileStudentLogHistory student={selectedStudent} records={records.filter((record) => record.student_id === selectedStudent.id)} studentRecords={selectedPlayerFeedback} media={recordMedia} studentMedia={studentFeedbackMedia} busy={busy} onSave={updateDraftRecord} onDelete={deleteRecord} onPublishAI={(record, media, payload) => publishVideoAIFeedback(record.student_id, media.original_name, payload)} onBack={() => setMobileStudentView('actions')} />}
                {selectedStudent && mobileStudentView === 'report' && <MobileStudentReport student={selectedStudent} coachRecords={records.filter((record) => record.student_id === selectedStudent.id)} studentRecords={selectedPlayerFeedback} reports={growthReports.filter((report) => report.student_id === selectedStudent.id)} snapshots={capabilitySnapshots.filter((snapshot) => snapshot.student_id === selectedStudent.id)} onRefresh={load} onNotice={onNotice} onBack={() => setMobileStudentView('actions')} />}
                {selectedStudent && mobileStudentView === 'report-history' && <MobileStudentReportHistory student={selectedStudent} reports={growthReports.filter((report) => report.student_id === selectedStudent.id)} snapshots={capabilitySnapshots.filter((snapshot) => snapshot.student_id === selectedStudent.id)} onRefresh={load} onNotice={onNotice} onBack={() => setMobileStudentView('actions')} />}
                {!mobileStudentView && <><StudentProfileCreateForm onCreated={(student) => { setStudents((current) => [student, ...current]); setStudentId(student.id); onNotice({ text: `${student.full_name} can now sign in with ${student.email}.`, tone: 'success' }); }} /><button type="button" className="crm-add-student-fab" aria-label="Add new student" onClick={() => setMobileSheet({ mode: 'add-student' })}><Plus aria-hidden="true" /></button></>}
            </section>}

            {activePanel === 'feedback' && <section className="crm-panel crm-record-panel crm-single-panel">
                {selectedStudent && <SelectedPlayerContext student={selectedStudent} />}
                <div className="crm-panel-heading"><div><p className="crm-eyebrow">Lesson feedback</p><h2>{selectedStudent ? `Feedback for ${selectedStudent.full_name}` : 'Choose a student first'}</h2></div>{selectedStudent && <span className="crm-selected-player">Selected student</span>}</div>
                <form className="crm-record-form" onSubmit={saveRecord}>
                    <Field label="Lesson focus" value={recordTitle} onChange={setRecordTitle} required />
                    <TextArea label="Feedback and next practice step" value={recordBody} onChange={setRecordBody} placeholder="What improved today, what to practice, and what to revisit next lesson." required />
                    <div className="crm-feedback-tag-grid"><label className="crm-field">Lesson date<input type="date" value={recordLessonDate} onChange={(event) => setRecordLessonDate(event.target.value)} /></label><Field label="Skill" value={recordSkill} onChange={setRecordSkill} /><Field label="Focus area" value={recordFocusArea} onChange={setRecordFocusArea} /><TextArea label="Evidence links" value={recordEvidenceLinks} onChange={setRecordEvidenceLinks} placeholder="One https:// link per line." /></div>
                    <CoachMediaWorkbench onChange={setMediaDrafts} onUseSuggestion={(suggestion) => setRecordBody((current) => current ? `${current}\n\n${suggestion}` : suggestion)} onAIFeedbackChange={setAIFeedbackPayload} />
                    <label className="crm-publish-toggle"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /><span><strong>Share with student & family</strong><small>Only published records appear in the player growth profile.</small></span></label>
                    <button disabled={busy || !studentId} className="crm-button crm-button-primary">{publish ? 'Publish record' : 'Save private record'}</button>
                </form>
                {selectedStudent && <CoachFeedbackHistory records={records.filter((record) => record.student_id === selectedStudent.id)} media={recordMedia} busy={busy} onSave={updateDraftRecord} onDelete={deleteRecord} />}
            </section>}
            {activePanel === 'log' && <MobileMultiStudentLog students={students.filter((student) => !student.student_archived_at)} selectedIds={logStudentIds} note={logNote} busy={busy} onToggleStudent={(nextStudentId) => setLogStudentIds((current) => toggleId(current, nextStudentId))} onNoteChange={setLogNote} onSave={() => void saveMultiStudentLog()} />}

            {activePanel === 'homework' && <CoachHomeworkPanel student={selectedStudent} students={students.filter((student) => !student.student_archived_at)} selectedStudentIds={homeworkStudentIds} assignments={homework.filter((assignment) => assignment.student_id === studentId)} evidence={homeworkEvidence} resources={homeworkResources} title={homeworkTitle} instructions={homeworkInstructions} dueAt={homeworkDueAt} category={homeworkCategory} resourceFiles={homeworkResourceFiles} busy={busy} onTitleChange={setHomeworkTitle} onInstructionsChange={setHomeworkInstructions} onDueAtChange={setHomeworkDueAt} onCategoryChange={setHomeworkCategory} onResourceFilesChange={setHomeworkResourceFiles} onSelectedStudentsChange={setHomeworkStudentIds} onSubmit={saveHomework} onReview={reviewHomework} />}
            {activePanel === 'assessment' && <CoachAssessmentPanel student={selectedStudent} students={students.filter((student) => !student.student_archived_at)} assessments={assessments} attempts={assessmentAttempts} evidence={assessmentEvidence} onRefresh={load} onNotice={onNotice} />}
            {activePanel === 'growth-portfolio' && <FinancialDashboard students={students.filter((student) => !student.student_archived_at)} lessons={lessons} packages={lessonPackages} language={language} onSettle={async (lesson) => { const updated = await coachCRMService.updateLesson(lesson.id, { status: lesson.status, payment_status: 'paid' }); setLessons((current) => current.map((item) => item.id === updated.id ? updated : item)); onNotice({ text: 'Payment collected and marked paid.', tone: 'success' }); }} />}
        </div>
        {mobileSheet && <MobileBottomSheet sheet={mobileSheet} students={students} onClose={() => setMobileSheet(null)} onCreated={(student) => { setStudents((current) => [student, ...current]); setStudentId(student.id); setMobileStudentView('profile'); setMobileSheet(null); onNotice({ text: `${student.full_name} has been added.`, tone: 'success' }); }} onSaved={async () => { await load(); setMobileSheet(null); onNotice({ text: 'Quick note saved as a private coaching draft.', tone: 'success' }); }} onNotice={onNotice} />}
    </div>;
}

function CoachFeedbackHistory({ records, media, busy, onSave, onDelete }: { records: CoachRecord[]; media: CoachRecordMedia[]; busy: boolean; onSave: (recordId: string, input: CoachRecordInput, publish: boolean) => Promise<void>; onDelete: (record: CoachRecord) => Promise<void> }) {
    const drafts = records.filter((record) => !record.is_published);
    const published = records.filter((record) => record.is_published);
    return <section className="crm-feedback-history"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Feedback history</p><h2>Drafts and published records</h2></div><span className="crm-count">{records.length}</span></div><div className="crm-feedback-history-section"><h3>Drafts</h3>{drafts.length ? drafts.map((record) => <DraftFeedbackEditor key={record.id} record={record} media={media.filter((item) => item.coach_record_id === record.id)} busy={busy} onSave={onSave} onDelete={onDelete} />) : <p className="crm-activity-empty">No editable drafts for this student.</p>}</div><div className="crm-feedback-history-section"><h3>Published</h3>{published.length ? <div className="crm-record-list">{published.map((record) => <article className="crm-record-item" key={record.id}><div className="crm-record-meta"><span>{formatDate(record.published_at ?? record.created_at)}</span><span className="crm-status is-active">Published</span></div><h3>{record.title}</h3><p>{record.body}</p><FeedbackMetadata record={record} /><RecordAttachments media={media.filter((item) => item.coach_record_id === record.id)} /><button type="button" className="crm-text-button crm-archive-button" disabled={busy} onClick={() => void onDelete(record)}>Delete record</button></article>)}</div> : <p className="crm-activity-empty">No feedback has been published yet.</p>}</div></section>;
}

function DraftFeedbackEditor({ record, media, busy, onSave, onDelete }: { record: CoachRecord; media: CoachRecordMedia[]; busy: boolean; onSave: (recordId: string, input: CoachRecordInput, publish: boolean) => Promise<void>; onDelete: (record: CoachRecord) => Promise<void> }) {
    const [title, setTitle] = useState(record.title);
    const [body, setBody] = useState(record.body);
    const [lessonDate, setLessonDate] = useState(record.lesson_date ?? '');
    const [skill, setSkill] = useState(record.skill ?? '');
    const [focusArea, setFocusArea] = useState(record.focus_area ?? '');
    const [evidenceLinks, setEvidenceLinks] = useState((record.evidence_links ?? []).join('\n'));
    const [error, setError] = useState('');
    useEffect(() => {
        setTitle(record.title);
        setBody(record.body);
        setLessonDate(record.lesson_date ?? '');
        setSkill(record.skill ?? '');
        setFocusArea(record.focus_area ?? '');
        setEvidenceLinks((record.evidence_links ?? []).join('\n'));
        setError('');
    }, [record]);
    const save = async (publish: boolean) => {
        setError('');
        try {
            await onSave(record.id, toCoachRecordInput({ title, body, lessonDate, skill, focusArea, evidenceLinks }), publish);
        } catch (saveError) {
            setError(messageFrom(saveError));
        }
    };
    return <form className="crm-profile-editor crm-feedback-draft" onSubmit={(event) => { event.preventDefault(); void save(false); }}><div className="crm-profile-editor-heading"><div><p className="crm-eyebrow">Unpublished draft</p><h3>{record.title}</h3><span>Created {formatDate(record.created_at)}</span></div><button type="button" className="crm-text-button crm-archive-button" disabled={busy} onClick={() => void onDelete(record)}>Delete draft</button></div><div className="crm-profile-grid"><Field label="Lesson focus" value={title} onChange={setTitle} required /><label className="crm-field">Lesson date<input type="date" value={lessonDate} onChange={(event) => setLessonDate(event.target.value)} /></label><Field label="Skill" value={skill} onChange={setSkill} /><Field label="Focus area" value={focusArea} onChange={setFocusArea} /></div><TextArea label="Feedback and next practice step" value={body} onChange={setBody} placeholder="What improved today, what to practice, and what to revisit next lesson." required /><TextArea label="Evidence links" value={evidenceLinks} onChange={setEvidenceLinks} placeholder="One https:// link per line." /><FeedbackMetadata record={record} /><RecordAttachments media={media} />{error && <p className="crm-profile-error" role="alert">{error}</p>}<div className="crm-profile-actions"><button disabled={busy} className="crm-button crm-button-secondary">Save draft</button><button type="button" disabled={busy} className="crm-button crm-button-primary" onClick={() => void save(true)}>Publish record</button></div></form>;
}

function FeedbackMetadata({ record, showLesson = true }: { record: CoachRecord; showLesson?: boolean }) {
    const links = Array.isArray(record.evidence_links) ? record.evidence_links : [];
    if (!(showLesson && record.lesson_date) && !record.skill && !record.focus_area && !links.length) return null;
    return <div className="crm-feedback-metadata">{showLesson && record.lesson_date && <span>Lesson: {formatDate(record.lesson_date)}</span>}{record.skill && <span>Skill: {record.skill}</span>}{record.focus_area && <span>Focus: {record.focus_area}</span>}{links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">Evidence link</a>)}</div>;
}

function StudentWorkspace({ profile, onNotice, onSignOut, language, onToggleLanguage }: { profile: CRMProfile; onNotice: (notice: NoticeState) => void; onSignOut: () => void; language: 'en' | 'zh'; onToggleLanguage: () => void }) {
    const [student, setStudent] = useState<Student | null>(null);
    const [schedule, setSchedule] = useState<StudentScheduleItem[]>([]);
    const [coachRecords, setCoachRecords] = useState<CoachRecord[]>([]);
    const [studentRecords, setStudentRecords] = useState<StudentRecord[]>([]);
    const [studentRecordMedia, setStudentRecordMedia] = useState<StudentRecordMedia[]>([]);
    const [recordMedia, setRecordMedia] = useState<CoachRecordMedia[]>([]);
    const [lessons, setLessons] = useState<Lesson[]>([]);
    const [homework, setHomework] = useState<HomeworkAssignment[]>([]);
    const [homeworkEvidence, setHomeworkEvidence] = useState<HomeworkEvidence[]>([]);
    const [homeworkResources, setHomeworkResources] = useState<HomeworkResourceMedia[]>([]);
    const [assessments, setAssessments] = useState<StudentAssessment[]>([]);
    const [assessmentAttempts, setAssessmentAttempts] = useState<AssessmentAttempt[]>([]);
    const [assessmentEvidence, setAssessmentEvidence] = useState<AssessmentEvidence[]>([]);
    const [portfolioSnapshots, setPortfolioSnapshots] = useState<StudentPortfolioSnapshot[]>([]);
    const [portfolioEvidence, setPortfolioEvidence] = useState<StudentPortfolioEvidence[]>([]);
    const [growthReports, setGrowthReports] = useState<GrowthReportSnapshot[]>([]);
    const [activePanel, setActivePanel] = useState<StudentPanel>(() => panelFromPath(STUDENT_PANEL_PATHS, 'growth-profile'));
    const [studentLogTitle, setStudentLogTitle] = useState('');
    const [studentLogBody, setStudentLogBody] = useState('');
    const [studentLogFiles, setStudentLogFiles] = useState<File[]>([]);
    const [savingStudentLog, setSavingStudentLog] = useState(false);
    const [studentLogFormOpen, setStudentLogFormOpen] = useState(false);

    const openPanel = useCallback((panel: StudentPanel) => {
        setActivePanel(panel);
        pushPanelPath(STUDENT_PANEL_PATHS[panel]);
    }, []);

    useEffect(() => {
        const handlePopState = () => setActivePanel(panelFromPath(STUDENT_PANEL_PATHS, 'growth-profile'));
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const load = async () => {
        try {
            const context = await coachCRMService.loadStudentContext();
            const [homeworkContext, assessmentContext, portfolioContext, nextStudentRecords, nextSchedule, nextLessons] = await Promise.all([coachCRMService.loadStudentHomework(), coachCRMService.loadStudentAssessments(), coachCRMService.loadStudentPortfolio(), coachCRMService.loadMyStudentRecords(), coachCRMService.loadMySchedule(), coachCRMService.loadMyLessons()]);
            setStudent(context.student);
            setSchedule(nextSchedule);
            setLessons(nextLessons);
            setCoachRecords(context.coachRecords);
            setRecordMedia(await coachCRMService.loadCoachRecordMedia(context.coachRecords.map((record) => record.id)));
            setHomework(homeworkContext.assignments);
            setHomeworkEvidence(homeworkContext.evidence);
            setHomeworkResources(homeworkContext.resources);
            setAssessments(assessmentContext.assessments);
            setAssessmentAttempts(assessmentContext.attempts);
            setAssessmentEvidence(assessmentContext.evidence);
            setPortfolioSnapshots(portfolioContext.snapshots);
            setPortfolioEvidence(portfolioContext.evidence);
            setGrowthReports(portfolioContext.reports);
            setStudentRecords(nextStudentRecords);
            setStudentRecordMedia(await coachCRMService.loadStudentRecordMedia(nextStudentRecords.map((record) => record.id)));
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        }
    };

    useEffect(() => { void load(); }, []);

    const completeHomework = async (assignmentId: string, reflection: string, files: File[]) => {
        try {
            await coachCRMService.completeStudentHomework(assignmentId, reflection, files);
            await load();
            onNotice({ text: 'Homework marked complete and shared with your coach.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
            throw error;
        }
    };

    const saveStudentProfile = async (input: StudentSelfProfileInput) => {
        try {
            const updatedStudent = await coachCRMService.updateMyStudentProfile(input);
            setStudent(updatedStudent);
            onNotice({ text: 'Your profile has been updated.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
            throw error;
        }
    };

    const saveStudentLog = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!student || !studentLogTitle.trim() || !studentLogBody.trim()) return;
        setSavingStudentLog(true);
        try {
            await coachCRMService.createStudentRecord(student.id, studentLogTitle.trim(), studentLogBody.trim(), studentLogFiles);
            setStudentLogTitle('');
            setStudentLogBody('');
            setStudentLogFiles([]);
            setStudentLogFormOpen(false);
            await load();
            onNotice({ text: 'Your practice log has been shared with your coach.', tone: 'success' });
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setSavingStudentLog(false);
        }
    };

    const studentPanelTitles: Record<StudentPanel, { eyebrow: string; title: string; detail: string }> = {
        'growth-profile': language === 'zh'
            ? { eyebrow: '学员工作台', title: '训练日志', detail: '在一个地方查看教练和训练日志。' }
            : { eyebrow: 'Student workspace', title: 'Log', detail: 'Review coaching and practice logs in one place.' },
        schedule: language === 'zh'
            ? { eyebrow: '学员工作台', title: '课程安排', detail: '查看即将开始的课程时间和地点。' }
            : { eyebrow: 'Student workspace', title: 'Schedule', detail: 'See your upcoming lessons, times, and locations.' },
        feedback: language === 'zh'
            ? { eyebrow: '学员工作台', title: '训练日志', detail: '在一个地方查看教练和训练日志。' }
            : { eyebrow: 'Student workspace', title: 'Log', detail: 'Review coaching and practice logs in one place.' },
        homework: language === 'zh'
            ? { eyebrow: '学员工作台', title: '教练日志', detail: '查看教练分享的课程日志。' }
            : { eyebrow: 'Student workspace', title: 'Coach logs', detail: 'Review lesson logs shared by your coach.' },
        assessment: language === 'zh'
            ? { eyebrow: '学员工作台', title: '教练日志', detail: '查看教练分享的课程日志。' }
            : { eyebrow: 'Student workspace', title: 'Coach logs', detail: 'Review lesson logs shared by your coach.' },
        'growth-portfolio': language === 'zh'
            ? { eyebrow: '账户中心', title: '关于我', detail: '管理个人资料、查看付款记录和教练报告。' }
            : { eyebrow: 'Account centre', title: 'About', detail: 'Manage your profile, review payments, and read coach reports.' },
    };
    const panelTitle = studentPanelTitles[activePanel];

    return <div className="crm-app-layout crm-coach-layout crm-student-layout">
        <WorkspaceNav role="student" studentActivePanel={activePanel} onStudentPanelChange={(panel) => { openPanel(panel); if (panel === 'schedule') void load(); }} language={language} />
        <div className="crm-workspace">
            <MobileWorkspaceHeader profile={profile} onSignOut={onSignOut} language={language} onToggleLanguage={onToggleLanguage} />
            <header key={activePanel} className="crm-content-header"><div><p className="crm-eyebrow">{panelTitle.eyebrow}</p><h1>{panelTitle.title}</h1><p>{panelTitle.detail}</p></div><div className="crm-header-account"><span className="crm-avatar">{initials(profile.full_name)}</span><div><strong>{profile.full_name}</strong><small>{language === 'zh' ? '学员账户' : 'Student account'}</small></div><button type="button" className="crm-language-toggle" onClick={onToggleLanguage}>{language === 'zh' ? 'EN' : '中文'}</button><button type="button" onClick={onSignOut}>{language === 'zh' ? '退出登录' : 'Sign out'}</button></div></header>
            {activePanel === 'growth-profile' && <section className="crm-student-log-workspace"><div className="crm-log-actions"><button type="button" className="crm-button crm-button-primary" onClick={() => setStudentLogFormOpen((open) => !open)} aria-expanded={studentLogFormOpen}><Plus aria-hidden="true" /> {studentLogFormOpen ? 'Close' : 'Add log'}</button></div>{studentLogFormOpen && <section className="crm-panel crm-single-panel"><form className="crm-record-form" onSubmit={saveStudentLog}><Field label="Practice title" value={studentLogTitle} onChange={setStudentLogTitle} required /><TextArea label="What did you practice?" value={studentLogBody} onChange={setStudentLogBody} placeholder="Share what went well, what felt difficult, and what you want help with." required /><label className="crm-field">Photos or videos (optional)<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length > 3) return onNotice({ text: 'Attach up to 3 photos or videos per log.', tone: 'error' }); if (files.some((file) => file.size > 25 * 1024 * 1024)) return onNotice({ text: 'Each attachment must be 25 MB or smaller.', tone: 'error' }); setStudentLogFiles(files); }} /><small>{studentLogFiles.length ? `${studentLogFiles.length} attachment${studentLogFiles.length === 1 ? '' : 's'} selected` : 'Up to 3 files, 25 MB each.'}</small></label><button disabled={savingStudentLog} className="crm-button crm-button-primary">{savingStudentLog ? 'Sharing log...' : 'Share log with coach'}</button></form></section>}<AllStudentLogs coachRecords={coachRecords} studentRecords={studentRecords} coachMedia={recordMedia} studentMedia={studentRecordMedia} /></section>}
            {activePanel === 'schedule' && <StudentSchedule schedule={schedule} language={language} />}
            {activePanel === 'growth-portfolio' && <StudentAboutPanel student={student} lessons={lessons} reports={growthReports} onSaveProfile={saveStudentProfile} />}
        </div>
    </div>;
}

function StudentSchedule({ schedule, language }: { schedule: StudentScheduleItem[]; language: 'en' | 'zh' }) {
    const isZh = language === 'zh';
    const upcomingSessions = schedule.filter((session) => new Date(session.starts_at).getTime() >= Date.now()).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
    const nextLesson = upcomingSessions[0];
    const formatDay = (value: string) => new Intl.DateTimeFormat(isZh ? 'zh-CN' : undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(value));
    const formatTime = (value: string) => new Intl.DateTimeFormat(isZh ? 'zh-CN' : undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));

    return <section className="crm-student-schedule" aria-label={isZh ? '即将开始的课程' : 'Upcoming lessons'}><div className="crm-schedule-reminder-bar"><div><p className="crm-eyebrow">{isZh ? '课程提醒' : 'Lesson reminders'}</p><span>{isZh ? '选择此设备接收课程提醒的时间。' : 'Choose when this device receives lesson alerts.'}</span></div><NotificationSettings className="crm-schedule-notification-button" /></div>
        {nextLesson && <article className="crm-student-next-lesson">
            <p className="crm-eyebrow">{isZh ? '下一节课' : 'Next lesson'}</p>
            <time dateTime={nextLesson.starts_at}>{formatDay(nextLesson.starts_at)}</time>
            <strong>{formatTime(nextLesson.starts_at)} · {nextLesson.title}</strong>
            <span>{nextLesson.kind === 'class' ? (isZh ? '团体课程 · ' : 'Group class · ') : ''}{nextLesson.duration_minutes} {isZh ? '分钟' : 'min'}{nextLesson.location ? ` · ${nextLesson.location}` : ''}</span>
        </article>}
        <div className="crm-panel crm-single-panel crm-student-schedule-list">
            <div className="crm-panel-heading"><div><p className="crm-eyebrow">{isZh ? '课程安排' : 'Your schedule'}</p><h2>{isZh ? '即将开始的课程' : 'Coming up'}</h2></div><span className="crm-count">{upcomingSessions.length}</span></div>
            {upcomingSessions.length ? <div className="crm-student-schedule-items">{upcomingSessions.map((session) => <article key={`${session.kind}-${session.id}`} className="crm-student-schedule-item"><time dateTime={session.starts_at}><strong>{new Intl.DateTimeFormat(isZh ? 'zh-CN' : undefined, { month: 'short', day: 'numeric' }).format(new Date(session.starts_at))}</strong><span>{formatTime(session.starts_at)}</span></time><div><h3>{session.title}</h3><p>{session.kind === 'class' ? (isZh ? '团体课程 · ' : 'Group class · ') : ''}{session.duration_minutes} {isZh ? '分钟' : 'minutes'}{session.location ? ` · ${session.location}` : ''}</p></div></article>)}</div> : <div className="crm-empty-state"><p>{isZh ? '暂无即将开始的课程。' : 'No upcoming lessons yet.'}</p><span>{isZh ? '新课程安排后会自动显示在这里。' : 'Your coach’s next booking will appear here automatically.'}</span></div>}
        </div>
    </section>;
}

function MobileWorkspaceHeader({ profile, onSignOut, language, onToggleLanguage }: { profile: CRMProfile; onSignOut: () => void; language: 'en' | 'zh'; onToggleLanguage: () => void }) {
    const [menuOpen, setMenuOpen] = useState(false);
    return <header className="crm-mobile-header"><strong>Nice Tennis CRM</strong><div className="crm-mobile-account"><button type="button" className="crm-language-toggle" onClick={onToggleLanguage}>{language === 'zh' ? 'EN' : '中文'}</button><button type="button" className="crm-mobile-profile" aria-label={`${profile.full_name} account`} aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><CircleUserRound aria-hidden="true" /></button>{menuOpen && <div className="crm-mobile-account-menu"><strong>{profile.full_name}</strong><small>{profile.role === 'coach' ? (language === 'zh' ? '教练账户' : 'Coach account') : (language === 'zh' ? '学员账户' : 'Student account')}</small><button type="button" onClick={onSignOut}>{language === 'zh' ? '退出登录' : 'Sign out'}</button></div>}</div></header>;
}

function WorkspaceNav({ role, selectedStudent, activePanel, onPanelChange, studentActivePanel, onStudentPanelChange, language }: { role: 'coach' | 'student'; selectedStudent?: Student | null; activePanel?: CoachPanel; onPanelChange?: (panel: CoachPanel) => void; studentActivePanel?: StudentPanel; onStudentPanelChange?: (panel: StudentPanel) => void; language: 'en' | 'zh' }) {
    const coachItems: { panel: CoachPanel; label: string }[] = [
        { panel: 'schedule', label: language === 'zh' ? '日程' : 'Schedule' },
        { panel: 'directory', label: language === 'zh' ? '学员' : 'Students' },
        { panel: 'growth-portfolio', label: language === 'zh' ? '数据面板' : 'Dashboard' },
    ];
    const studentItems: { panel: StudentPanel; label: string }[] = [
        { panel: 'growth-profile', label: language === 'zh' ? '训练日志' : 'Log' },
        { panel: 'schedule', label: language === 'zh' ? '日程' : 'Schedule' },
        { panel: 'growth-portfolio', label: language === 'zh' ? '关于我' : 'About' },
    ];

    const mobileItems = role === 'coach'
        ? [{ label: language === 'zh' ? '日程' : 'Schedule', panel: 'schedule' as const, Icon: CalendarDays }, { label: language === 'zh' ? '学员' : 'Students', panel: 'directory' as const, Icon: UsersRound }, { label: language === 'zh' ? '数据面板' : 'Dashboard', panel: 'growth-portfolio' as const, Icon: BarChart3 }]
        : [{ label: language === 'zh' ? '日程' : 'Schedule', panel: 'schedule' as const, Icon: CalendarDays }, { label: language === 'zh' ? '训练日志' : 'Log', panel: 'growth-profile' as const, Icon: Zap }, { label: language === 'zh' ? '关于我' : 'About', panel: 'growth-portfolio' as const, Icon: CircleUserRound }];

    return <><nav className="crm-workspace-nav" aria-label={`${role} workspace navigation`}>
        <div className="crm-workspace-brand"><span className="crm-workspace-dot" /><div><strong>Nice Tennis CRM</strong><small>{role === 'coach' ? (language === 'zh' ? '教练管理中心' : 'Coaching control room') : (language === 'zh' ? '学员与家庭档案' : 'Student & family profile')}</small></div></div>
        <div className="crm-nav-links">{role === 'coach'
            ? coachItems.map((item) => <button type="button" key={item.panel} onClick={() => onPanelChange?.(item.panel)} data-active={activePanel === item.panel}><strong>{item.label}</strong></button>)
            : studentItems.map((item) => <button type="button" key={item.panel} onClick={() => onStudentPanelChange?.(item.panel)} data-active={studentActivePanel === item.panel}><strong>{item.label}</strong></button>)}</div>
    </nav><nav className="crm-mobile-bottom-nav" aria-label={`${role} mobile navigation`}>{mobileItems.map(({ label, panel, Icon }) => { const isActive = role === 'coach' ? activePanel === panel : studentActivePanel === panel; return <button key={label} type="button" data-active={isActive} onClick={() => role === 'coach' ? onPanelChange?.(panel as CoachPanel) : onStudentPanelChange?.(panel as StudentPanel)}><Icon aria-hidden="true" /><span>{label}</span></button>; })}</nav></>;
}

function ClassSchedule({ students, sessions, attendees, onRefresh, onNotice }: { students: Student[]; sessions: ClassSession[]; attendees: ClassSessionStudent[]; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [title, setTitle] = useState('');
    const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
    const [duration, setDuration] = useState('60');
    const [location, setLocation] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!title.trim()) return onNotice({ text: 'Add a class name before saving.', tone: 'error' });
        setSaving(true);
        try {
            await coachCRMService.createClassSession({ title: title.trim(), starts_at: new Date(startsAt).toISOString(), duration_minutes: Number(duration), location: nullableText(location), notes: null }, selectedIds);
            setTitle(''); setLocation(''); setSelectedIds([]);
            await onRefresh();
            onNotice({ text: 'Class added to your schedule.', tone: 'success' });
        } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { setSaving(false); }
    };
    const updateAttendee = async (attendee: ClassSessionStudent, changes: Partial<Pick<ClassSessionStudent, 'attendance_status' | 'payment_status' | 'payment_amount' | 'payment_note'>>) => {
        try { await coachCRMService.updateClassSessionStudent(attendee.id, { attendance_status: changes.attendance_status ?? attendee.attendance_status, payment_status: changes.payment_status ?? attendee.payment_status, payment_amount: changes.payment_amount ?? attendee.payment_amount, payment_note: changes.payment_note ?? attendee.payment_note }); await onRefresh(); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); }
    };
    return <section className="crm-panel crm-single-panel crm-schedule-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Schedule</p><h2>Classes and court records</h2></div><span className="crm-count">{sessions.length}</span></div><form className="crm-schedule-form" onSubmit={submit}><Field label="Class name" value={title} onChange={setTitle} required /><div className="crm-schedule-form-grid"><label className="crm-field">Starts<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label className="crm-field">Minutes<input type="number" min="15" max="480" step="15" value={duration} onChange={(event) => setDuration(event.target.value)} required /></label><Field label="Court or location" value={location} onChange={setLocation} /></div><fieldset className="crm-schedule-students"><legend>Students attending</legend>{students.length ? <div>{students.map((student) => <label key={student.id}><input type="checkbox" checked={selectedIds.includes(student.id)} onChange={() => setSelectedIds((current) => toggleId(current, student.id))} /><span>{student.full_name}</span></label>)}</div> : <p>Add students before scheduling a class.</p>}</fieldset><button disabled={saving} className="crm-button crm-button-primary">{saving ? 'Adding class...' : 'Add class'}</button></form><div className="crm-schedule-list">{sessions.length ? sessions.map((session) => <article className="crm-schedule-session" key={session.id}><header><div><time>{new Date(session.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time><h3>{session.title}</h3>{session.location && <small>{session.location} · {session.duration_minutes} min</small>}</div><span>{attendees.filter((attendee) => attendee.class_session_id === session.id).length} students</span></header><div className="crm-schedule-attendees">{attendees.filter((attendee) => attendee.class_session_id === session.id).map((attendee) => { const student = students.find((item) => item.id === attendee.student_id); return <div key={attendee.id}><strong>{student?.full_name ?? 'Student'}</strong><div className="crm-schedule-controls"><button type="button" data-active={attendee.attendance_status === 'present'} onClick={() => void updateAttendee(attendee, { attendance_status: 'present' as AttendanceStatus })}><Check aria-hidden="true" />Present</button><button type="button" data-active={attendee.attendance_status === 'absent'} onClick={() => void updateAttendee(attendee, { attendance_status: 'absent' as AttendanceStatus })}><X aria-hidden="true" />Absent</button><button type="button" data-active={attendee.payment_status === 'paid'} onClick={() => void updateAttendee(attendee, { payment_status: 'paid' as PaymentStatus })}>Paid</button><button type="button" data-active={attendee.payment_status === 'unpaid'} onClick={() => void updateAttendee(attendee, { payment_status: 'unpaid' as PaymentStatus })}>Unpaid</button></div></div>; })}</div></article>) : <div className="crm-empty-state"><p>No classes scheduled.</p><span>Add your next session above, then take attendance and update payment status from this page.</span></div>}</div></section>;
}

function MobileStudentActions({ student, onBack, onSelect }: { student: Student; onBack: () => void; onSelect: (view: Exclude<MobileStudentView, null | 'actions'>) => void }) {
    return <section className="crm-mobile-student-workspace crm-mobile-student-actions"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>Students</span></button><header><span className="crm-avatar">{initials(student.full_name)}</span><h2>{student.full_name}</h2></header><div>{[{ view: 'profile' as const, title: 'Profile', detail: 'View player details and history', Icon: UsersRound }, { view: 'payment' as const, title: 'Payment', detail: `${student.remaining_credits} package credits available`, Icon: CreditCard }, { view: 'log' as const, title: 'Log', detail: 'Save a coaching note', Icon: Zap }, { view: 'history' as const, title: 'Log history', detail: 'Review previous lesson logs', Icon: Clock3 }, { view: 'report' as const, title: 'Generate report', detail: 'Create a coach-reviewable report', Icon: BarChart3 }, { view: 'report-history' as const, title: 'Report history', detail: 'View reports shared with this student', Icon: Clock3 }].map(({ view, title, detail, Icon }) => <button type="button" key={view} onClick={() => onSelect(view)}><Icon aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span></button>)}</div></section>;
}

function MobileStudentProfile({ student, onBack, children }: { student: Student; onBack: () => void; children: React.ReactNode }) {
    return <section className="crm-mobile-student-workspace crm-mobile-student-profile"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>{student.full_name}</span></button>{children}</section>;
}

function StudentPaymentPage({ student, packages, lessons, language, onBack, onRefresh, onPackagePurchased, onNotice }: { student: Student; packages: LessonPackage[]; lessons: Lesson[]; language: 'en' | 'zh'; onBack: () => void; onRefresh: () => Promise<void>; onPackagePurchased: (student: Student) => void; onNotice: (notice: NoticeState) => void }) {
    const [sessions, setSessions] = useState('10');
    const [duration, setDuration] = useState('60');
    const [price, setPrice] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const isZh = language === 'zh';
    const buyPackage = async () => {
        const sessionCount = Number(sessions); const sessionDuration = Number(duration); const packagePrice = Number(price);
        if (!Number.isInteger(sessionCount) || sessionCount < 1 || !Number.isFinite(sessionDuration) || sessionDuration < 15 || !Number.isFinite(packagePrice) || packagePrice < 0) return setError('Enter a valid number of sessions, duration, and price.');
        setBusy(true); setError('');
        try { onPackagePurchased(await coachCRMService.purchaseLessonPackage(student.id, sessionCount, sessionDuration, packagePrice)); setPrice(''); } catch (purchaseError) { setError(messageFrom(purchaseError)); } finally { setBusy(false); }
    };
    const updatePackage = async (lessonPackage: LessonPackage) => {
        const packagePriceValue = window.prompt(isZh ? '套餐价格' : 'Package price', String(lessonPackage.price));
        if (packagePriceValue === null) return;
        const packagePrice = Number(packagePriceValue);
        if (!Number.isFinite(packagePrice) || packagePrice < 0) return;
        setBusy(true); setError('');
        try { await coachCRMService.updateLessonPackageRecord(lessonPackage.id, lessonPackage.session_count, lessonPackage.session_duration_minutes, packagePrice); await onRefresh(); onNotice({ text: isZh ? '套餐金额已更新。' : 'Package amount updated.', tone: 'success' }); } catch (updateError) { setError(messageFrom(updateError)); } finally { setBusy(false); }
    };
    const updateLessonRecord = async (lesson: Lesson) => {
        if (lesson.payment_type === 'package') return;
        const amountValue = window.prompt(isZh ? '付款金额' : 'Payment amount', String(lesson.amount_paid ?? 0));
        if (amountValue === null) return;
        const amount = Number(amountValue);
        if (!Number.isFinite(amount) || amount < 0) return;
        setBusy(true); setError('');
        try { await coachCRMService.updateLessonPaymentRecord(lesson.id, { status: lesson.status, payment_status: lesson.payment_status, payment_method: lesson.payment_method, amount_paid: amount }); await onRefresh(); onNotice({ text: isZh ? '课程金额已更新。' : 'Lesson amount updated.', tone: 'success' }); } catch (updateError) { setError(messageFrom(updateError)); } finally { setBusy(false); }
    };
    const deleteTransaction = async (kind: 'lesson' | 'package', record: Lesson | LessonPackage) => {
        const message = kind === 'package' ? (isZh ? '删除此套餐记录？没有关联课程的套餐才可删除。' : 'Delete this package record? Only packages without linked lessons can be deleted.') : (isZh ? '删除此课程付款记录？套餐课时将退回。' : 'Delete this lesson payment record? A package credit will be restored when applicable.');
        if (!window.confirm(message)) return;
        setBusy(true); setError('');
        try { if (kind === 'package') await coachCRMService.deleteLessonPackageRecord(record.id); else await coachCRMService.deleteLessonPaymentRecord(record.id); await onRefresh(); onNotice({ text: isZh ? '付款记录已删除。' : 'Payment record deleted.', tone: 'success' }); } catch (deleteError) { setError(messageFrom(deleteError)); } finally { setBusy(false); }
    };
    const packageAmount = (lesson: Lesson) => {
        const lessonPackage = packages.find((item) => item.id === lesson.package_id);
        return lessonPackage ? lessonPackage.price / lessonPackage.session_count : null;
    };
    const transactions = [
        ...packages.map((item) => ({ id: `package-${item.id}`, date: item.created_at, item: isZh ? `${item.session_count} 节课套餐` : `${item.session_count}-session package`, payment: isZh ? '已付款（预收款）' : 'Paid (prepaid)', income: isZh ? `每节完成后确认 $${(item.price / item.session_count).toFixed(2)} 收入` : `$${(item.price / item.session_count).toFixed(2)} recognized per completed lesson`, amount: item.price, tone: 'prepaid', kind: 'package' as const, record: item })),
        ...lessons.flatMap((lesson) => {
            const completed = lesson.status === 'completed';
            if (lesson.payment_type === 'package') {
                if (!completed) return [];
                const amount = packageAmount(lesson);
                return [{ id: `lesson-${lesson.id}`, date: lesson.completed_at ?? lesson.starts_at, item: lesson.title, payment: isZh ? '套餐支付' : 'Paid by package', income: amount === null ? (isZh ? '旧记录：无法确认金额' : 'Legacy record: amount unavailable') : (isZh ? '已确认收入' : 'Income recognized'), amount, tone: 'recognized', kind: 'lesson' as const, record: lesson }];
            }
            const paymentMethod = lesson.payment_method?.replace('_', ' ') ?? (isZh ? '付款方式未记录' : 'method not recorded');
            if (lesson.payment_status === 'paid') return [{ id: `lesson-${lesson.id}`, date: lesson.starts_at, item: lesson.title, payment: isZh ? `已付款（${paymentMethod}）` : `Paid by ${paymentMethod}`, income: completed ? (isZh ? '已确认收入' : 'Income recognized') : (isZh ? '待课程完成后确认' : 'Recognized after completion'), amount: lesson.amount_paid ?? 0, tone: completed ? 'recognized' : 'prepaid', kind: 'lesson' as const, record: lesson }];
            return [{ id: `lesson-${lesson.id}`, date: lesson.starts_at, item: lesson.title, payment: isZh ? '待付款' : 'Payment pending', income: isZh ? '未确认收入' : 'Income not recognized', amount: lesson.amount_paid ?? 0, tone: 'pending', kind: 'lesson' as const, record: lesson }];
        }),
    ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    return <section className="crm-mobile-student-workspace crm-mobile-student-profile"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>{student.full_name}</span></button><section className="crm-panel crm-single-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Payment</p><h2>Packages and transactions</h2></div><span className="crm-count">{student.remaining_credits}</span></div><p className="crm-activity-empty"><strong>{student.remaining_credits} credits</strong> ready for package bookings.</p><div className="crm-profile-grid"><label className="crm-field">Sessions<input type="number" min="1" max="100" value={sessions} onChange={(event) => setSessions(event.target.value)} /></label><label className="crm-field">Session duration (minutes)<input type="number" min="15" max="480" step="15" value={duration} onChange={(event) => setDuration(event.target.value)} /></label><label className="crm-field">Package price<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label></div><button type="button" disabled={busy || Boolean(student.student_archived_at)} className="crm-button crm-button-primary" onClick={() => void buyPackage()}>{busy ? 'Adding package...' : 'Add package credits'}</button>{error && <p className="crm-profile-error" role="alert">{error}</p>}</section><section className="crm-panel crm-single-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">{isZh ? '交易记录' : 'Transaction history'}</p></div><span className="crm-count">{transactions.length}</span></div>{transactions.length ? <TransactionTable transactions={transactions} isZh={isZh} busy={busy} onEdit={(item) => { if (item.kind === 'package') void updatePackage(item.record); else void updateLessonRecord(item.record); }} onDelete={(item) => void deleteTransaction(item.kind, item.record)} /> : <p className="crm-activity-empty">{isZh ? '暂无套餐购买或课程付款记录。' : 'No package purchases or lesson payments yet.'}</p>}</section></section>;
}

function TransactionTable({ transactions, isZh, busy, onEdit, onDelete }: { transactions: ({ id: string; date: string; item: string; payment: string; income: string; amount: number | null; tone: string; kind: 'lesson'; record: Lesson } | { id: string; date: string; item: string; payment: string; income: string; amount: number | null; tone: string; kind: 'package'; record: LessonPackage })[]; isZh: boolean; busy: boolean; onEdit: (item: { kind: 'lesson'; record: Lesson } | { kind: 'package'; record: LessonPackage }) => void; onDelete: (item: { kind: 'lesson'; record: Lesson } | { kind: 'package'; record: LessonPackage }) => void }) {
    return <div className="crm-transaction-table-wrap"><table className="crm-transaction-table"><thead><tr><th>{isZh ? '日期' : 'Date'}</th><th>{isZh ? '项目' : 'Item'}</th><th>{isZh ? '付款状态' : 'Payment'}</th><th>{isZh ? '收入状态' : 'Income'}</th><th>{isZh ? '金额' : 'Amount'}</th><th>{isZh ? '操作' : 'Actions'}</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id} data-tone={item.tone}><td>{formatDate(item.date)}</td><td>{item.item}</td><td>{item.payment}</td><td>{item.income}</td><td>{item.amount === null ? (isZh ? '未确认' : 'Not yet') : `$${item.amount.toFixed(2)}`}</td><td><div className="crm-transaction-actions"><button type="button" disabled={busy} onClick={() => onEdit(item)}>{isZh ? '编辑' : 'Edit'}</button><button type="button" disabled={busy} onClick={() => onDelete(item)}>{isZh ? '删除' : 'Delete'}</button></div></td></tr>)}</tbody></table></div>;
}

function MobileStudentLog({ student, onBack, children }: { student: Student; onBack: () => void; children: React.ReactNode }) {
    return <section className="crm-mobile-student-workspace crm-mobile-student-log"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>{student.full_name}</span></button><div className="crm-panel-heading"><div><p className="crm-eyebrow">Lesson log</p><h2>{student.full_name}</h2></div></div>{children}</section>;
}

function MobileStudentLogHistory({ student, records, studentRecords, media, studentMedia, busy, onSave, onDelete, onPublishAI, onBack }: { student: Student; records: CoachRecord[]; studentRecords: StudentRecord[]; media: CoachRecordMedia[]; studentMedia: StudentRecordMedia[]; busy: boolean; onSave: (recordId: string, input: CoachRecordInput, publish: boolean) => Promise<void>; onDelete: (record: CoachRecord) => Promise<void>; onPublishAI: (record: StudentRecord, media: StudentRecordMedia, payload: AIFeedbackPublishPayload) => Promise<void>; onBack: () => void }) {
    return <section className="crm-mobile-student-workspace crm-mobile-student-log-history"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>{student.full_name}</span></button><AllStudentLogs coachRecords={records} studentRecords={studentRecords} coachMedia={media} studentMedia={studentMedia} busy={busy} onSave={onSave} onDelete={onDelete} onPublishAI={onPublishAI} /></section>;
}

function AllStudentLogs({ coachRecords, studentRecords, coachMedia, studentMedia, busy = false, onSave, onDelete, onPublishAI }: { coachRecords: CoachRecord[]; studentRecords: StudentRecord[]; coachMedia: CoachRecordMedia[]; studentMedia: StudentRecordMedia[]; busy?: boolean; onSave?: (recordId: string, input: CoachRecordInput, publish: boolean) => Promise<void>; onDelete?: (record: CoachRecord) => Promise<void>; onPublishAI?: (record: StudentRecord, media: StudentRecordMedia, payload: AIFeedbackPublishPayload) => Promise<void> }) {
    const logs = [
        ...coachRecords.map((record) => ({ source: 'coach' as const, record, date: record.lesson_date ?? record.created_at })),
        ...studentRecords.map((record) => ({ source: 'student' as const, record, date: record.created_at })),
    ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

    return <section className="crm-panel crm-timeline-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">History</p><h2>All logs</h2></div><span className="crm-count">{logs.length}</span></div>{logs.length === 0 ? <div className="crm-empty-state"><p>No logs yet.</p><span>Coaching notes and student practice logs will appear here.</span></div> : <div className="crm-record-list">{logs.map(({ source, record, date }) => {
        const matchingCoachMedia = source === 'coach' ? coachMedia.filter((item) => item.coach_record_id === record.id) : [];
        if (source === 'coach' && isAIVideoFeedbackRecord(record)) return <AIFeedbackHistoryItem key={`coach-${record.id}`} record={record} media={matchingCoachMedia} busy={busy} onDelete={onDelete} />;
        if (source === 'coach' && onSave && onDelete) return <CoachHistoryLog key={`coach-${record.id}`} record={record} media={matchingCoachMedia} date={date} busy={busy} onSave={onSave} onDelete={onDelete} />;
        return <article className="crm-record-item" key={`${source}-${record.id}`}><div className="crm-record-meta"><span>{formatDate(date)}</span><span className={`crm-status ${source === 'coach' ? 'is-active' : 'is-private'}`}>{source === 'coach' ? 'Coach' : 'Student'}</span>{source === 'coach' && record.updated_at > record.created_at && <span>Edited on {formatDate(record.updated_at)}</span>}</div><h3>{record.title}</h3><p>{record.body}</p>{source === 'coach' ? <><FeedbackMetadata record={record} showLesson={false} /><RecordAttachments media={matchingCoachMedia} /></> : <StudentRecordAttachments media={studentMedia.filter((item) => item.student_record_id === record.id)} onPublishAI={onPublishAI ? (sourceMedia, payload) => onPublishAI(record, sourceMedia, payload) : undefined} />}</article>;
    })}</div>}</section>;
}

function isAIVideoFeedbackRecord(record: CoachRecord) {
    return record.skill === 'Video analysis' || record.title.startsWith('AI 动作反馈');
}

function AIFeedbackHistoryItem({ record, media, busy, onDelete }: { record: CoachRecord; media: CoachRecordMedia[]; busy: boolean; onDelete?: (record: CoachRecord) => Promise<void> }) {
    return <article className="crm-record-item crm-ai-history-item"><RecordAttachments media={media} layout="ai-feedback" aiFeedbackBody={record.body} />{onDelete && <button type="button" className="crm-text-button crm-archive-button" disabled={busy} onClick={() => void onDelete(record)}>Delete AI feedback</button>}</article>;
}

function StudentRecordAttachments({ media, onPublishAI }: { media: StudentRecordMedia[]; onPublishAI?: (media: StudentRecordMedia, payload: AIFeedbackPublishPayload) => Promise<void> }) {
    if (!media.length) return null;
    return <div className="crm-homework-resources crm-student-log-media"><strong>Attachments</strong><div>{media.map((item) => item.media_type === 'image'
        ? <a key={item.id} href={item.signed_url} target="_blank" rel="noreferrer"><img src={item.signed_url} alt={item.original_name} /></a>
        : <div className="crm-student-video" key={item.id}><video controls preload="metadata" src={item.signed_url} />{onPublishAI && <StudentVideoAIFeedback videoUrl={item.signed_url} fileName={item.original_name} onPublish={(payload) => onPublishAI(item, payload)} />}</div>)}</div></div>;
}

function CoachHistoryLog({ record, media, date, busy, onSave, onDelete }: { record: CoachRecord; media: CoachRecordMedia[]; date: string; busy: boolean; onSave: (recordId: string, input: CoachRecordInput, publish: boolean) => Promise<void>; onDelete: (record: CoachRecord) => Promise<void> }) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(record.title);
    const [body, setBody] = useState(record.body);
    const save = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await onSave(record.id, { title: title.trim(), body: body.trim(), lesson_date: record.lesson_date, skill: record.skill, focus_area: record.focus_area, evidence_links: record.evidence_links }, record.is_published);
        setEditing(false);
    };
    return <article className="crm-record-item"><div className="crm-record-meta"><span>{formatDate(date)}</span><span className="crm-status is-active">Coach</span>{record.updated_at > record.created_at && <span>Edited on {formatDate(record.updated_at)}</span>}</div>{editing ? <form className="crm-record-form" onSubmit={(event) => void save(event)}><Field label="Lesson focus" value={title} onChange={setTitle} required /><TextArea label="Feedback and next practice step" value={body} onChange={setBody} placeholder="What improved today, what to practice, and what to revisit next lesson." required /><div className="crm-profile-actions"><button disabled={busy} className="crm-button crm-button-primary">Save changes</button><button type="button" disabled={busy} className="crm-button crm-button-secondary" onClick={() => setEditing(false)}>Cancel</button></div></form> : <><h3>{record.title}</h3><p>{record.body}</p><FeedbackMetadata record={record} showLesson={false} /><RecordAttachments media={media} /><div className="crm-profile-actions"><button type="button" className="crm-button crm-button-secondary" disabled={busy} onClick={() => setEditing(true)}>Edit log</button><button type="button" className="crm-text-button crm-archive-button" disabled={busy} onClick={() => void onDelete(record)}>Delete log</button></div></>}</article>;
}

function MobileStudentReport({ student, coachRecords, studentRecords, reports, snapshots, onRefresh, onNotice, onBack }: { student: Student; coachRecords: CoachRecord[]; studentRecords: StudentRecord[]; reports: GrowthReportSnapshot[]; snapshots: CapabilityAssessmentSnapshot[]; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void; onBack: () => void }) {
    const [generating, setGenerating] = useState(false);
    const generate = async () => { setGenerating(true); try { const content = makeGrowthReportContent(student, coachRecords, studentRecords); await coachCRMService.createGrowthReport(student.id, null, `${student.full_name} coaching report`, content); await onRefresh(); onNotice({ text: 'Log-based coaching report draft created for review.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { setGenerating(false); } };
    return <section className="crm-mobile-student-workspace crm-mobile-student-report"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>{student.full_name}</span></button><section className="crm-panel crm-single-panel"><p className="crm-eyebrow">Professional report</p><h2>Log-based coaching summary</h2><p className="crm-activity-empty">Uses {coachRecords.length + studentRecords.length} dated log entries to prepare a coach-reviewable draft.</p><button type="button" disabled={generating} className="crm-button crm-button-primary" onClick={() => void generate()}><Plus aria-hidden="true" /> {generating ? 'Generating...' : 'Generate report'}</button></section><MobileReportsDashboard students={[student]} reports={reports} snapshots={snapshots} onRefresh={onRefresh} onNotice={onNotice} /></section>;
}

function MobileStudentReportHistory({ student, reports, snapshots, onRefresh, onNotice, onBack }: { student: Student; reports: GrowthReportSnapshot[]; snapshots: CapabilityAssessmentSnapshot[]; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void; onBack: () => void }) {
    const sharedReports = reports.filter((report) => report.status === 'published');
    return <section className="crm-mobile-student-workspace crm-mobile-student-report"><button type="button" className="crm-mobile-student-back" onClick={onBack}><ArrowLeft aria-hidden="true" /><span>{student.full_name}</span></button><section className="crm-mobile-reports-dashboard"><section><div className="crm-mobile-reports-heading"><div><p className="crm-eyebrow">Report history</p><h3>Shared reports</h3></div><span>{sharedReports.length}</span></div>{sharedReports.length ? sharedReports.map((report) => <MobileReportCard key={report.id} report={report} student={student} snapshot={snapshots.find((snapshot) => snapshot.id === report.capability_snapshot_id) ?? null} onRefresh={onRefresh} onNotice={onNotice} />) : <p className="crm-activity-empty">No reports have been shared with this student yet.</p>}</section></section></section>;
}

function MobileMultiStudentLog({ students, selectedIds, note, busy, onToggleStudent, onNoteChange, onSave }: { students: Student[]; selectedIds: string[]; note: string; busy: boolean; onToggleStudent: (studentId: string) => void; onNoteChange: (note: string) => void; onSave: () => void }) {
    return <section className="crm-panel crm-single-panel crm-mobile-log"><div className="crm-panel-heading"><div><p className="crm-eyebrow">On-court log</p><h2>Who are you logging?</h2></div><span className="crm-count">{selectedIds.length}</span></div><div className="crm-mobile-log-students">{students.map((student) => <button type="button" key={student.id} data-selected={selectedIds.includes(student.id)} onClick={() => onToggleStudent(student.id)}><span className="crm-avatar">{initials(student.full_name)}</span><span><strong>{student.full_name}</strong><small>{student.level ?? 'Level not recorded'}</small></span></button>)}</div><label className="crm-mobile-log-note">Court note<textarea value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="What should you remember from this session?" /></label><button type="button" disabled={busy} className="crm-mobile-log-save" onClick={onSave}>{busy ? 'Saving...' : `Save log for ${selectedIds.length || 'selected'} student${selectedIds.length === 1 ? '' : 's'}`}</button></section>;
}

function StudentPublishedPanel({ title, detail }: { title: string; detail: string }) {
    return <section className="crm-panel crm-single-panel crm-student-published-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Published by your coach</p><h2>{title}</h2></div></div><div className="crm-empty-state"><p>{detail}</p><span>Only content published to your growth profile will appear here.</span></div></section>;
}

function StudentReportHistory({ reports }: { reports: GrowthReportSnapshot[] }) {
    return <section className="crm-panel crm-single-panel crm-student-report-history"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Shared by your coach</p><h2>Report history</h2></div><span className="crm-count">{reports.length}</span></div>{reports.length === 0 ? <div className="crm-empty-state"><p>No shared reports yet.</p><span>Your coach's published progress reports will appear here.</span></div> : <div className="crm-report-list">{reports.map((report) => <article className="crm-growth-report" key={report.id}><div className="crm-record-meta"><span>{formatDate(report.published_at ?? report.created_at)}</span><span className="crm-status is-active">Shared</span></div><h4>{report.title}</h4><ReportContent content={report.report_content} /><div className="crm-profile-actions"><button type="button" className="crm-button crm-button-secondary" onClick={() => downloadGrowthReport(report)}>Download report</button></div></article>)}</div>}</section>;
}

function StudentAboutPanel({ student, lessons, reports, onSaveProfile }: { student: Student | null; lessons: Lesson[]; reports: GrowthReportSnapshot[]; onSaveProfile: (input: StudentSelfProfileInput) => Promise<void> }) {
    const [activeView, setActiveView] = useState<'home' | 'profile' | 'payment' | 'reports'>('home');
    const paymentHistory = [...lessons].sort((left, right) => new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime());
    const sharedReports = reports.filter((report) => report.status === 'published');
    const cards = [{ view: 'profile' as const, title: 'Profile', detail: 'View and update your information', Icon: UsersRound }, { view: 'payment' as const, title: 'Payment', detail: `${student?.remaining_credits ?? 0} package credits available`, Icon: CreditCard }, { view: 'reports' as const, title: 'Reports', detail: `${sharedReports.length} coach report${sharedReports.length === 1 ? '' : 's'} shared`, Icon: BarChart3 }];
    if (activeView === 'home') return <section className="crm-student-about crm-student-about-launcher" aria-label="About your account"><div className="crm-student-about-grid">{cards.map(({ view, title, detail, Icon }) => <button type="button" className="crm-student-about-link" key={view} onClick={() => setActiveView(view)}><Icon aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span></button>)}</div></section>;
    return <section className="crm-student-about" aria-label="About your account"><button type="button" className="crm-about-back" onClick={() => setActiveView('home')}><ArrowLeft aria-hidden="true" /> <span>About</span></button>
        {activeView === 'profile' && <article className="crm-panel crm-single-panel crm-about-card"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Profile</p><h2>Personal information</h2></div></div><p className="crm-about-card-detail">Your updates are saved to your coaching profile, so your coach always has the latest training information.</p><StudentSelfProfileEditor student={student} onSave={onSaveProfile} /></article>}
        {activeView === 'payment' && <article className="crm-panel crm-single-panel crm-about-card"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Payment</p><h2>Payment history</h2></div><span className="crm-count">{paymentHistory.length}</span></div><div className="crm-about-credit"><strong>{student?.remaining_credits ?? 0}</strong><span>Package credits available</span></div>{paymentHistory.length ? <div className="crm-about-payment-list">{paymentHistory.map((lesson) => <article className={`crm-about-payment-row is-${lesson.payment_status}`} key={lesson.id}><div><strong>{lesson.title}</strong><span>{formatDate(lesson.starts_at)} · {lesson.duration_minutes} min</span></div><div><b>{lesson.payment_type === 'package' ? 'Package credit' : lesson.payment_status === 'paid' ? 'Paid' : 'Payment pending'}</b><span>{lesson.amount_paid === null ? 'Amount not recorded' : `$${lesson.amount_paid.toFixed(2)}`}</span></div></article>)}</div> : <div className="crm-empty-state"><p>No lesson payments yet.</p><span>Payments confirmed by your coach will appear here.</span></div>}</article>}
        {activeView === 'reports' && <article className="crm-panel crm-single-panel crm-about-card"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Reports</p><h2>Coach reports</h2></div><span className="crm-count">{sharedReports.length}</span></div>{sharedReports.length ? <div className="crm-report-list">{sharedReports.map((report) => <article className="crm-growth-report" key={report.id}><div className="crm-record-meta"><span>{formatDate(report.published_at ?? report.created_at)}</span><span className="crm-status is-active">Shared</span></div><h4>{report.title}</h4><ReportContent content={report.report_content} /><div className="crm-profile-actions"><button type="button" className="crm-button crm-button-secondary" onClick={() => downloadGrowthReport(report)}>Download report</button></div></article>)}</div> : <div className="crm-empty-state"><p>No shared reports yet.</p><span>Coach-approved progress reports will appear here.</span></div>}</article>}
    </section>;
}

function StudentGrowthPortfolio({ snapshots, evidence, reports, records, recordMedia, assessments, homework }: { snapshots: StudentPortfolioSnapshot[]; evidence: StudentPortfolioEvidence[]; reports: GrowthReportSnapshot[]; records: CoachRecord[]; recordMedia: CoachRecordMedia[]; assessments: StudentAssessment[]; homework: HomeworkAssignment[] }) {
    const latestSnapshot = snapshots.at(-1) ?? null;
    return <section className="crm-panel crm-single-panel crm-portfolio-panel crm-student-portfolio"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Published by your coach</p><h2>Growth portfolio</h2></div><span className="crm-count">{reports.length}</span></div>{reports.length === 0 ? <div className="crm-empty-state"><p>Your coach has not published a growth report yet.</p><span>Published reports, capability scores, milestones, and approved evidence will appear here.</span></div> : <div className="crm-portfolio-main"><section className="crm-portfolio-overview"><div><p className="crm-eyebrow">Latest capability assessment</p><h3>{latestSnapshot ? formatDate(latestSnapshot.assessed_at) : 'Included in your published reports'}</h3></div>{latestSnapshot && <CapabilityRadar scores={latestSnapshot.capability_scores} />}</section>{latestSnapshot && <PortfolioTrends snapshots={snapshots} assessments={assessments} homework={homework} />}<StudentPortfolioMilestones assessments={assessments} /><StudentPortfolioEvidenceTimeline evidence={evidence} records={records} recordMedia={recordMedia} assessments={assessments} /><section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Published reports</p><h3>Coach-approved growth reports</h3></div></div><div className="crm-report-list">{reports.map((report) => <article className="crm-growth-report" key={report.id}><div className="crm-record-meta"><span>{formatDate(report.published_at ?? report.created_at)}</span><span className="crm-status is-active">Published</span></div><h4>{report.title}</h4><ReportContent content={report.report_content} /><div className="crm-profile-actions"><button type="button" className="crm-button crm-button-secondary" onClick={() => downloadGrowthReport(report)}>Download report</button></div></article>)}</div></section></div>}</section>;
}

function StudentPortfolioMilestones({ assessments }: { assessments: StudentAssessment[] }) {
    return <section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Milestones</p><h3>Current challenges and results</h3></div><span className="crm-count">{assessments.length}</span></div>{assessments.length ? <div className="crm-portfolio-timeline">{assessments.map((assessment) => <article key={assessment.id}><time>{formatDate(assessment.achieved_at ?? assessment.created_at)}</time><div><span>{assessment.status.replace('_', ' ')}</span><strong>{assessment.title}</strong><p>{formatAssessmentResult(assessment.result_value, assessment.score)} of {assessment.target_value} {assessment.unit}</p></div></article>)}</div> : <p className="crm-activity-empty">Published milestones will appear here.</p>}</section>;
}

function StudentPortfolioEvidenceTimeline({ evidence, records, recordMedia, assessments }: { evidence: StudentPortfolioEvidence[]; records: CoachRecord[]; recordMedia: CoachRecordMedia[]; assessments: StudentAssessment[] }) {
    const items = evidence.map((source) => {
        const record = records.find((item) => item.id === source.source_coach_record_id);
        const media = recordMedia.find((item) => item.id === source.source_coach_record_media_id);
        const assessment = assessments.find((item) => item.id === source.source_student_assessment_id);
        return { id: source.id, date: source.created_at, title: record?.title ?? assessment?.title ?? media?.original_name ?? 'Approved portfolio evidence', detail: record ? 'Published lesson feedback' : assessment ? `Milestone: ${formatAssessmentResult(assessment.result_value, assessment.score)}` : media ? `Published ${media.media_type}` : 'Approved by your coach', media };
    });
    return <section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Approved evidence</p><h3>Evidence supporting your portfolio</h3></div><span className="crm-count">{items.length}</span></div>{items.length ? <div className="crm-portfolio-timeline">{items.map((item) => <article key={item.id}><time>{formatDate(item.date)}</time><div><span>Approved evidence</span><strong>{item.title}</strong><p>{item.detail}</p>{item.media && <RecordAttachments media={[item.media]} compact />}</div></article>)}</div> : <p className="crm-activity-empty">Approved evidence will appear when your coach includes it in a published report.</p>}</section>;
}

function StudentHomeworkPanel({ assignments, evidence, resources, onComplete }: { assignments: HomeworkAssignment[]; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[]; onComplete: (assignmentId: string, reflection: string, files: File[]) => Promise<void> }) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const upcoming = assignments.filter((assignment) => assignment.status === 'assigned' && (!assignment.due_at || new Date(assignment.due_at) >= startOfToday));
    const overdue = assignments.filter((assignment) => assignment.status === 'assigned' && assignment.due_at && new Date(assignment.due_at) < startOfToday);
    const completed = assignments.filter((assignment) => assignment.status !== 'assigned');

    return <section className="crm-panel crm-single-panel crm-homework-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Assigned by your coach</p><h2>Practice plan</h2></div><span className="crm-count">{assignments.length}</span></div><HomeworkGroup title="Upcoming" assignments={upcoming} evidence={evidence} resources={resources} onComplete={onComplete} empty="No upcoming homework assigned." /><HomeworkGroup title="Overdue" assignments={overdue} evidence={evidence} resources={resources} onComplete={onComplete} empty="No overdue homework." overdue /><HomeworkGroup title="Completed" assignments={completed} evidence={evidence} resources={resources} onComplete={onComplete} empty="Completed homework will appear here." /></section>;
}

function HomeworkGroup({ title, assignments, evidence, resources, onComplete, empty, overdue = false }: { title: string; assignments: HomeworkAssignment[]; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[]; onComplete: (assignmentId: string, reflection: string, files: File[]) => Promise<void>; empty: string; overdue?: boolean }) {
    return <section className="crm-homework-group"><div className="crm-homework-group-heading"><h3>{title}</h3><span>{assignments.length}</span></div>{assignments.length === 0 ? <p className="crm-activity-empty">{empty}</p> : <div className="crm-homework-list">{assignments.map((assignment) => <HomeworkAssignmentCard key={assignment.id} assignment={assignment} evidence={evidence.filter((item) => item.homework_assignment_id === assignment.id)} resources={resources.filter((item) => item.homework_assignment_id === assignment.id)} onComplete={onComplete} overdue={overdue} />)}</div>}</section>;
}

function HomeworkAssignmentCard({ assignment, evidence, resources, onComplete, overdue }: { assignment: HomeworkAssignment; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[]; onComplete: (assignmentId: string, reflection: string, files: File[]) => Promise<void>; overdue: boolean }) {
    const [reflection, setReflection] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        try {
            await onComplete(assignment.id, reflection, files);
        } finally {
            setBusy(false);
        }
    };
    const isComplete = assignment.status !== 'assigned';
    return <article className="crm-homework-card"><div className="crm-homework-card-heading"><div><h4>{assignment.title}</h4><span className={overdue ? 'crm-homework-due is-overdue' : 'crm-homework-due'}>{assignment.due_at ? `${overdue ? 'Overdue' : 'Due'} ${formatDate(assignment.due_at)}` : 'No due date'}</span></div><span className={`crm-status is-${isComplete ? 'active' : 'pending'}`}>{assignment.status}</span></div>{assignment.drill_category && <span className="crm-homework-category">{assignment.drill_category}</span>}<p>{assignment.instructions}</p><HomeworkResourceList resources={resources} />{isComplete ? <><div className="crm-homework-reflection"><strong>Your reflection</strong><span>{assignment.student_reflection || 'No reflection added.'}</span></div><HomeworkEvidenceList evidence={evidence} /></> : <form className="crm-homework-completion" onSubmit={submit}><TextArea label="Practice reflection" value={reflection} onChange={setReflection} placeholder="What felt better, what was difficult, and what you want help with." /><label className="crm-field">Evidence (optional)<input type="file" accept="image/*,video/*" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>{files.length > 0 && <p className="crm-file-summary">{files.length} file{files.length === 1 ? '' : 's'} ready to upload.</p>}<button disabled={busy} className="crm-button crm-button-primary">{busy ? 'Submitting...' : 'Mark complete'}</button></form>}</article>;
}

function HomeworkEvidenceList({ evidence }: { evidence: HomeworkEvidence[] }) {
    if (!evidence.length) return null;
    return <div className="crm-homework-evidence"><strong>Submitted evidence</strong>{evidence.map((item) => <a key={item.id} href={item.signed_url} target="_blank" rel="noreferrer">{item.original_name}</a>)}</div>;
}

function HomeworkResourceList({ resources }: { resources: HomeworkResourceMedia[] }) {
    if (!resources.length) return null;
    return <div className="crm-homework-resources"><strong>Coach resources</strong><div>{resources.map((resource) => resource.media_type === 'image' ? <a key={resource.id} href={resource.signed_url} target="_blank" rel="noreferrer"><img src={resource.signed_url} alt={resource.original_name} /></a> : <video key={resource.id} controls preload="metadata" src={resource.signed_url} />)}</div></div>;
}

function CoachAssessmentPanel({ student, students, assessments, attempts, evidence, onRefresh, onNotice }: { student: Student | null; students: Student[]; assessments: StudentAssessment[]; attempts: AssessmentAttempt[]; evidence: AssessmentEvidence[]; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [studentIds, setStudentIds] = useState<string[]>([]);
    const [title, setTitle] = useState('Baseline-to-baseline forehand rally');
    const [challengeType, setChallengeType] = useState<AssessmentChallengeType>('rally_count');
    const [targetValue, setTargetValue] = useState('10');
    const [unit, setUnit] = useState('consecutive balls');
    const [notes, setNotes] = useState('Rally cooperatively baseline to baseline with a forehand. Target 10 consecutive balls.');
    const [publish, setPublish] = useState(true);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (student && !studentIds.length) setStudentIds([student.id]); }, [student, studentIds.length]);
    if (!students.length) return <PlannedWorkspace student={null} title="" detail="" />;
    const selectedAssessments = student ? assessments.filter((assessment) => assessment.student_id === student.id) : [];
    const toggleStudent = (id: string) => setStudentIds((current) => current.includes(id) ? current.filter((studentId) => studentId !== id) : [...current, id]);
    const useForehandPreset = () => { setTitle('Baseline-to-baseline forehand rally'); setChallengeType('rally_count'); setTargetValue('10'); setUnit('consecutive balls'); setNotes('Rally cooperatively baseline to baseline with a forehand. Target 10 consecutive balls.'); };
    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const target = nullableNumber(targetValue);
        if (!studentIds.length || target === null) { onNotice({ text: 'Choose one or more students and enter a numeric target.', tone: 'error' }); return; }
        setBusy(true);
        try { const created = await coachCRMService.createStudentAssessments(studentIds, { title: title.trim(), challenge_type: challengeType, target_value: target, unit: unit.trim(), notes: nullableText(notes) }, publish); await onRefresh(); onNotice({ text: `Milestone assigned to ${created.length} student${created.length === 1 ? '' : 's'}.`, tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { setBusy(false); }
    };
    return <section className="crm-panel crm-single-panel crm-assessment-panel">{student && <SelectedPlayerContext student={student} />}<div className="crm-panel-heading"><div><p className="crm-eyebrow">Assign milestone</p><h2>Assessments</h2></div><span className="crm-count">{selectedAssessments.length}</span></div><form className="crm-record-form" onSubmit={submit}><fieldset className="crm-homework-recipients"><legend>Assign to</legend><div className="crm-homework-recipient-actions"><button type="button" className="crm-text-button" onClick={() => setStudentIds(students.map((item) => item.id))}>Select all</button><button type="button" className="crm-text-button" onClick={() => setStudentIds([])}>Clear</button></div><div>{students.map((item) => <label key={item.id}><input type="checkbox" checked={studentIds.includes(item.id)} onChange={() => toggleStudent(item.id)} /><span>{item.full_name}</span></label>)}</div></fieldset><div className="crm-assessment-preset"><strong>Forehand rally example</strong><span>Baseline to baseline, 10 consecutive balls.</span><button type="button" className="crm-text-button" onClick={useForehandPreset}>Use example</button></div><div className="crm-profile-grid"><Field label="Milestone title" value={title} onChange={setTitle} required /><SelectField label="Challenge type" value={challengeType} onChange={(value) => setChallengeType(value as AssessmentChallengeType)} options={assessmentChallengeOptions} /><label className="crm-field">Target<input type="number" min="0" step="0.1" required value={targetValue} onChange={(event) => setTargetValue(event.target.value)} /></label><Field label="Unit" value={unit} onChange={setUnit} required /></div><TextArea label="Coach instructions" value={notes} onChange={setNotes} placeholder="Describe the task, conditions, and success criteria." /><label className="crm-publish-toggle"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /><span><strong>Publish to student & family</strong><small>Only published milestones are visible in the student workspace.</small></span></label><button disabled={busy} className="crm-button crm-button-primary">{busy ? 'Assigning...' : 'Assign milestone'}</button></form><section className="crm-assessment-history"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Selected student</p><h2>Milestone history</h2></div></div>{student ? selectedAssessments.length ? <div className="crm-assessment-list">{selectedAssessments.map((assessment) => <CoachAssessmentCard key={assessment.id} assessment={assessment} attempts={attempts.filter((attempt) => attempt.student_assessment_id === assessment.id)} evidence={evidence.filter((item) => item.student_assessment_id === assessment.id)} busy={busy} onBusyChange={setBusy} onRefresh={onRefresh} onNotice={onNotice} />)}</div> : <p className="crm-activity-empty">No milestones have been assigned to this student.</p> : <p className="crm-activity-empty">Select a student in Student management to view their milestone history.</p>}</section></section>;
}

function CoachAssessmentCard({ assessment, attempts, evidence, busy, onBusyChange, onRefresh, onNotice }: { assessment: StudentAssessment; attempts: AssessmentAttempt[]; evidence: AssessmentEvidence[]; busy: boolean; onBusyChange: (busy: boolean) => void; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [result, setResult] = useState(assessment.result_value?.toString() ?? ''); const [score, setScore] = useState(assessment.score?.toString() ?? ''); const [status, setStatus] = useState<AssessmentStatus>(assessment.status); const [notes, setNotes] = useState(assessment.notes ?? ''); const [published, setPublished] = useState(assessment.is_published); const [attemptNotes, setAttemptNotes] = useState(''); const [evidenceUrl, setEvidenceUrl] = useState('');
    const saveOutcome = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); onBusyChange(true); try { await coachCRMService.recordAssessmentOutcome(assessment.id, nullableNumber(result), nullableNumber(score), nullableText(notes), status, published); await onRefresh(); onNotice({ text: 'Assessment result updated.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { onBusyChange(false); } };
    const addAttempt = async () => { onBusyChange(true); try { await coachCRMService.createAssessmentAttempt(assessment.id, nullableNumber(result), nullableNumber(score), nullableText(attemptNotes)); setAttemptNotes(''); await onRefresh(); onNotice({ text: 'Attempt recorded.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { onBusyChange(false); } };
    const addEvidence = async () => { if (!evidenceUrl.trim()) return; onBusyChange(true); try { await coachCRMService.addAssessmentEvidence(assessment.id, evidenceUrl.trim(), 'Coach evidence'); setEvidenceUrl(''); await onRefresh(); onNotice({ text: 'Evidence linked to milestone.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { onBusyChange(false); } };
    return <article className="crm-assessment-card"><header><div><p className="crm-eyebrow">{assessmentChallengeLabel(assessment.challenge_type)}</p><h3>{assessment.title}</h3><span>Target: {assessment.target_value} {assessment.unit}</span></div><span className={`crm-status is-${assessment.status === 'achieved' ? 'active' : 'pending'}`}>{assessment.status.replace('_', ' ')}</span></header><form className="crm-assessment-outcome" onSubmit={saveOutcome}><div className="crm-profile-grid"><label className="crm-field">Result<input type="number" min="0" step="0.1" value={result} onChange={(event) => setResult(event.target.value)} /></label><label className="crm-field">Score (0-100)<input type="number" min="0" max="100" step="0.1" value={score} onChange={(event) => setScore(event.target.value)} /></label><SelectField label="Coach status" value={status} onChange={(value) => setStatus(value as AssessmentStatus)} options={assessmentStatusOptions} /></div><TextArea label="Coach notes" value={notes} onChange={setNotes} placeholder="What the student demonstrated and the next coaching focus." /><label className="crm-publish-toggle"><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} /><span><strong>Published</strong><small>Student sees this milestone, result, evidence, and coach notes.</small></span></label><button disabled={busy} className="crm-button crm-button-secondary">Save coach result</button></form><div className="crm-assessment-attempt"><strong>Record attempt</strong><TextArea label="Attempt note" value={attemptNotes} onChange={setAttemptNotes} placeholder="Context or observation for this attempt." /><button type="button" disabled={busy} className="crm-text-button" onClick={() => void addAttempt()}>Add attempt using current result</button></div><div className="crm-assessment-evidence"><strong>Evidence</strong>{evidence.map((item) => item.external_url && <a key={item.id} href={item.external_url} target="_blank" rel="noreferrer">{item.label || 'Open coach evidence'}</a>)}<div><input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https:// evidence link" /><button type="button" disabled={busy} className="crm-text-button" onClick={() => void addEvidence()}>Add link</button></div></div>{attempts.length > 0 && <div className="crm-assessment-attempt-history"><strong>Recent result</strong><span>{formatAssessmentResult(attempts[0].result_value, attempts[0].score)} on {formatDate(attempts[0].created_at)}</span></div>}{assessment.student_reflection && <div className="crm-homework-reflection"><strong>Student reflection</strong><span>{assessment.student_reflection}</span></div>}</article>;
}

function StudentAssessmentPanel({ assessments, attempts, evidence, onReflectionSaved }: { assessments: StudentAssessment[]; attempts: AssessmentAttempt[]; evidence: AssessmentEvidence[]; onReflectionSaved: (assessmentId: string, reflection: string) => Promise<void> }) {
    return <section className="crm-panel crm-single-panel crm-assessment-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Published by your coach</p><h2>Milestones</h2></div><span className="crm-count">{assessments.length}</span></div>{assessments.length ? <div className="crm-assessment-list">{assessments.map((assessment) => <StudentAssessmentCard key={assessment.id} assessment={assessment} attempts={attempts.filter((attempt) => attempt.student_assessment_id === assessment.id)} evidence={evidence.filter((item) => item.student_assessment_id === assessment.id)} onReflectionSaved={onReflectionSaved} />)}</div> : <div className="crm-empty-state"><p>Your coach has not published an assessment yet.</p><span>Published milestones, results, and evidence will appear here.</span></div>}</section>;
}

function StudentAssessmentCard({ assessment, attempts, evidence, onReflectionSaved }: { assessment: StudentAssessment; attempts: AssessmentAttempt[]; evidence: AssessmentEvidence[]; onReflectionSaved: (assessmentId: string, reflection: string) => Promise<void> }) {
    const [reflection, setReflection] = useState(assessment.student_reflection ?? ''); const [busy, setBusy] = useState(false); useEffect(() => setReflection(assessment.student_reflection ?? ''), [assessment.student_reflection]);
    const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); try { await onReflectionSaved(assessment.id, reflection); } finally { setBusy(false); } }; const latestAttempt = attempts[0];
    return <article className="crm-assessment-card crm-student-assessment-card"><header><div><p className="crm-eyebrow">Current milestone</p><h3>{assessment.title}</h3><span>Target: {assessment.target_value} {assessment.unit}</span></div><span className={`crm-status is-${assessment.status === 'achieved' ? 'active' : 'pending'}`}>{assessment.status.replace('_', ' ')}</span></header><dl className="crm-assessment-progress"><div><dt>Progress</dt><dd>{formatAssessmentResult(assessment.result_value, assessment.score)}</dd></div><div><dt>Coach notes</dt><dd>{assessment.notes || 'Your coach has not added notes yet.'}</dd></div></dl>{latestAttempt && <div className="crm-assessment-attempt-history"><strong>Recent result</strong><span>{formatAssessmentResult(latestAttempt.result_value, latestAttempt.score)} on {formatDate(latestAttempt.created_at)}</span></div>}{evidence.length > 0 && <div className="crm-assessment-evidence"><strong>Evidence</strong>{evidence.map((item) => item.external_url && <a key={item.id} href={item.external_url} target="_blank" rel="noreferrer">{item.label || 'Open coach evidence'}</a>)}</div>}<form className="crm-homework-completion" onSubmit={submit}><TextArea label="My reflection" value={reflection} onChange={setReflection} placeholder="What felt strong, what was difficult, and what you want to improve next." /><button disabled={busy} className="crm-button crm-button-secondary">{busy ? 'Saving...' : 'Save reflection'}</button></form></article>;
}

function StudentAssessmentSummary({ assessment, attempt }: { assessment: StudentAssessment | null; attempt: AssessmentAttempt | null }) {
    if (!assessment) return null;
    const nextAction = assessment.status === 'achieved' ? 'Your coach will set your next milestone.' : assessment.status === 'not_achieved' ? 'Review the coach notes, practice the target, then retry.' : 'Practice the target and add a reflection after your next attempt.';
    return <section className="crm-assessment-summary"><p className="crm-eyebrow">Active milestone</p><h2>{assessment.title}</h2><dl><div><dt>Target</dt><dd>{assessment.target_value} {assessment.unit}</dd></div><div><dt>Recent result</dt><dd>{attempt ? formatAssessmentResult(attempt.result_value, attempt.score) : formatAssessmentResult(assessment.result_value, assessment.score)}</dd></div><div><dt>Next action</dt><dd>{nextAction}</dd></div></dl></section>;
}

function CoachGrowthPortfolio({ student, students, records, recordMedia, homework, assessments, snapshots, reports, onSelectStudent, onRefresh, onNotice }: { student: Student | null; students: Student[]; records: CoachRecord[]; recordMedia: CoachRecordMedia[]; homework: HomeworkAssignment[]; assessments: StudentAssessment[]; snapshots: CapabilityAssessmentSnapshot[]; reports: GrowthReportSnapshot[]; onSelectStudent: (studentId: string) => void; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [scores, setScores] = useState<CapabilityScores>(emptyCapabilityScores());
    const [coachNotes, setCoachNotes] = useState('');
    const [recordSourceIds, setRecordSourceIds] = useState<string[]>([]);
    const [assessmentSourceIds, setAssessmentSourceIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const playerRecords = student ? records.filter((record) => record.student_id === student.id) : [];
    const playerHomework = student ? homework.filter((assignment) => assignment.student_id === student.id) : [];
    const playerAssessments = student ? assessments.filter((assessment) => assessment.student_id === student.id) : [];
    const playerSnapshots = student ? snapshots.filter((snapshot) => snapshot.student_id === student.id).sort((a, b) => new Date(a.assessed_at).getTime() - new Date(b.assessed_at).getTime()) : [];
    const playerReports = student ? reports.filter((report) => report.student_id === student.id) : [];
    const latestSnapshot = playerSnapshots.at(-1) ?? null;
    const saveSnapshot = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!student) return;
        setBusy(true);
        try { await coachCRMService.createCapabilitySnapshot(student.id, scores, nullableText(coachNotes), { coachRecordIds: recordSourceIds, assessmentIds: assessmentSourceIds }); setScores(emptyCapabilityScores()); setCoachNotes(''); setRecordSourceIds([]); setAssessmentSourceIds([]); await onRefresh(); onNotice({ text: 'Capability snapshot added to the portfolio.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { setBusy(false); }
    };
    return <section className="crm-panel crm-single-panel crm-portfolio-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Growth portfolio</p><h2>Progress and reports</h2></div></div><div className="crm-portfolio-layout"><aside className="crm-portfolio-roster"><strong>Roster</strong>{students.map((item) => <button type="button" key={item.id} data-active={item.id === student?.id} onClick={() => onSelectStudent(item.id)}><span className="crm-avatar">{initials(item.full_name)}</span><span>{item.full_name}<small>{item.level ?? 'Level not recorded'}</small></span></button>)}</aside><div className="crm-portfolio-main">{student ? <><SelectedPlayerContext student={student} /><section className="crm-portfolio-overview"><div><p className="crm-eyebrow">Latest capability assessment</p><h3>{latestSnapshot ? formatDate(latestSnapshot.assessed_at) : 'No capability snapshot yet'}</h3></div>{latestSnapshot ? <CapabilityRadar scores={latestSnapshot.capability_scores} /> : <p className="crm-activity-empty">Score the eight dimensions below to create the first portfolio snapshot.</p>}</section><section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Coach-scored snapshot</p><h3>Eight capability dimensions</h3></div><span className="crm-count">{playerSnapshots.length}</span></div><form className="crm-record-form" onSubmit={saveSnapshot}><div className="crm-capability-inputs">{CAPABILITY_DIMENSIONS.map((dimension) => <label key={dimension} className="crm-field">{capabilityLabel(dimension)}<input type="number" min="0" max="100" step="1" value={scores[dimension]} onChange={(event) => setScores((current) => ({ ...current, [dimension]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))} /></label>)}</div><TextArea label="Snapshot notes" value={coachNotes} onChange={setCoachNotes} placeholder="Explain the observed progression, constraints, and next coaching priority." /><details className="crm-portfolio-sources"><summary>Evidence sources (optional)</summary><div><strong>Lesson feedback</strong>{playerRecords.map((record) => <label key={record.id}><input type="checkbox" checked={recordSourceIds.includes(record.id)} onChange={() => setRecordSourceIds((current) => toggleId(current, record.id))} />{record.title}</label>) || <span>No lesson feedback available.</span>}</div><div><strong>Milestones</strong>{playerAssessments.map((assessment) => <label key={assessment.id}><input type="checkbox" checked={assessmentSourceIds.includes(assessment.id)} onChange={() => setAssessmentSourceIds((current) => toggleId(current, assessment.id))} />{assessment.title}</label>) || <span>No milestones available.</span>}</div></details><button disabled={busy} className="crm-button crm-button-primary">{busy ? 'Saving...' : 'Save capability snapshot'}</button></form></section><PortfolioTrends snapshots={playerSnapshots} assessments={playerAssessments} homework={playerHomework} /><PortfolioTimeline records={playerRecords} media={recordMedia} assessments={playerAssessments} snapshots={playerSnapshots} /><PortfolioReports student={student} latestSnapshot={latestSnapshot} reports={playerReports} records={playerRecords} assessments={playerAssessments} homework={playerHomework} busy={busy} onBusyChange={setBusy} onRefresh={onRefresh} onNotice={onNotice} /></> : <div className="crm-empty-state"><p>Select a student from the portfolio roster.</p><span>Their scored snapshots, progress trends, evidence, and reports will remain in one place.</span></div>}</div></div></section>;
}

function MobileReportsDashboard({ students, reports, snapshots, onRefresh, onNotice }: { students: Student[]; reports: GrowthReportSnapshot[]; snapshots: CapabilityAssessmentSnapshot[]; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const pending = reports.filter((report) => report.status === 'draft');
    const history = reports.filter((report) => report.status === 'published');
    const renderReport = (report: GrowthReportSnapshot) => {
        const student = students.find((item) => item.id === report.student_id);
        const snapshot = snapshots.find((item) => item.id === report.capability_snapshot_id) ?? null;
        return <MobileReportCard key={report.id} report={report} student={student} snapshot={snapshot} onRefresh={onRefresh} onNotice={onNotice} />;
    };
    return <section className="crm-mobile-reports-dashboard"><section><div className="crm-mobile-reports-heading"><div><p className="crm-eyebrow">Pending review</p><h3>Coach action needed</h3></div><span>{pending.length}</span></div>{pending.length ? pending.map(renderReport) : <p className="crm-activity-empty">No reports are waiting for review.</p>}</section><section><div className="crm-mobile-reports-heading"><div><p className="crm-eyebrow">History</p><h3>Shared reports</h3></div><span>{history.length}</span></div>{history.length ? history.map(renderReport) : <p className="crm-activity-empty">Published reports will appear here.</p>}</section></section>;
}

function MobileReportCard({ report, student, snapshot, onRefresh, onNotice }: { report: GrowthReportSnapshot; student: Student | undefined; snapshot: CapabilityAssessmentSnapshot | null; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [title, setTitle] = useState(report.title);
    const [content, setContent] = useState(report.report_content);
    const [sharing, setSharing] = useState(false);
    useEffect(() => { setTitle(report.title); setContent(report.report_content); }, [report]);
    const shareWithStudent = async () => { setSharing(true); try { await coachCRMService.updateGrowthReport(report.id, title.trim() || report.title, content); await coachCRMService.publishGrowthReport(report.id); await onRefresh(); onNotice({ text: 'Report shared with the student.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { setSharing(false); } };
    const insights = <div className="crm-mobile-report-insight"><strong>Summary</strong><p>{content.summary}</p><strong>Coaching priority</strong><p>{content.priorities}</p></div>;
    if (report.status === 'published') return <article className="crm-mobile-report-card"><div><span className="crm-status is-active">Shared with student</span><h3>{student?.full_name ?? 'Student report'}</h3><small>{report.title}</small></div>{insights}{snapshot && <MobileReportMetrics scores={snapshot.capability_scores} />}</article>;
    return <article className="crm-mobile-report-card"><div><span className="crm-status is-pending">Pending review</span><h3>{student?.full_name ?? 'Student report'}</h3></div><Field label="Report title" value={title} onChange={setTitle} required /><TextArea label="Summary" value={content.summary} onChange={(value) => setContent((current) => ({ ...current, summary: value }))} placeholder="Progress overview." required /><TextArea label="Strengths" value={content.strengths} onChange={(value) => setContent((current) => ({ ...current, strengths: value }))} placeholder="Observed strengths." required /><TextArea label="Coaching priority" value={content.priorities} onChange={(value) => setContent((current) => ({ ...current, priorities: value }))} placeholder="Key development priority." required /><TextArea label="Next steps" value={content.next_steps} onChange={(value) => setContent((current) => ({ ...current, next_steps: value }))} placeholder="Practice plan." required /><button type="button" disabled={sharing || !title.trim()} onClick={() => void shareWithStudent()}><Zap aria-hidden="true" />{sharing ? 'Sharing...' : 'Share'}</button></article>;
}

function MobileCoachDashboard({ students, records, lessons, assessments, reports }: { students: Student[]; records: CoachRecord[]; lessons: Lesson[]; assessments: StudentAssessment[]; reports: GrowthReportSnapshot[] }) {
    const activeStudents = students.filter((student) => student.invitation_status === 'active').length;
    const recentLessons = records.filter((record) => new Date(record.lesson_date ?? record.created_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000).length;
    const activeMilestones = assessments.filter((assessment) => assessment.status === 'in_progress').length;
    const scheduledLessons = lessons.filter((lesson) => lesson.status === 'scheduled').length;
    const completedLessons = lessons.filter((lesson) => lesson.status === 'completed').length;
    const availableCredits = students.reduce((total, student) => total + student.remaining_credits, 0);
    return <section className="crm-mobile-coach-dashboard"><section className="crm-mobile-dashboard-summary"><div><span>Students</span><strong>{students.length}</strong><small>{activeStudents} active</small></div><div><span>Scheduled</span><strong>{scheduledLessons}</strong><small>{completedLessons} completed</small></div><div><span>Credits</span><strong>{availableCredits}</strong><small>available to book</small></div></section><section className="crm-mobile-dashboard-analysis"><p className="crm-eyebrow">Coaching pulse</p><h2>Schedule and records</h2><div><span><strong>{recentLessons}</strong> coaching records in 30 days</span><span><strong>{activeMilestones}</strong> active milestones</span></div></section></section>;
}

function MobileReportMetrics({ scores }: { scores: CapabilityScores | null }) {
    const metrics: [CapabilityDimension, string][] = [['forehand_drive', 'Forehand'], ['backhand_drive', 'Backhand'], ['serve_and_return', 'Serve'], ['forehand_volley', 'Volley'], ['footwork', 'Footwork']];
    return <div className="crm-mobile-report-metrics">{metrics.map(([dimension, label]) => <div key={dimension}><span>{label}</span><i><b style={{ width: `${scores?.[dimension] ?? 0}%` }} /></i><strong>{scores?.[dimension] ?? 0}%</strong></div>)}</div>;
}

function CapabilityRadar({ scores }: { scores: CapabilityScores }) {
    const size = 340; const center = size / 2; const radius = 104; const angles = CAPABILITY_DIMENSIONS.map((_, index) => index * (2 * Math.PI / CAPABILITY_DIMENSIONS.length) - Math.PI / 2); const points = (ratio: number) => angles.map((angle) => `${center + radius * ratio * Math.cos(angle)},${center + radius * ratio * Math.sin(angle)}`).join(' '); const scorePoints = CAPABILITY_DIMENSIONS.map((dimension, index) => `${center + radius * (scores[dimension] / 100) * Math.cos(angles[index])},${center + radius * (scores[dimension] / 100) * Math.sin(angles[index])}`).join(' ');
    return <svg className="crm-capability-radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Eight-dimension capability radar chart"><polygon points={points(1)} className="crm-radar-grid" />{[.25, .5, .75].map((level) => <polygon key={level} points={points(level)} className="crm-radar-grid" />)}{angles.map((angle, index) => <g key={CAPABILITY_DIMENSIONS[index]}><line x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} className="crm-radar-axis" /><text x={center + (radius + 28) * Math.cos(angle)} y={center + (radius + 28) * Math.sin(angle)} textAnchor={Math.cos(angle) > .25 ? 'start' : Math.cos(angle) < -.25 ? 'end' : 'middle'}>{capabilityShortLabel(CAPABILITY_DIMENSIONS[index])}</text></g>)}<polygon points={scorePoints} className="crm-radar-shape" />{CAPABILITY_DIMENSIONS.map((dimension, index) => <circle key={dimension} cx={center + radius * (scores[dimension] / 100) * Math.cos(angles[index])} cy={center + radius * (scores[dimension] / 100) * Math.sin(angles[index])} r="3.5" className="crm-radar-point" />)}</svg>;
}

function PortfolioTrends({ snapshots, assessments, homework }: { snapshots: Array<Pick<CapabilityAssessmentSnapshot, 'capability_scores' | 'assessed_at'>>; assessments: StudentAssessment[]; homework: HomeworkAssignment[] }) {
    const capabilityPoints = snapshots.map((snapshot) => ({ label: formatDate(snapshot.assessed_at), value: averageCapabilityScore(snapshot.capability_scores) }));
    const assessmentPoints = assessments.filter((assessment) => assessment.score !== null).slice().reverse().map((assessment) => ({ label: formatDate(assessment.created_at), value: assessment.score ?? 0 }));
    const homeworkCompletion = homework.length ? Math.round(homework.filter((assignment) => assignment.status !== 'assigned').length / homework.length * 100) : 0;
    return <section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Progress trends</p><h3>Scores, training volume, and completion</h3></div></div><div className="crm-portfolio-trends"><TrendLine title="Capability average" points={capabilityPoints} /><TrendLine title="Assessment scores" points={assessmentPoints} /><div className="crm-trend-metric"><strong>{homeworkCompletion}%</strong><span>Homework completion</span><small>{homework.filter((assignment) => assignment.status !== 'assigned').length} of {homework.length} assignments completed or reviewed</small></div><div className="crm-trend-metric"><strong>{snapshots.length}</strong><span>Capability snapshots</span><small>{assessments.length} milestones and {homework.length} practice assignments in this portfolio</small></div></div></section>;
}

function TrendLine({ title, points }: { title: string; points: { label: string; value: number }[] }) {
    const width = 300; const height = 116; const values = points.length ? points : [{ label: 'No data', value: 0 }]; const path = values.map((point, index) => `${index ? 'L' : 'M'} ${20 + index * ((width - 40) / Math.max(1, values.length - 1))} ${height - 20 - point.value * .76}`).join(' ');
    return <div className="crm-trend-chart"><strong>{title}</strong><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} line chart`}><line x1="20" y1={height - 20} x2={width - 20} y2={height - 20} className="crm-trend-axis" /><path d={path} className="crm-trend-line" />{values.map((point, index) => <circle key={`${point.label}-${index}`} cx={20 + index * ((width - 40) / Math.max(1, values.length - 1))} cy={height - 20 - point.value * .76} r="3" className="crm-trend-dot" />)}</svg><small>{points.length ? `${points.length} recorded point${points.length === 1 ? '' : 's'}` : 'No recorded points yet'}</small></div>;
}

function PortfolioTimeline({ records, media, assessments, snapshots }: { records: CoachRecord[]; media: CoachRecordMedia[]; assessments: StudentAssessment[]; snapshots: CapabilityAssessmentSnapshot[] }) {
    const events = [
        ...records.map((record) => ({ id: `record-${record.id}`, date: record.created_at, type: 'Lesson feedback', title: record.title, detail: `${media.filter((item) => item.coach_record_id === record.id).length} media item(s)` })),
        ...assessments.map((assessment) => ({ id: `assessment-${assessment.id}`, date: assessment.created_at, type: 'Milestone', title: assessment.title, detail: `${assessment.status.replace('_', ' ')} · ${formatAssessmentResult(assessment.result_value, assessment.score)}` })),
        ...snapshots.map((snapshot) => ({ id: `snapshot-${snapshot.id}`, date: snapshot.assessed_at, type: 'Capability snapshot', title: `Average ${averageCapabilityScore(snapshot.capability_scores)}%`, detail: snapshot.coach_notes || 'Coach-scored eight-dimension snapshot' })),
    ].sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());
    return <section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Evidence timeline</p><h3>Lessons, milestones, media, and snapshots</h3></div><span className="crm-count">{events.length}</span></div>{events.length ? <div className="crm-portfolio-timeline">{events.slice(0, 12).map((event) => <article key={event.id}><time>{formatDate(event.date)}</time><div><span>{event.type}</span><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}</div> : <p className="crm-activity-empty">Evidence will appear as feedback, milestones, media, and snapshots are recorded.</p>}</section>;
}

function PortfolioReports({ student, latestSnapshot, reports, records, assessments, homework, busy, onBusyChange, onRefresh, onNotice }: { student: Student; latestSnapshot: CapabilityAssessmentSnapshot | null; reports: GrowthReportSnapshot[]; records: CoachRecord[]; assessments: StudentAssessment[]; homework: HomeworkAssignment[]; busy: boolean; onBusyChange: (busy: boolean) => void; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const createDraft = async () => { onBusyChange(true); try { const content = makeGrowthReportContent(student, records, []); await coachCRMService.createGrowthReport(student.id, latestSnapshot?.id ?? null, `${student.full_name} growth report`, content); await onRefresh(); onNotice({ text: 'Structured report draft created for coach review.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { onBusyChange(false); } };
    return <section className="crm-portfolio-section"><div className="crm-panel-heading"><div><p className="crm-eyebrow">One-page reports</p><h3>Review before publishing</h3></div><button type="button" disabled={busy} className="crm-button crm-button-primary" onClick={() => void createDraft()}>Generate draft</button></div>{reports.length ? <div className="crm-report-list">{reports.map((report) => <GrowthReportEditor key={report.id} report={report} busy={busy} onBusyChange={onBusyChange} onRefresh={onRefresh} onNotice={onNotice} />)}</div> : <p className="crm-activity-empty">Generate a draft from the current structured portfolio data, then review and publish it for the student.</p>}</section>;
}

function GrowthReportEditor({ report, busy, onBusyChange, onRefresh, onNotice }: { report: GrowthReportSnapshot; busy: boolean; onBusyChange: (busy: boolean) => void; onRefresh: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [title, setTitle] = useState(report.title); const [content, setContent] = useState<GrowthReportContent>(report.report_content);
    useEffect(() => { setTitle(report.title); setContent(report.report_content); }, [report]);
    const save = async () => { onBusyChange(true); try { await coachCRMService.updateGrowthReport(report.id, title, content); await onRefresh(); onNotice({ text: 'Report draft saved.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { onBusyChange(false); } };
    const publish = async () => { if (!window.confirm('Publish this reviewed report to the student? Published snapshots cannot be edited or deleted.')) return; onBusyChange(true); try { await coachCRMService.publishGrowthReport(report.id); await onRefresh(); onNotice({ text: 'Report published and locked.', tone: 'success' }); } catch (error) { onNotice({ text: messageFrom(error), tone: 'error' }); } finally { onBusyChange(false); } };
    return <article className="crm-growth-report"><div className="crm-record-meta"><span>{formatDate(report.created_at)}</span><span className={`crm-status is-${report.status === 'published' ? 'active' : 'pending'}`}>{report.status}</span></div>{report.status === 'draft' ? <><Field label="Report title" value={title} onChange={setTitle} required /><TextArea label="Summary" value={content.summary} onChange={(value) => setContent((current) => ({ ...current, summary: value }))} placeholder="Progress overview." /><TextArea label="Strengths" value={content.strengths} onChange={(value) => setContent((current) => ({ ...current, strengths: value }))} placeholder="Observed strengths." /><TextArea label="Priorities" value={content.priorities} onChange={(value) => setContent((current) => ({ ...current, priorities: value }))} placeholder="Key development priorities." /><TextArea label="Next steps" value={content.next_steps} onChange={(value) => setContent((current) => ({ ...current, next_steps: value }))} placeholder="Practice and lesson plan." /><div className="crm-profile-actions"><button type="button" disabled={busy} className="crm-button crm-button-secondary" onClick={() => void save()}>Save review</button><button type="button" disabled={busy} className="crm-button crm-button-primary" onClick={() => void publish()}>Publish report</button></div></> : <><h4>{report.title}</h4><ReportContent content={report.report_content} /><div className="crm-profile-actions"><button type="button" className="crm-button crm-button-secondary" onClick={() => downloadGrowthReport(report)}>Download report</button><button type="button" className="crm-text-button" onClick={() => window.print()}>Print / save PDF</button></div></>}</article>;
}

function ReportContent({ content }: { content: GrowthReportContent }) { return <dl className="crm-report-content"><div><dt>Summary</dt><dd>{content.summary}</dd></div><div><dt>Strengths</dt><dd>{content.strengths}</dd></div><div><dt>Priorities</dt><dd>{content.priorities}</dd></div><div><dt>Next steps</dt><dd>{content.next_steps}</dd></div></dl>; }

function PlannedWorkspace({ student, title, detail }: { student: Student | null; title: string; detail: string }) {
    return <section className="crm-panel crm-single-panel crm-planned-workspace">
        {student && <SelectedPlayerContext student={student} />}
        <div className="crm-empty-state"><p>{student ? title : 'Choose a student in Student management first.'}</p><span>{student ? detail : 'The selected student will remain in context across each coaching workspace.'}</span></div>
    </section>;
}

function CoachHomeworkPanel({ student, students, selectedStudentIds, assignments, evidence, resources, title, instructions, dueAt, category, resourceFiles, busy, onTitleChange, onInstructionsChange, onDueAtChange, onCategoryChange, onResourceFilesChange, onSelectedStudentsChange, onSubmit, onReview }: { student: Student | null; students: Student[]; selectedStudentIds: string[]; assignments: HomeworkAssignment[]; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[]; title: string; instructions: string; dueAt: string; category: string; resourceFiles: File[]; busy: boolean; onTitleChange: (value: string) => void; onInstructionsChange: (value: string) => void; onDueAtChange: (value: string) => void; onCategoryChange: (value: string) => void; onResourceFilesChange: (files: File[]) => void; onSelectedStudentsChange: (studentIds: string[]) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onReview: (homeworkId: string) => Promise<void> }) {
    if (!students.length) return <PlannedWorkspace student={null} title="" detail="" />;
    const assigned = assignments.filter((assignment) => assignment.status === 'assigned');
    const completed = assignments.filter((assignment) => assignment.status === 'completed');
    const reviewed = assignments.filter((assignment) => assignment.status === 'reviewed');
    const toggleStudent = (studentId: string) => onSelectedStudentsChange(selectedStudentIds.includes(studentId) ? selectedStudentIds.filter((id) => id !== studentId) : [...selectedStudentIds, studentId]);
    return <section className="crm-panel crm-single-panel crm-homework-panel">{student && <SelectedPlayerContext student={student} />}<div className="crm-panel-heading"><div><p className="crm-eyebrow">Assign practice</p><h2>Homework assignments</h2></div><span className="crm-count">{assignments.length}</span></div><form className="crm-record-form" onSubmit={onSubmit}><fieldset className="crm-homework-recipients"><legend>Assign to</legend><div className="crm-homework-recipient-actions"><button type="button" className="crm-text-button" onClick={() => onSelectedStudentsChange(students.map((item) => item.id))}>Select all</button><button type="button" className="crm-text-button" onClick={() => onSelectedStudentsChange([])}>Clear</button></div><div>{students.map((item) => <label key={item.id}><input type="checkbox" checked={selectedStudentIds.includes(item.id)} onChange={() => toggleStudent(item.id)} /><span>{item.full_name}</span></label>)}</div></fieldset><Field label="Assignment title" value={title} onChange={onTitleChange} required /><TextArea label="Instructions" value={instructions} onChange={onInstructionsChange} placeholder="Describe the drill, repetitions, focus, and success criteria." required /><div className="crm-profile-grid"><label className="crm-field">Drill category<select value={category} onChange={(event) => onCategoryChange(event.target.value)}>{homeworkCategoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="crm-field">Due date<input type="datetime-local" value={dueAt} onChange={(event) => onDueAtChange(event.target.value)} /></label></div><label className="crm-field">Coach resources (optional)<input type="file" accept="image/*,video/*" multiple onChange={(event) => onResourceFilesChange(Array.from(event.target.files ?? []))} /></label>{resourceFiles.length > 0 && <p className="crm-file-summary">{resourceFiles.length} image/video file{resourceFiles.length === 1 ? '' : 's'} will be copied to each selected student.</p>}<button disabled={busy || !selectedStudentIds.length} className="crm-button crm-button-primary">{busy ? 'Assigning...' : `Assign to ${selectedStudentIds.length} student${selectedStudentIds.length === 1 ? '' : 's'}`}</button></form>{student && <><CoachHomeworkGroup title="Outstanding" assignments={assigned} evidence={evidence} resources={resources} empty="No outstanding homework for this student." onReview={onReview} busy={busy} /><CoachHomeworkGroup title="Completed and ready to review" assignments={completed} evidence={evidence} resources={resources} empty="Completed homework and student evidence will appear here." onReview={onReview} busy={busy} /><CoachHomeworkGroup title="Reviewed" assignments={reviewed} evidence={evidence} resources={resources} empty="Reviewed homework will appear here." onReview={onReview} busy={busy} /></>}</section>;
}

function CoachHomeworkGroup({ title, assignments, evidence, resources, empty, onReview, busy }: { title: string; assignments: HomeworkAssignment[]; evidence: HomeworkEvidence[]; resources: HomeworkResourceMedia[]; empty: string; onReview: (homeworkId: string) => Promise<void>; busy: boolean }) {
    return <section className="crm-homework-group"><div className="crm-homework-group-heading"><h3>{title}</h3><span>{assignments.length}</span></div>{assignments.length === 0 ? <p className="crm-activity-empty">{empty}</p> : <div className="crm-homework-list">{assignments.map((assignment) => <article className="crm-homework-card" key={assignment.id}><div className="crm-homework-card-heading"><div><h4>{assignment.title}</h4><span className="crm-homework-due">{assignment.due_at ? `Due ${formatDate(assignment.due_at)}` : 'No due date'}</span></div><span className={`crm-status is-${assignment.status === 'assigned' ? 'pending' : 'active'}`}>{assignment.status}</span></div>{assignment.drill_category && <span className="crm-homework-category">{assignment.drill_category}</span>}<p>{assignment.instructions}</p><HomeworkResourceList resources={resources.filter((item) => item.homework_assignment_id === assignment.id)} />{assignment.status !== 'assigned' && <><div className="crm-homework-reflection"><strong>Student reflection</strong><span>{assignment.student_reflection || 'No reflection added.'}</span></div><HomeworkEvidenceList evidence={evidence.filter((item) => item.homework_assignment_id === assignment.id)} />{assignment.status === 'completed' && <button type="button" disabled={busy} className="crm-button crm-button-secondary" onClick={() => void onReview(assignment.id)}>Mark reviewed</button>}</>}</article>)}</div>}</section>;
}

function SelectedPlayerContext({ student }: { student: Student }) {
    return <div className="crm-card-player"><span className="crm-avatar">{initials(student.full_name)}</span><div><strong>{student.full_name}</strong><small>{student.email} · {student.invitation_status === 'active' ? 'Active player' : 'Pending invitation'}</small></div></div>;
}

function StudentOverviewCards({ students, selectedId, onSelect, onOpenProfile }: { students: Student[]; selectedId: string; onSelect: (studentId: string) => void; onOpenProfile: (studentId: string) => void }) {
    return <section className="crm-student-overview-cards" aria-label="Student profiles">{students.length ? <div className="crm-student-card-list">{students.map((student) => <article key={student.id} className="crm-student-overview-card" data-selected={student.id === selectedId}><button type="button" className="crm-student-card-summary" onClick={() => onSelect(student.id)} aria-pressed={student.id === selectedId}><span className="crm-student-photo" aria-label={`Profile photo placeholder for ${student.full_name}`}>{initials(student.full_name)}</span><span><strong>{student.full_name}</strong><small>{student.level ?? 'Level not recorded'} · {student.dominant_hand ? `${student.dominant_hand} hand` : 'Hand not recorded'}</small><em>{getStudentActivityStatus(student) === 'active' ? 'Active player' : 'Inactive player'}</em></span></button><button type="button" className="crm-text-button" onClick={() => onOpenProfile(student.id)}>View profile</button></article>)}</div> : <div className="crm-empty-state"><p>No students registered yet.</p><span>Add a student in Student management to build your overview.</span></div>}</section>;
}

function MobileBottomSheet({ sheet, students, onClose, onCreated, onSaved, onNotice }: { sheet: Exclude<MobileSheetState, null>; students: Student[]; onClose: () => void; onCreated: (student: Student) => void; onSaved: () => Promise<void>; onNotice: (notice: NoticeState) => void }) {
    const [note, setNote] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [hand, setHand] = useState<Student['dominant_hand']>('right');
    const [level, setLevel] = useState('Intermediate');
    const [busy, setBusy] = useState(false);
    const student = sheet.mode === 'quick-note' ? students.find((item) => item.id === sheet.studentId) ?? null : null;
    const save = async () => {
        setBusy(true);
        try {
            if (sheet.mode === 'quick-note') {
                if (!student || !note.trim()) throw new Error('Add a quick note before saving.');
                await coachCRMService.createCoachRecord(student.id, { title: 'Quick court note', body: note.trim(), lesson_date: new Date().toISOString().slice(0, 10), skill: null, focus_area: null, evidence_links: [] }, false);
                await onSaved();
            } else {
                if (!name.trim() || !email.trim()) throw new Error('Student name and Gmail are required.');
                const created = await coachCRMService.createStudent({ ...emptyStudentProfile(), full_name: name.trim(), email: email.trim(), dominant_hand: hand, level });
                onCreated(created);
            }
        } catch (error) {
            onNotice({ text: messageFrom(error), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };
    return <div className="crm-mobile-sheet-backdrop" role="presentation" onMouseDown={onClose}><section className="crm-mobile-sheet" role="dialog" aria-modal="true" aria-label={sheet.mode === 'quick-note' ? 'Quick note' : 'Add student'} onMouseDown={(event) => event.stopPropagation()}><div className="crm-mobile-sheet-handle" /><header><div><p className="crm-eyebrow">{sheet.mode === 'quick-note' ? 'Quick log' : 'New student'}</p><h2>{sheet.mode === 'quick-note' ? `Note for ${student?.full_name ?? 'student'}` : 'Add student'}</h2></div><button type="button" onClick={onClose} aria-label="Close">Close</button></header>{sheet.mode === 'quick-note' ? <label className="crm-mobile-sheet-note">What happened on court?<textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="Capture the key coaching point..." /></label> : <div className="crm-mobile-sheet-form"><Field label="Student name" value={name} onChange={setName} required /><Field label="Student Gmail" type="email" value={email} onChange={setEmail} required /><MobileChoiceGroup label="Handedness" value={hand ?? 'right'} options={[['left', 'Left-Handed'], ['right', 'Right-Handed']]} onChange={(value) => setHand(value as Student['dominant_hand'])} /><MobileChoiceGroup label="Level" value={level} options={['Beginner', 'Intermediate', 'Advanced'].map((item) => [item, item] as [string, string])} onChange={setLevel} /></div>}<button type="button" disabled={busy} className="crm-mobile-sheet-save" onClick={() => void save()}>{busy ? 'Saving...' : 'Save Changes'}</button></section></div>;
}

function MobileChoiceGroup({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
    return <fieldset className="crm-mobile-choice-group"><legend>{label}</legend><div>{options.map(([optionValue, optionLabel]) => <button type="button" key={optionValue} data-selected={value === optionValue} onClick={() => onChange(optionValue)}>{optionLabel}</button>)}</div></fieldset>;
}

function PlayerDesk({ student, coachRecords, studentFeedback, recordMedia, assessments, attempts }: { student: Student | null; coachRecords: CoachRecord[]; studentFeedback: StudentRecord[]; recordMedia: CoachRecordMedia[]; assessments: StudentAssessment[]; attempts: AssessmentAttempt[] }) {
    if (!student) return <section id="player-desk" className="crm-player-desk crm-empty-state"><p>Select a player from the roster.</p><span>The player desk will show their lesson outcomes and practice feedback here.</span></section>;

    const playerRecords = coachRecords.filter((record) => record.student_id === student.id);
    const playerFeedback = studentFeedback.filter((record) => record.student_id === student.id);
    const milestone = activeAssessment(assessments.filter((assessment) => assessment.student_id === student.id));

    return <section id="player-desk" className="crm-player-desk" aria-label={`${student.full_name} player desk`}>
        <div className="crm-player-desk-heading">
            <div><p className="crm-eyebrow">Selected player</p><h2>{student.full_name}</h2><span>{student.email} · {student.invitation_status === 'active' ? 'Active account' : 'Pending first sign-in'}</span></div>
            <div className="crm-player-stats"><span><strong>{playerRecords.length}</strong> lesson outcomes</span><span><strong>{playerFeedback.length}</strong> practice reflections</span></div>
        </div>
        <StudentAssessmentSummary assessment={milestone} attempt={latestAttemptFor(milestone, attempts)} />
        <div className="crm-player-feed-grid">
            <ActivityFeed title="Your coaching records" empty="No lesson outcomes for this player yet." records={playerRecords} type="coach" media={recordMedia} />
            <ActivityFeed title="Student practice feedback" empty="This player has not shared a practice reflection yet." records={playerFeedback} type="student" />
        </div>
    </section>;
}

function ActivityFeed({ title, empty, records, type, media = [] }: { title: string; empty: string; records: CoachRecord[] | StudentRecord[]; type: 'coach' | 'student'; media?: CoachRecordMedia[] }) {
    return <section className="crm-activity-feed"><div><p className="crm-eyebrow">{type === 'coach' ? 'Coach activity' : 'Player activity'}</p><h3>{title}</h3></div>{records.length === 0 ? <p className="crm-activity-empty">{empty}</p> : <div className="crm-activity-list">{records.slice(0, 3).map((record) => <article key={record.id}><span>{formatDate(record.created_at)}</span><strong>{record.title}</strong><p>{record.body}</p>{type === 'coach' && <RecordAttachments media={media.filter((item) => item.coach_record_id === record.id)} compact />}</article>)}</div>}</section>;
}

function FilterField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
    return <label className="crm-filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function RosterInsights({ summary }: { summary: ReturnType<typeof getRosterSummary> }) {
    return <section className="crm-roster-insights" aria-label="Roster profile distribution"><span>Gender: {summary.female} female · {summary.male} male · {summary.nonbinary} nonbinary</span><span>Age: {summary.under13} under 13 · {summary.teen} teens · {summary.adult} adults</span><span>Handedness: {summary.leftHanded} left · {summary.rightHanded} right</span><span>Levels: {Object.entries(summary.levels).map(([level, count]) => `${level} (${count})`).join(' · ') || 'Not recorded'}</span></section>;
}

function StudentProfileCreateForm({ onCreated }: { onCreated: (student: Student) => void }) {
    const [form, setForm] = useState<StudentProfileInput>(emptyStudentProfile());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            onCreated(await coachCRMService.createStudent(form));
            setForm(emptyStudentProfile());
        } catch (createError) {
            setError(messageFrom(createError));
        } finally {
            setBusy(false);
        }
    };
    return <form className="crm-profile-editor crm-profile-create" onSubmit={submit}><div className="crm-profile-editor-heading"><div><p className="crm-eyebrow">New student</p><h3>Create a complete student profile</h3><span>Only the name and Gmail are required. Add useful context now or fill it in later.</span></div></div><div className="crm-profile-section"><h4>Contact and playing profile</h4><div className="crm-profile-grid"><Field label="Full name" value={form.full_name} onChange={(value) => setForm((current) => ({ ...current, full_name: value }))} required /><Field label="Student Gmail" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} required /><label className="crm-field">Date of birth<input type="date" value={form.date_of_birth ?? ''} onChange={(event) => setForm((current) => ({ ...current, date_of_birth: nullableText(event.target.value) }))} /></label><SelectField label="Gender" value={form.gender ?? ''} onChange={(value) => setForm((current) => ({ ...current, gender: value as Student['gender'] }))} options={genderOptions} /><Field label="Level" value={form.level ?? ''} onChange={(value) => setForm((current) => ({ ...current, level: nullableText(value) }))} /><SelectField label="Dominant hand" value={form.dominant_hand ?? ''} onChange={(value) => setForm((current) => ({ ...current, dominant_hand: value as Student['dominant_hand'] }))} options={handOptions} /><SelectField label="Dominant eye" value={form.dominant_eye ?? ''} onChange={(value) => setForm((current) => ({ ...current, dominant_eye: value as Student['dominant_eye'] }))} options={handOptions} /></div></div><div className="crm-profile-section"><h4>Racket and shoes</h4><div className="crm-profile-grid"><Field label="Racket brand" value={form.racket_brand ?? ''} onChange={(value) => setForm((current) => ({ ...current, racket_brand: nullableText(value) }))} /><Field label="Racket model" value={form.racket_model ?? ''} onChange={(value) => setForm((current) => ({ ...current, racket_model: nullableText(value) }))} /><Field label="String" value={form.racket_string ?? ''} onChange={(value) => setForm((current) => ({ ...current, racket_string: nullableText(value) }))} /><NumberField label="Head size (sq in)" value={form.racket_head_size_sq_in} onChange={(value) => setForm((current) => ({ ...current, racket_head_size_sq_in: value }))} /><NumberField label="Weight (g)" value={form.racket_weight_g} onChange={(value) => setForm((current) => ({ ...current, racket_weight_g: value }))} /><NumberField label="String tension (lbs)" value={form.racket_string_tension_lbs} onChange={(value) => setForm((current) => ({ ...current, racket_string_tension_lbs: value }))} /><Field label="Shoes used" value={form.shoes_used ?? ''} onChange={(value) => setForm((current) => ({ ...current, shoes_used: nullableText(value) }))} /></div></div><div className="crm-profile-section"><h4>Coaching context</h4><div className="crm-profile-grid"><label className="crm-field">Goals<textarea value={form.goals ?? ''} onChange={(event) => setForm((current) => ({ ...current, goals: nullableText(event.target.value) }))} placeholder="What this student wants to achieve." /></label><label className="crm-field">Restrictions and considerations<textarea value={form.restrictions ?? ''} onChange={(event) => setForm((current) => ({ ...current, restrictions: nullableText(event.target.value) }))} placeholder="Injuries, access needs, or training constraints." /></label></div></div>{error && <p className="crm-profile-error" role="alert">{error}</p>}<div className="crm-profile-actions"><button disabled={busy} className="crm-button crm-button-secondary">{busy ? 'Creating...' : 'Create student profile'}</button></div></form>;
}

function StudentProfileEditor({ student, onSaved, onArchive, onRestore }: { student: Student; onSaved: (student: Student) => void; onArchive: (student: Student) => Promise<void>; onRestore: (student: Student) => Promise<void> }) {
    const [form, setForm] = useState<StudentProfileInput>(() => toStudentProfileInput(student));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setForm(toStudentProfileInput(student));
        setError('');
    }, [student]);

    const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            onSaved(await coachCRMService.updateStudent(student.id, form));
        } catch (saveError) {
            setError(messageFrom(saveError));
        } finally {
            setBusy(false);
        }
    };

    const isArchived = getStudentActivityStatus(student) === 'archived';
    const archiveProfile = async () => {
        if (!window.confirm(`Archive ${student.full_name}? They will no longer be able to access their student profile.`)) return;
        setBusy(true);
        setError('');
        try {
            await onArchive(student);
        } catch (archiveError) {
            setError(messageFrom(archiveError));
        } finally {
            setBusy(false);
        }
    };

    const restoreProfile = async () => {
        if (!window.confirm(`Restore ${student.full_name}? They will be able to access their student profile again.`)) return;
        setBusy(true);
        setError('');
        try {
            await onRestore(student);
        } catch (restoreError) {
            setError(messageFrom(restoreError));
        } finally {
            setBusy(false);
        }
    };

    return <form className="crm-profile-editor" onSubmit={saveProfile}>
        <div className="crm-profile-editor-heading"><div><p className="crm-eyebrow">Selected student</p><h3>{student.full_name}</h3><span>{getStudentActivityStatus(student) === 'active' ? 'Active: lesson within the past 30 days' : isArchived ? `Archived${student.student_archived_at ? ` ${formatDate(student.student_archived_at)}` : ''}` : 'Inactive: no lesson within the past 30 days'}</span></div>{isArchived ? <button type="button" className="crm-text-button" disabled={busy} onClick={() => void restoreProfile()}>Restore student</button> : <button type="button" className="crm-text-button crm-archive-button" disabled={busy} onClick={() => void archiveProfile()}>Archive student</button>}</div>
        <div className="crm-profile-section"><h4>Contact and playing profile</h4><div className="crm-profile-grid"><Field label="Full name" value={form.full_name} onChange={(value) => setForm((current) => ({ ...current, full_name: value }))} required /><Field label="Student Gmail" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} required /><label className="crm-field">Date of birth<input type="date" value={form.date_of_birth ?? ''} onChange={(event) => setForm((current) => ({ ...current, date_of_birth: nullableText(event.target.value) }))} /></label><SelectField label="Gender" value={form.gender ?? ''} onChange={(value) => setForm((current) => ({ ...current, gender: value as Student['gender'] }))} options={[['', 'Not recorded'], ['female', 'Female'], ['male', 'Male'], ['nonbinary', 'Nonbinary'], ['prefer_not_to_say', 'Prefer not to say']]} /><Field label="Level" value={form.level ?? ''} onChange={(value) => setForm((current) => ({ ...current, level: nullableText(value) }))} /><SelectField label="Dominant hand" value={form.dominant_hand ?? ''} onChange={(value) => setForm((current) => ({ ...current, dominant_hand: value as Student['dominant_hand'] }))} options={[['', 'Not recorded'], ['right', 'Right'], ['left', 'Left']]} /><SelectField label="Dominant eye" value={form.dominant_eye ?? ''} onChange={(value) => setForm((current) => ({ ...current, dominant_eye: value as Student['dominant_eye'] }))} options={[['', 'Not recorded'], ['right', 'Right'], ['left', 'Left']]} /><label className="crm-field">Last lesson date<input type="datetime-local" value={toLocalDateTime(form.last_lesson_at)} onChange={(event) => setForm((current) => ({ ...current, last_lesson_at: event.target.value ? new Date(event.target.value).toISOString() : null }))} /></label></div></div>
        <div className="crm-profile-section"><h4>Racket and shoes</h4><div className="crm-profile-grid"><Field label="Racket brand" value={form.racket_brand ?? ''} onChange={(value) => setForm((current) => ({ ...current, racket_brand: nullableText(value) }))} /><Field label="Racket model" value={form.racket_model ?? ''} onChange={(value) => setForm((current) => ({ ...current, racket_model: nullableText(value) }))} /><Field label="String" value={form.racket_string ?? ''} onChange={(value) => setForm((current) => ({ ...current, racket_string: nullableText(value) }))} /><NumberField label="Head size (sq in)" value={form.racket_head_size_sq_in} onChange={(value) => setForm((current) => ({ ...current, racket_head_size_sq_in: value }))} /><NumberField label="Weight (g)" value={form.racket_weight_g} onChange={(value) => setForm((current) => ({ ...current, racket_weight_g: value }))} /><NumberField label="String tension (lbs)" value={form.racket_string_tension_lbs} onChange={(value) => setForm((current) => ({ ...current, racket_string_tension_lbs: value }))} /><Field label="Shoes used" value={form.shoes_used ?? ''} onChange={(value) => setForm((current) => ({ ...current, shoes_used: nullableText(value) }))} /></div></div>
        <div className="crm-profile-section"><h4>Coaching context</h4><div className="crm-profile-grid"><TextArea label="Goals" value={form.goals ?? ''} onChange={(value) => setForm((current) => ({ ...current, goals: nullableText(value) }))} placeholder="What this student wants to achieve." /><TextArea label="Restrictions and considerations" value={form.restrictions ?? ''} onChange={(value) => setForm((current) => ({ ...current, restrictions: nullableText(value) }))} placeholder="Injuries, access needs, or training constraints." /></div></div>
        {error && <p className="crm-profile-error" role="alert">{error}</p>}
        <div className="crm-profile-actions"><button disabled={busy} className="crm-button crm-button-primary">{busy ? 'Saving...' : 'Save student profile'}</button></div>
    </form>;
}

function StudentList({ students, selectedId, onSelect, onQuickNote, onVoiceInput, coachRecords, studentFeedback, loading, emptyMessage }: { students: Student[]; selectedId: string; onSelect: (id: string) => void; onQuickNote: (id: string) => void; onVoiceInput: (id: string) => void; coachRecords: CoachRecord[]; studentFeedback: StudentRecord[]; loading: boolean; emptyMessage?: string }) {
    if (loading) return <div className="crm-empty-state"><span className="crm-loader" /><p>Loading your roster.</p></div>;
    if (students.length === 0) return <div className="crm-empty-state"><p>{emptyMessage ?? 'No students registered yet.'}</p><span>{emptyMessage ? 'Try a different name or Gmail.' : 'Add a student with their Gmail to give them access.'}</span></div>;
    return <div className="crm-student-list">{students.map((student) => {
        const logs = [
            ...coachRecords.filter((record) => record.student_id === student.id).map((record) => ({ id: `coach-${record.id}`, date: record.lesson_date ?? record.created_at, title: record.title })),
            ...studentFeedback.filter((record) => record.student_id === student.id).map((record) => ({ id: `student-${record.id}`, date: record.created_at, title: record.title })),
        ].sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());
        const activityStatus = getStudentActivityStatus(student);
        return <article key={student.id} className={`crm-student-row ${student.id === selectedId ? 'is-selected' : ''}`}><button type="button" className="crm-student-row-main" onClick={() => onSelect(student.id)}><span className="crm-student-copy"><strong>{student.full_name}</strong><small>{student.email}</small><em>Level: {student.level ?? 'Not recorded'} · {student.dominant_hand ? `${student.dominant_hand === 'right' ? 'Right' : 'Left'}-Handed` : 'Hand not recorded'}</em></span><span className={`crm-status is-${activityStatus}`}>{activityStatus}</span><span className="crm-student-log-summary" aria-label={`Recent logs for ${student.full_name}`}>{logs.length ? logs.map((log) => <span key={log.id} className="crm-student-log-summary-item"><time dateTime={log.date}>{formatDate(log.date)}</time><strong>{log.title}</strong></span>) : <span className="crm-student-log-summary-empty">No logs yet</span>}</span></button><div className="crm-student-row-actions"><button type="button" onClick={() => onQuickNote(student.id)} aria-label={`Quick note for ${student.full_name}`} title="Quick Note"><Zap aria-hidden="true" /><span>Quick Note</span></button><button type="button" onClick={() => onVoiceInput(student.id)} aria-label={`Voice input for ${student.full_name}`} title="Voice Input"><Mic aria-hidden="true" /><span>Voice Input</span></button></div></article>;
    })}</div>;
}

function LatestCoachFeedback({ record, media }: { record: CoachRecord | null; media: CoachRecordMedia[] }) {
    if (!record) return <section className="crm-latest-feedback crm-empty-state"><p>Your first published lesson report will appear here.</p><span>Your coach will share the lesson outcome and next practice focus.</span></section>;
    return <section className="crm-latest-feedback" aria-label="Latest coach feedback"><div><p className="crm-eyebrow">Latest lesson outcome</p><h2>{record.title}</h2><span>{formatDate(record.published_at ?? record.created_at)}</span></div><p>{record.body}</p><FeedbackMetadata record={record} /><RecordAttachments media={media.filter((item) => item.coach_record_id === record.id)} /></section>;
}

function RecordList({ title, records, media, limit, showMetadata = true, showStatus = true }: { title: string; records: CoachRecord[]; media: CoachRecordMedia[]; limit?: number; showMetadata?: boolean; showStatus?: boolean }) {
    const visibleRecords = limit ? records.slice(0, limit) : records;
    return <section className="crm-panel crm-timeline-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">History</p><h2>{title}</h2></div><span className="crm-count">{records.length}</span></div>{records.length === 0 ? <div className="crm-empty-state"><p>No records yet.</p><span>Published records will appear here when they are created.</span></div> : <div className="crm-record-list">{visibleRecords.map((record) => <article className="crm-record-item" key={record.id}><div className="crm-record-meta"><span>{formatDate(record.lesson_date ?? record.created_at)}</span>{showStatus && <span className={`crm-status ${record.is_published ? 'is-active' : 'is-private'}`}>{record.is_published ? 'Published' : 'Private'}</span>}</div><h3>{record.title}</h3><p>{record.body}</p>{showMetadata && <FeedbackMetadata record={record} />}<RecordAttachments media={media.filter((item) => item.coach_record_id === record.id)} /></article>)}</div>}{limit && records.length > limit && <p className="crm-list-summary">Showing the latest {limit} of {records.length} records.</p>}</section>;
}

function StudentLessonCards({ records, media }: { records: CoachRecord[]; media: CoachRecordMedia[] }) {
    return <section className="crm-panel crm-student-feedback-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">Published by your coach</p><h2>Lesson feedback</h2></div><span className="crm-count">{records.length}</span></div>{records.length === 0 ? <div className="crm-empty-state"><p>No lesson feedback yet.</p><span>Published coaching notes, media, and practice focus will appear here.</span></div> : <div className="crm-student-lesson-cards">{records.map((record) => <article className="crm-student-lesson-card" key={record.id}><header><div><p className="crm-eyebrow">Lesson feedback</p><h3>{record.title}</h3></div><time dateTime={record.published_at ?? record.created_at}>{formatDate(record.lesson_date ?? record.published_at ?? record.created_at)}</time></header><p>{record.body}</p><FeedbackMetadata record={record} /><RecordAttachments media={media.filter((item) => item.coach_record_id === record.id)} /></article>)}</div>}</section>;
}

function RecordAttachments({ media, compact = false, layout = 'default', aiFeedbackBody = '' }: { media: CoachRecordMedia[]; compact?: boolean; layout?: 'default' | 'ai-feedback'; aiFeedbackBody?: string }) {
    if (!media.length) return null;
    if (layout === 'ai-feedback') {
        const phaseOrder = ['preparation', 'contact', 'finish'];
        const phaseTitles = ['准备', '触球', '收拍'];
        const feedbackByTitle = parseAIFeedbackPhases(aiFeedbackBody);
        const orderedMedia = [...media].sort((left, right) => {
            const leftIndex = phaseOrder.findIndex((phase) => left.original_name.includes(phase));
            const rightIndex = phaseOrder.findIndex((phase) => right.original_name.includes(phase));
            return (leftIndex < 0 ? phaseOrder.length : leftIndex) - (rightIndex < 0 ? phaseOrder.length : rightIndex);
        });
        return <div className="crm-record-attachments is-ai-feedback" aria-label={`${media.length} AI feedback frames`}>{orderedMedia.map((item, index) => {
            const title = phaseTitles[index] ?? `Frame ${index + 1}`;
            const feedback = feedbackByTitle.get(title);
            return <article className="crm-ai-history-frame" key={item.id}><div className="crm-ai-feedback-phase-heading"><span>{index + 1}</span><h5>{title}</h5></div><RecordAttachment item={item} />{feedback && <div className="crm-ai-feedback-coaching"><small>动作反馈</small><h6>{feedback.correction}</h6>{feedback.issue && <p>{feedback.issue}</p>}</div>}</article>;
        })}</div>;
    }
    return <div className={`crm-record-attachments ${compact ? 'is-compact' : ''}`} aria-label={`${media.length} coaching attachment${media.length === 1 ? '' : 's'}`}>{media.map((item) => <RecordAttachment key={item.id} item={item} />)}</div>;
}

function parseAIFeedbackPhases(body: string) {
    const feedback = new Map<string, { correction: string; issue: string }>();
    for (const match of body.matchAll(/^\s*\d+\.\s*(准备|触球|收拍)[：:]\s*(.+)$/gm)) {
        const sentences = match[2].trim().match(/.*?。|.+$/g) ?? [];
        feedback.set(match[1], { correction: sentences[0]?.trim() ?? match[2].trim(), issue: sentences.slice(1).join(' ').trim() });
    }
    return feedback;
}

function RecordAttachment({ item }: { item: CoachRecordMedia }) {
    const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const liveFramesCacheRef = useRef<Map<number, { x: number; y: number; visibility?: number }[]>>(new Map());

    const preRecordedFrames = useMemo(() => parsePoseFrames(item.pose_landmarks), [item.pose_landmarks]);
    const staticLandmarks = useMemo(() => {
        if (Array.isArray(item.pose_landmarks) && item.pose_landmarks.length >= 33) {
            return item.pose_landmarks as { x: number; y: number; visibility?: number }[];
        }
        return null;
    }, [item.pose_landmarks]);
    const annotations = useMemo(() => Array.isArray(item.annotations) ? item.annotations as WorkbenchAnnotation[] : [], [item.annotations]);

    const renderOverlay = useCallback(() => {
        const canvas = canvasRef.current;
        const media = mediaRef.current;
        if (!canvas || !media) return;

        const isVideo = item.media_type === 'video' && media instanceof HTMLVideoElement;
        const sourceWidth = isVideo ? media.videoWidth : (media as HTMLImageElement).naturalWidth;
        const sourceHeight = isVideo ? media.videoHeight : (media as HTMLImageElement).naturalHeight;
        if (!sourceWidth || !sourceHeight) return;

        const bounds = canvas.getBoundingClientRect();
        const targetW = Math.max(1, Math.round(bounds.width));
        const targetH = Math.max(1, Math.round(bounds.height));
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        const context = canvas.getContext('2d');
        if (!context) return;

        const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
        const renderedWidth = sourceWidth * scale;
        const renderedHeight = sourceHeight * scale;
        const offsetX = (canvas.width - renderedWidth) / 2;
        const offsetY = (canvas.height - renderedHeight) / 2;

        let landmarks: { x: number; y: number; visibility?: number }[] | null = null;

        if (isVideo) {
            const currentTimeMs = media.currentTime * 1000;
            if (
                preRecordedFrames.length > 1 &&
                currentTimeMs >= preRecordedFrames[0].timeMs - 250 &&
                currentTimeMs <= preRecordedFrames[preRecordedFrames.length - 1].timeMs + 250
            ) {
                landmarks = poseAtTime(preRecordedFrames, currentTimeMs);
            } else {
                const bucket = Math.round(currentTimeMs / 50);
                if (liveFramesCacheRef.current.has(bucket)) {
                    landmarks = liveFramesCacheRef.current.get(bucket)!;
                } else if (mediaPipeVideoPoseService.isReady()) {
                    const detected = mediaPipeVideoPoseService.detect(media);
                    if (detected && detected.length >= 33) {
                        liveFramesCacheRef.current.set(bucket, detected);
                        landmarks = detected;
                    }
                }

                if (!landmarks) {
                    landmarks = findNearestCachedLandmarks(liveFramesCacheRef.current, bucket, 10);
                }

                if (!landmarks) {
                    landmarks = preRecordedFrames[0]?.landmarks ?? staticLandmarks;
                }
            }
        } else {
            landmarks = staticLandmarks ?? preRecordedFrames[0]?.landmarks ?? null;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.translate(offsetX, offsetY);
        if (landmarks && landmarks.length) {
            drawSkeleton(context, landmarks, renderedWidth, renderedHeight);
        }
        annotations.forEach((annotation) => drawAnnotation(context, annotation, renderedWidth, renderedHeight));
        context.restore();
    }, [item.media_type, preRecordedFrames, staticLandmarks, annotations]);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        if (item.media_type === 'video' && media instanceof HTMLVideoElement) {
            void mediaPipeVideoPoseService.init().then(() => {
                renderOverlay();
            });

            let animId: number | null = null;
            let vfcId: number | null = null;

            const onVideoFrame = () => {
                renderOverlay();
                if (!media.paused && !media.ended) {
                    if ('requestVideoFrameCallback' in media) {
                        vfcId = (media as any).requestVideoFrameCallback(onVideoFrame);
                    } else {
                        animId = requestAnimationFrame(onVideoFrame);
                    }
                }
            };

            const onPlay = () => {
                if (animId !== null) cancelAnimationFrame(animId);
                if (vfcId !== null && 'cancelVideoFrameCallback' in media) (media as any).cancelVideoFrameCallback(vfcId);
                onVideoFrame();
            };

            const onStop = () => {
                if (animId !== null) cancelAnimationFrame(animId);
                if (vfcId !== null && 'cancelVideoFrameCallback' in media) (media as any).cancelVideoFrameCallback(vfcId);
                animId = null;
                vfcId = null;
                renderOverlay();
            };

            media.addEventListener('play', onPlay);
            media.addEventListener('pause', onStop);
            media.addEventListener('ended', onStop);
            media.addEventListener('seeked', renderOverlay);
            media.addEventListener('timeupdate', renderOverlay);
            media.addEventListener('loadeddata', renderOverlay);
            media.addEventListener('loadedmetadata', renderOverlay);

            const resizeObserver = new ResizeObserver(() => renderOverlay());
            if (canvasRef.current) resizeObserver.observe(canvasRef.current);

            if (!media.paused) onPlay();
            else renderOverlay();

            return () => {
                if (animId !== null) cancelAnimationFrame(animId);
                if (vfcId !== null && 'cancelVideoFrameCallback' in media) (media as any).cancelVideoFrameCallback(vfcId);
                media.removeEventListener('play', onPlay);
                media.removeEventListener('pause', onStop);
                media.removeEventListener('ended', onStop);
                media.removeEventListener('seeked', renderOverlay);
                media.removeEventListener('timeupdate', renderOverlay);
                media.removeEventListener('loadeddata', renderOverlay);
                media.removeEventListener('loadedmetadata', renderOverlay);
                resizeObserver.disconnect();
            };
        } else if (item.media_type === 'image' && media instanceof HTMLImageElement) {
            renderOverlay();
            const resizeObserver = new ResizeObserver(() => renderOverlay());
            if (canvasRef.current) resizeObserver.observe(canvasRef.current);
            return () => resizeObserver.disconnect();
        }
    }, [item.media_type, renderOverlay]);

    return (
        <div className="crm-record-attachment">
            {item.media_type === 'image' ? (
                <a href={item.signed_url} target="_blank" rel="noreferrer">
                    <img
                        ref={mediaRef as React.RefObject<HTMLImageElement>}
                        src={item.signed_url}
                        alt={`Coach annotation: ${item.original_name}`}
                        onLoad={renderOverlay}
                    />
                </a>
            ) : (
                <video
                    ref={mediaRef as React.RefObject<HTMLVideoElement>}
                    controls
                    playsInline
                    preload="metadata"
                    src={item.signed_url}
                    onLoadedMetadata={renderOverlay}
                />
            )}
            <canvas ref={canvasRef} aria-hidden="true" />
            <span>{item.annotations?.length || item.pose_landmarks ? 'Coach markup' : item.media_type === 'image' ? 'Photo' : 'Video'}</span>
        </div>
    );
}

type PoseFrame = { timeMs: number; landmarks: { x: number; y: number; visibility?: number }[] };

function findNearestCachedLandmarks(
    cache: Map<number, { x: number; y: number; visibility?: number }[]>,
    targetBucket: number,
    maxDistanceBuckets = 10
): { x: number; y: number; visibility?: number }[] | null {
    if (cache.has(targetBucket)) return cache.get(targetBucket)!;
    let closestKey: number | null = null;
    let minDiff = Infinity;
    for (const key of cache.keys()) {
        const diff = Math.abs(key - targetBucket);
        if (diff < minDiff && diff <= maxDistanceBuckets) {
            minDiff = diff;
            closestKey = key;
        }
    }
    return closestKey !== null ? cache.get(closestKey)! : null;
}

function parsePoseFrames(value: unknown): PoseFrame[] {
    if (!value || typeof value !== 'object') return [];
    const directFrames = (value as { frames?: unknown }).frames;
    if (Array.isArray(directFrames)) {
        return directFrames
            .filter((frame) => Number.isFinite(frame.timeMs) && Array.isArray(frame.landmarks) && frame.landmarks.length >= 33)
            .sort((left, right) => left.timeMs - right.timeMs);
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && 'timeMs' in value[0]) {
        return (value as PoseFrame[])
            .filter((frame) => Number.isFinite(frame.timeMs) && Array.isArray(frame.landmarks) && frame.landmarks.length >= 33)
            .sort((left, right) => left.timeMs - right.timeMs);
    }
    return [];
}

function poseAtTime(frames: PoseFrame[], timeMs: number): PoseFrame['landmarks'] {
    if (!frames.length) return [];
    if (frames.length === 1) return frames[0].landmarks;
    const nextIndex = frames.findIndex((frame) => frame.timeMs >= timeMs);
    if (nextIndex === 0) return frames[0].landmarks;
    if (nextIndex === -1) return frames[frames.length - 1].landmarks;
    const before = frames[nextIndex - 1];
    const after = frames[nextIndex];
    const range = after.timeMs - before.timeMs;
    const ratio = range > 0 ? (timeMs - before.timeMs) / range : 0;
    return before.landmarks.map((landmark, index) => {
        const target = after.landmarks[index] ?? landmark;
        return {
            x: landmark.x + (target.x - landmark.x) * ratio,
            y: landmark.y + (target.y - landmark.y) * ratio,
            visibility: (landmark.visibility ?? 1) + ((target.visibility ?? 1) - (landmark.visibility ?? 1)) * ratio,
        };
    });
}

function StudentRecordList({ records, media, limit }: { records: StudentRecord[]; media: StudentRecordMedia[]; limit?: number }) {
    const visibleRecords = limit ? records.slice(0, limit) : records;
    return <section className="crm-panel crm-timeline-panel"><div className="crm-panel-heading"><div><p className="crm-eyebrow">My archive</p><h2>Previous practice notes</h2></div><span className="crm-count">{records.length}</span></div>{records.length === 0 ? <div className="crm-empty-state"><p>No practice notes yet.</p><span>Your reflections will build a useful training history.</span></div> : <div className="crm-record-list">{visibleRecords.map((record) => <article className="crm-record-item" key={record.id}><div className="crm-record-meta"><span>{formatDate(record.created_at)}</span></div><h3>{record.title}</h3><p>{record.body}</p>{media.filter((item) => item.student_record_id === record.id).length > 0 && <div className="crm-homework-resources"><strong>Attachments</strong><div>{media.filter((item) => item.student_record_id === record.id).map((item) => item.media_type === 'image' ? <a key={item.id} href={item.signed_url} target="_blank" rel="noreferrer"><img src={item.signed_url} alt={item.original_name} /></a> : <video key={item.id} controls preload="metadata" src={item.signed_url} />)}</div></div>}</article>)}</div>}{limit && records.length > limit && <p className="crm-list-summary">Showing the latest {limit} of {records.length} notes.</p>}</section>;
}

function Metric({ value, label, detail, accent = 'green' }: { value: number; label: string; detail: string; accent?: 'green' | 'sky' | 'amber' }) {
    return <article className={`crm-metric crm-metric-${accent}`}><strong>{value}</strong><div><span>{label}</span><small>{detail}</small></div></article>;
}

function StudentTrainingProfile({ student }: { student: Student | null }) {
    return <section className="crm-student-profile-summary" aria-label="Current training profile">
        <div><p className="crm-eyebrow">Current training profile</p><h2>What you are working toward</h2></div>
        <dl>
            <div><dt>Current level</dt><dd>{student?.level ?? 'Your coach has not set a level yet.'}</dd></div>
            <div><dt>Active goal</dt><dd>{student?.goals ?? 'Your coach will add a training goal here.'}</dd></div>
            <div><dt>Last lesson</dt><dd>{student?.last_lesson_at ? formatDate(student.last_lesson_at) : 'No lesson recorded yet.'}</dd></div>
        </dl>
    </section>;
}

function StudentSelfProfileEditor({ student, onSave }: { student: Student | null; onSave: (input: StudentSelfProfileInput) => Promise<void> }) {
    const [form, setForm] = useState<StudentSelfProfileInput>(() => toStudentSelfProfileInput(student));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        setForm(toStudentSelfProfileInput(student));
        setError('');
    }, [student]);
    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await onSave(form);
        } catch (saveError) {
            setError(messageFrom(saveError));
        } finally {
            setBusy(false);
        }
    };
    return <form className="crm-self-profile-editor" onSubmit={submit}><div><p className="crm-eyebrow">Your information</p><h2>Keep your coach up to date</h2><p>Share only the training information that helps your coach plan safely and effectively.</p></div><div className="crm-profile-grid"><SelectField label="Age range" value={form.age_range ?? ''} onChange={(value) => setForm((current) => ({ ...current, age_range: value as StudentSelfProfileInput['age_range'] }))} options={ageRangeOptions} /><SelectField label="Gender" value={form.gender ?? ''} onChange={(value) => setForm((current) => ({ ...current, gender: value as Student['gender'] }))} options={genderOptions} /><SelectField label="Dominant hand" value={form.dominant_hand ?? ''} onChange={(value) => setForm((current) => ({ ...current, dominant_hand: value as Student['dominant_hand'] }))} options={handOptions} /><SelectField label="Dominant eye" value={form.dominant_eye ?? ''} onChange={(value) => setForm((current) => ({ ...current, dominant_eye: value as Student['dominant_eye'] }))} options={handOptions} /><label className="crm-field">Goals<textarea value={form.goals ?? ''} onChange={(event) => setForm((current) => ({ ...current, goals: nullableText(event.target.value) }))} placeholder="What do you want to achieve in tennis?" /></label><label className="crm-field">Restrictions and considerations<textarea value={form.restrictions ?? ''} onChange={(event) => setForm((current) => ({ ...current, restrictions: nullableText(event.target.value) }))} placeholder="Injuries, access needs, or training constraints." /></label></div>{error && <p className="crm-profile-error" role="alert">{error}</p>}<button disabled={busy || !student} className="crm-button crm-button-secondary">{busy ? 'Saving...' : 'Save my information'}</button></form>;
}

function Field({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
    return <label className="crm-field">{label}<input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
    return <label className="crm-field">{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
    return <label className="crm-field">{label}<input type="number" min="0" step="0.1" value={value ?? ''} onChange={(event) => onChange(nullableNumber(event.target.value))} /></label>;
}

function TextArea({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
    return <label className="crm-field">{label}<textarea required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

const genderOptions: [string, string][] = [['', 'Not recorded'], ['female', 'Female'], ['male', 'Male'], ['nonbinary', 'Nonbinary'], ['prefer_not_to_say', 'Prefer not to say']];
const handOptions: [string, string][] = [['', 'Not recorded'], ['right', 'Right'], ['left', 'Left']];
const ageRangeOptions: [string, string][] = [['', 'Not recorded'], ['under_13', 'Under 13'], ['13_to_17', '13 to 17'], ['18_to_25', '18 to 25'], ['26_to_44', '26 to 44'], ['45_plus', '45+'], ['prefer_not_to_say', 'Prefer not to say']];
const homeworkCategoryOptions: [string, string][] = [['', 'General practice'], ['forehand', 'Forehand'], ['backhand', 'Backhand'], ['serve', 'Serve'], ['return', 'Return'], ['volley', 'Volley'], ['footwork', 'Footwork'], ['match-play', 'Match play']];
const assessmentChallengeOptions: [string, string][] = [['rally_count', 'Rally count'], ['serve_in_percentage', 'Serve-in percentage'], ['target_hit_rate', 'Target-hit rate'], ['rubric_score', 'Rubric score']];
const assessmentStatusOptions: [string, string][] = [['assigned', 'Assigned'], ['in_progress', 'In progress'], ['achieved', 'Achieved'], ['not_achieved', 'Not achieved']];

function Notice({ notice, onClose }: { notice: Exclude<NoticeState, null>; onClose: () => void }) {
    return <div role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'} className={`crm-notice crm-notice-${notice.tone}`}><span>{notice.text}</span><button type="button" onClick={onClose} aria-label="Close message"><X aria-hidden="true" /></button></div>;
}

function firstName(name: string) { return name.trim().split(/\s+/)[0] || 'there'; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); }
function nullableText(value: string) { const trimmed = value.trim(); return trimmed || null; }
function nullableNumber(value: string) { const number = Number(value); return value === '' || !Number.isFinite(number) ? null : number; }
function activeAssessment(assessments: StudentAssessment[]) { return assessments.find((assessment) => assessment.status === 'in_progress' || assessment.status === 'assigned') ?? assessments[0] ?? null; }
function latestAttemptFor(assessment: StudentAssessment | null, attempts: AssessmentAttempt[]) { return assessment ? attempts.filter((attempt) => attempt.student_assessment_id === assessment.id)[0] ?? null : null; }
function formatAssessmentResult(resultValue: number | null, score: number | null) { if (resultValue !== null) return `${resultValue}${score !== null ? ` (${score}%)` : ''}`; if (score !== null) return `${score}%`; return 'Not recorded yet'; }
function assessmentChallengeLabel(challengeType: AssessmentChallengeType) { return assessmentChallengeOptions.find(([value]) => value === challengeType)?.[1] ?? challengeType; }
function emptyCapabilityScores(): CapabilityScores { return { forehand_drive: 0, backhand_drive: 0, forehand_volley: 0, backhand_volley: 0, forehand_slice: 0, backhand_slice: 0, serve_and_return: 0, footwork: 0 }; }
function toggleId(ids: string[], id: string) { return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]; }
function capabilityLabel(dimension: CapabilityDimension) { return ({ forehand_drive: 'Forehand drive', backhand_drive: 'Backhand drive', forehand_volley: 'Forehand volley', backhand_volley: 'Backhand volley', forehand_slice: 'Forehand slice', backhand_slice: 'Backhand slice', serve_and_return: 'Serve and return', footwork: 'Footwork' })[dimension]; }
function capabilityShortLabel(dimension: CapabilityDimension) { return ({ forehand_drive: 'FH drive', backhand_drive: 'BH drive', forehand_volley: 'FH volley', backhand_volley: 'BH volley', forehand_slice: 'FH slice', backhand_slice: 'BH slice', serve_and_return: 'Serve / return', footwork: 'Footwork' })[dimension]; }
function averageCapabilityScore(scores: CapabilityScores) { return Math.round(CAPABILITY_DIMENSIONS.reduce((total, dimension) => total + scores[dimension], 0) / CAPABILITY_DIMENSIONS.length); }
function makeGrowthReportContent(student: Student, records: CoachRecord[], studentRecords: StudentRecord[]): GrowthReportContent {
    const logs = [...records.map((record) => ({ body: `${record.title} ${record.body}`, date: record.lesson_date ?? record.created_at })), ...studentRecords.map((record) => ({ body: `${record.title} ${record.body}`, date: record.created_at }))];
    const themes = analyzeLogThemes(logs.map((log) => log.body));
    const logDates = logs.map((log) => new Date(log.date).getTime()).filter(Number.isFinite).sort((left, right) => left - right);
    const dateRange = logDates.length ? `${formatDate(new Date(logDates[0]).toISOString())} to ${formatDate(new Date(logDates.at(-1)!).toISOString())}` : 'no dated logs yet';
    const focus = themes.ranked.slice(0, 3);
    const focusSummary = focus.length ? focus.map((theme) => `${theme.label} (${theme.count})`).join(', ') : 'general technical development';
    const priority = themes.priorities[0] ?? focus[0]?.label ?? 'general technical development';
    const strengths = themes.strengths.length ? themes.strengths.join(', ') : focus.slice(0, 2).map((theme) => theme.label).join(', ') || 'practice consistency';
    const positiveEntries = logs.filter((log) => /(improv|strong|better|confident|progress|good|success)/i.test(log.body)).length;
    const developmentEntries = logs.filter((log) => /(need|work|improve|difficult|struggl|miss|inconsisten|focus|weak)/i.test(log.body)).length;
    return { summary: `${student.full_name}'s report reviews ${logs.length} entries from ${dateRange}: ${records.length} coach log${records.length === 1 ? '' : 's'} and ${studentRecords.length} student practice log${studentRecords.length === 1 ? '' : 's'}. The main training conversation has been ${focusSummary}.`, strengths: `${positiveEntries ? `${positiveEntries} log ${positiveEntries === 1 ? 'entry records' : 'entries record'} positive progress. ` : ''}The clearest areas of momentum are ${strengths}. Keep carrying these cues into every practice session.`, priorities: `${developmentEntries ? `${developmentEntries} log ${developmentEntries === 1 ? 'entry identifies' : 'entries identify'} a development need. ` : ''}The next coaching priority is ${priority}, because it is the most repeated improvement theme in the log history.`, next_steps: coachPracticePlan(priority) };
}
function analyzeLogThemes(logBodies: string[]) {
    const categories = [{ label: 'serve and return', terms: ['serve', 'serving', 'return'] }, { label: 'forehand', terms: ['forehand'] }, { label: 'backhand', terms: ['backhand'] }, { label: 'volley and net play', terms: ['volley', 'net play', 'approach'] }, { label: 'footwork and movement', terms: ['footwork', 'movement', 'split step', 'balance'] }, { label: 'consistency and control', terms: ['consisten', 'control', 'unforced', 'accuracy'] }, { label: 'match play and decision-making', terms: ['match', 'tactic', 'strategy', 'decision'] }];
    const normalized = logBodies.join(' ').toLowerCase();
    const ranked = categories.map((category) => ({ ...category, count: category.terms.reduce((total, term) => total + (normalized.match(new RegExp(term, 'g'))?.length ?? 0), 0) })).filter((category) => category.count > 0).sort((left, right) => right.count - left.count);
    const strengthSignal = /(improv|strong|better|confident|progress|good|success)/;
    const prioritySignal = /(need|work|improve|difficult|struggl|miss|inconsisten|focus|weak)/;
    return { ranked, strengths: strengthSignal.test(normalized) ? ranked.slice(0, 2).map((category) => category.label) : [], priorities: prioritySignal.test(normalized) ? ranked.slice(0, 2).map((category) => category.label) : [] };
}
function coachPracticePlan(priority: string) {
    const drills: Record<string, string> = {
        'serve and return': 'For the next 2 weeks, complete two serve-and-return blocks each week: hit 3 sets of 10 serves to a chosen target, then return 20 feeds with a split-step before contact. Log the in-target total and one cue that improved contact.',
        forehand: 'For the next 2 weeks, complete two forehand blocks each week: rally 3 sets of 12 cross-court balls, then add 10 directional changes. Keep the recovery step after every ball and log the longest controlled sequence.',
        backhand: 'For the next 2 weeks, complete two backhand blocks each week: rally 3 sets of 12 cross-court balls, then add 10 backhands down the line. Prioritize early preparation and log which cue gave the cleanest contact.',
        'volley and net play': 'For the next 2 weeks, complete two net-play blocks each week: use 3 sets of 10 controlled volleys from the service line, then add approach-and-volley patterns. Log the number of volleys that land past the service line.',
        'footwork and movement': 'For the next 2 weeks, complete two movement blocks each week: use split-step and recovery patterns for 3 sets of 8 feeds per side, then repeat with a live rally. Log how often you recovered to a balanced base before the next ball.',
        'consistency and control': 'For the next 2 weeks, complete two consistency blocks each week: build 3 cross-court rallies and record the best ball count for each side. Keep a margin over the net and log the error pattern you noticed.',
        'match play and decision-making': 'For the next 2 weeks, play two short point-play blocks each week with one tactical intention per block. Afterward, log the choices that won points and one decision to change next time.',
    };
    return drills[priority] ?? 'For the next 2 weeks, complete two focused practice sessions each week. Record one short video or photo from each session, write the cue that helped most, and review the next log with your coach to set the following priority.';
}
function downloadGrowthReport(report: GrowthReportSnapshot) { const content = [`# ${report.title}`, '', `Published: ${formatDate(report.published_at ?? report.created_at)}`, '', 'Summary', report.report_content.summary, '', 'Strengths', report.report_content.strengths, '', 'Priorities', report.report_content.priorities, '', 'Next steps', report.report_content.next_steps].join('\n'); const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'growth-report'}.md`; link.click(); URL.revokeObjectURL(url); }
function toLocalDateTime(value: string | null) { return value ? new Date(value).toISOString().slice(0, 16) : ''; }
function emptyStudentProfile(): StudentProfileInput { return { full_name: '', email: '', date_of_birth: null, gender: null, level: null, dominant_hand: null, dominant_eye: null, racket_brand: null, racket_model: null, racket_string: null, racket_head_size_sq_in: null, racket_weight_g: null, racket_string_tension_lbs: null, shoes_used: null, goals: null, restrictions: null, last_lesson_at: null }; }
function toStudentProfileInput(student: Student): StudentProfileInput { return { full_name: student.full_name, email: student.email, date_of_birth: student.date_of_birth, gender: student.gender, level: student.level, dominant_hand: student.dominant_hand, dominant_eye: student.dominant_eye, racket_brand: student.racket_brand, racket_model: student.racket_model, racket_string: student.racket_string, racket_head_size_sq_in: student.racket_head_size_sq_in, racket_weight_g: student.racket_weight_g, racket_string_tension_lbs: student.racket_string_tension_lbs, shoes_used: student.shoes_used, goals: student.goals, restrictions: student.restrictions, last_lesson_at: student.last_lesson_at }; }
function toStudentSelfProfileInput(student: Student | null): StudentSelfProfileInput { return { age_range: student?.age_range ?? null, gender: student?.gender ?? null, dominant_hand: student?.dominant_hand ?? null, dominant_eye: student?.dominant_eye ?? null, goals: student?.goals ?? null, restrictions: student?.restrictions ?? null }; }
function toCoachRecordInput({ title, body, lessonDate, skill, focusArea, evidenceLinks }: { title: string; body: string; lessonDate: string; skill: string; focusArea: string; evidenceLinks: string }): CoachRecordInput {
    const links = evidenceLinks.split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
    for (const link of links) {
        const url = new URL(link);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Evidence links must use http:// or https://.');
    }
    return { title: title.trim(), body: body.trim(), lesson_date: nullableText(lessonDate), skill: nullableText(skill), focus_area: nullableText(focusArea), evidence_links: links };
}
function getStudentAge(dateOfBirth: string | null) { if (!dateOfBirth) return null; const birth = new Date(`${dateOfBirth}T00:00:00`); if (Number.isNaN(birth.getTime())) return null; const today = new Date(); let age = today.getFullYear() - birth.getFullYear(); const birthdayThisYear = new Date(today.getFullYear(), birth.getMonth(), birth.getDate()); if (today < birthdayThisYear) age -= 1; return age >= 0 ? age : null; }
function getStudentActivityStatus(student: Student): 'active' | 'inactive' | 'archived' { if (student.student_archived_at || student.invitation_status === 'disabled') return 'archived'; if (!student.last_lesson_at) return 'inactive'; return new Date(student.last_lesson_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000 ? 'active' : 'inactive'; }
function getRosterSummary(students: Student[]) { return students.reduce((summary, student) => { const status = getStudentActivityStatus(student); const age = getStudentAge(student.date_of_birth); summary[status] += 1; if (student.gender === 'female') summary.female += 1; if (student.gender === 'male') summary.male += 1; if (student.gender === 'nonbinary') summary.nonbinary += 1; if (student.dominant_hand === 'left') summary.leftHanded += 1; if (student.dominant_hand === 'right') summary.rightHanded += 1; if (age !== null && age < 13) summary.under13 += 1; if (age !== null && age >= 13 && age <= 17) summary.teen += 1; if (age !== null && age >= 18) summary.adult += 1; if (student.level) summary.levels[student.level] = (summary.levels[student.level] ?? 0) + 1; return summary; }, { active: 0, inactive: 0, archived: 0, female: 0, male: 0, nonbinary: 0, leftHanded: 0, rightHanded: 0, under13: 0, teen: 0, adult: 0, levels: {} as Record<string, number> }); }