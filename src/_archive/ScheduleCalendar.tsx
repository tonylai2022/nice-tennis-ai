import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { coachCRMService, type Lesson, type LessonPaymentMethod, type Student } from '../services/CoachCRMService';
import { BookingModal } from './BookingModal';

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const zonedDayKey = (date: string, timezone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date));
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
};
const lessonDayKey = (lesson: Lesson) => zonedDayKey(lesson.starts_at, lesson.timezone || 'UTC');
const dateFromDayKey = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
};
const addDays = (date: Date, amount: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
};

const startOfWeek = (date: Date) => addDays(date, -date.getDay());
const startOfMonthGrid = (date: Date) => startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
type ScheduleView = 'day' | 'week' | 'month' | 'agenda';

const formatLessonTime = (date: string, timezone: string, language: 'en' | 'zh') => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
}).format(new Date(date));

const commonTimezones = ['America/Los_Angeles', 'America/New_York', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

const toZonedInputValue = (date: string, timezone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(date));
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
};

const zonedDateTimeToIso = (localDateTime: string, timezone: string) => {
    const [datePart, timePart] = localDateTime.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const assumedUtc = Date.UTC(year, month - 1, day, hour, minute);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(assumedUtc));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const timezoneLocalAsUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
    return new Date(assumedUtc - (timezoneLocalAsUtc - assumedUtc)).toISOString();
};

export function ScheduleCalendar({ students, lessons, language = 'en', onLessonsChange, onStudentsChange, onNotice }: { students: Student[]; lessons: Lesson[]; language?: 'en' | 'zh'; onLessonsChange: (lessons: Lesson[]) => void; onStudentsChange: (students: Student[]) => void; onNotice: (text: string, tone: 'success' | 'error') => void }) {
    const isZh = language === 'zh';
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [view, setView] = useState<ScheduleView>('day');
    const [bookingOpen, setBookingOpen] = useState(false);
    const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
    const [statusLesson, setStatusLesson] = useState<Lesson | null>(null);
    const [paymentLesson, setPaymentLesson] = useState<Lesson | null>(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const dates = useMemo(() => {
        const weekStart = startOfWeek(selectedDate);
        return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    }, [selectedDate]);
    const monthDates = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(startOfMonthGrid(selectedDate), index)), [selectedDate]);
    const selectedDayLessons = useMemo(() => lessons
        .filter((lesson) => lessonDayKey(lesson) === dayKey(selectedDate))
        .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()), [lessons, selectedDate]);
    const isToday = dayKey(selectedDate) === dayKey(new Date());
    const heading = selectedDate.toLocaleDateString(isZh ? 'zh-CN' : undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const monthHeading = selectedDate.toLocaleDateString(isZh ? 'zh-CN' : undefined, { year: 'numeric', month: 'long' });
    const viewChoices: { value: ScheduleView; label: string }[] = [{ value: 'day', label: isZh ? '日' : 'Day' }, { value: 'week', label: isZh ? '周' : 'Week' }, { value: 'month', label: isZh ? '月' : 'Month' }, { value: 'agenda', label: isZh ? '日程表' : 'Agenda' }];
    const selectDay = (date: Date) => { setSelectedDate(date); setView('day'); };
    const moveCalendar = (direction: -1 | 1) => setSelectedDate((date) => {
        if (view === 'month') return new Date(date.getFullYear(), date.getMonth() + direction, date.getDate());
        return addDays(date, direction * (view === 'day' ? 1 : view === 'week' ? 7 : 30));
    });

    const updateStatus = async (lesson: Lesson, status: Lesson['status']) => {
        try {
            const updated = await coachCRMService.updateLesson(lesson.id, { status, payment_status: lesson.payment_status });
            onLessonsChange(lessons.map((item) => item.id === updated.id ? updated : item));
            setStatusLesson(null);
            onNotice(isZh ? '课程状态已更新。' : 'Lesson status updated.', 'success');
        } catch (error) {
            onNotice(error instanceof Error ? error.message : (isZh ? '无法更新课程状态。' : 'Could not update lesson status.'), 'error');
        }
    };

    const settlePayment = async (lesson: Lesson, paymentMethod: LessonPaymentMethod) => {
        try {
            const updated = await coachCRMService.updateLesson(lesson.id, { status: lesson.status, payment_status: 'paid', payment_method: paymentMethod });
            onLessonsChange(lessons.map((item) => item.id === updated.id ? updated : item));
            setPaymentLesson(null);
            onNotice(isZh ? '付款已记录。' : 'Payment recorded.', 'success');
        } catch (error) {
            onNotice(error instanceof Error ? error.message : (isZh ? '无法记录付款。' : 'Could not record payment.'), 'error');
        }
    };

    const deleteLesson = async (lesson: Lesson) => {
        if (!window.confirm(isZh ? `删除“${lesson.title}”？此操作无法撤销。` : `Delete “${lesson.title}”? This cannot be undone.`)) return;
        try {
            await coachCRMService.deleteScheduledLesson(lesson.id);
            onLessonsChange(lessons.filter((item) => item.id !== lesson.id));
            onNotice(isZh ? '课程已删除。' : 'Lesson deleted.', 'success');
        } catch (error) {
            onNotice(error instanceof Error ? error.message : (isZh ? '无法删除课程。' : 'Could not delete lesson.'), 'error');
        }
    };

    return <section className="crm-scheduler">
        <header className="crm-scheduler-header">
            <div>
                <p className="crm-eyebrow">{isZh ? '日程' : 'Schedule'}</p>
            </div>
            <div className="crm-scheduler-header-actions"><button type="button" className="crm-scheduler-today-button" onClick={() => setSelectedDate(new Date())}>{isZh ? '今天' : 'Today'}</button><button type="button" className="crm-scheduler-add-button" onClick={() => setBookingOpen(true)} aria-label={isZh ? '安排课程' : 'Schedule lesson'} title={isZh ? '安排课程' : 'Schedule lesson'}><Plus aria-hidden="true" /></button></div>
        </header>

        <div className="crm-scheduler-view-controls" role="tablist" aria-label={isZh ? '日程视图' : 'Schedule view'}>{viewChoices.map((choice) => <button type="button" role="tab" aria-selected={view === choice.value} data-active={view === choice.value} key={choice.value} onClick={() => setView(choice.value)}>{choice.label}</button>)}</div>

        <div className="crm-scheduler-layout">
            <section className="crm-scheduler-agenda" aria-label={isZh ? '课程日程' : 'Lesson agenda'}>
                {view === 'day' && <><div className="crm-scheduler-datebar">
                    <button type="button" className="crm-scheduler-date-arrow" onClick={() => setSelectedDate((date) => addDays(date, -7))} aria-label={isZh ? '上一周' : 'Previous week'}><ChevronLeft aria-hidden="true" /></button>
                    <div className="crm-scheduler-days">{dates.map((date) => {
                        const selected = dayKey(date) === dayKey(selectedDate);
                        const count = lessons.filter((lesson) => lessonDayKey(lesson) === dayKey(date)).length;
                        return <button type="button" key={dayKey(date)} data-active={selected} onClick={() => setSelectedDate(date)}><span>{date.toLocaleDateString(isZh ? 'zh-CN' : undefined, { weekday: 'short' })}</span><strong>{date.getDate()}</strong>{count > 0 && <i aria-label={`${count} lessons`} />}</button>;
                    })}</div>
                    <button type="button" className="crm-scheduler-date-arrow" onClick={() => setSelectedDate((date) => addDays(date, 7))} aria-label={isZh ? '下一周' : 'Next week'}><ChevronRight aria-hidden="true" /></button>
                </div>

                    <div className="crm-scheduler-day-heading"><div><p>{isToday ? (isZh ? '今天' : 'Today') : (isZh ? '已选日期' : 'Selected date')}</p><h3>{heading}</h3></div><span>{selectedDayLessons.length} {isZh ? '节课' : selectedDayLessons.length === 1 ? 'lesson' : 'lessons'}</span></div>
                    {selectedDayLessons.length ? <div className="crm-scheduler-lessons">{selectedDayLessons.map((lesson) => {
                        const student = students.find((item) => item.id === lesson.student_id);
                        const pendingPayment = lesson.payment_type === 'single' && lesson.payment_status === 'pending';
                        const bookingTag = lesson.payment_type === 'package'
                            ? (isZh ? '套餐支付' : 'Paid by package')
                            : `${isZh ? '单次课' : 'Single booking'} · ${lesson.payment_status === 'paid' ? (isZh ? '已付款' : 'Paid') : (isZh ? '待付款' : 'Payment due')}`;
                        const statusLabel = lesson.status === 'completed' ? (isZh ? '已完成' : 'Completed') : lesson.status === 'cancelled' ? (isZh ? '已取消' : 'Cancelled') : (isZh ? '未完成' : 'Not completed');
                        return <article key={lesson.id} className="crm-scheduler-lesson" data-status={lesson.status}><time><strong>{formatLessonTime(lesson.starts_at, lesson.timezone || timezone, language)}</strong><span>{lesson.duration_minutes} {isZh ? '分钟' : 'min'}</span></time><div className="crm-scheduler-lesson-main"><h4>{lesson.title}</h4><p><UsersRound aria-hidden="true" />{student?.full_name ?? (isZh ? '学员' : 'Student')}</p>{lesson.location && <p><MapPin aria-hidden="true" />{lesson.location}</p>}<small><Clock3 aria-hidden="true" />{lesson.timezone || timezone}</small></div><div className="crm-scheduler-lesson-actions">{pendingPayment ? <button type="button" className="crm-status is-pending" onClick={() => setPaymentLesson(lesson)}>{bookingTag}</button> : <span className={`crm-status ${lesson.payment_type === 'package' ? 'is-package' : 'is-paid'}`}>{bookingTag}</span>}<div><button type="button" onClick={() => setEditingLesson(lesson)} disabled={lesson.status !== 'scheduled'} aria-label={isZh ? '编辑课程' : 'Edit lesson'}><Pencil aria-hidden="true" />{isZh ? '编辑' : 'Edit'}</button><button type="button" onClick={() => void deleteLesson(lesson)} disabled={lesson.status !== 'scheduled'} aria-label={isZh ? '删除课程' : 'Delete lesson'}><Trash2 aria-hidden="true" />{isZh ? '删除' : 'Delete'}</button></div><button type="button" className="crm-lesson-status-button" data-status={lesson.status} onClick={() => setStatusLesson(lesson)}>{statusLabel}</button></div></article>;
                    })}</div> : <div className="crm-scheduler-empty"><CalendarDays aria-hidden="true" /><strong>{isZh ? '这天没有课程' : 'No lessons this day'}</strong></div>}</>}
                {view === 'week' && <ScheduleWeekView dates={dates} lessons={lessons} students={students} language={language} timezone={timezone} onSelectDay={selectDay} />}
                {view === 'month' && <ScheduleMonthView dates={monthDates} selectedDate={selectedDate} lessons={lessons} students={students} language={language} onSelectDay={selectDay} heading={monthHeading} onMove={moveCalendar} />}
                {view === 'agenda' && <ScheduleAgendaView lessons={lessons} students={students} language={language} timezone={timezone} onSelectDay={selectDay} onMove={moveCalendar} />}
            </section>

        </div>

        {bookingOpen && <BookingModal students={students} initialDate={selectedDate} language={language} onClose={() => setBookingOpen(false)} bookLesson={coachCRMService.bookLesson} onBook={(lesson, studentId) => { onLessonsChange([...lessons, lesson].sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())); onStudentsChange(students.map((student) => student.id === studentId ? { ...student, remaining_credits: lesson.payment_type === 'package' ? Math.max(0, student.remaining_credits - 1) : student.remaining_credits } : student)); onNotice(isZh ? '课程已安排。' : 'Lesson scheduled.', 'success'); }} />}
        {editingLesson && <EditLessonModal lesson={editingLesson} language={language} onClose={() => setEditingLesson(null)} onSave={async (input) => { const updated = await coachCRMService.updateScheduledLesson(editingLesson.id, input); onLessonsChange(lessons.map((item) => item.id === updated.id ? updated : item)); setEditingLesson(null); onNotice(isZh ? '课程已更新。' : 'Lesson updated.', 'success'); }} />}
        {statusLesson && <LessonStatusModal lesson={statusLesson} language={language} onClose={() => setStatusLesson(null)} onSelect={(status) => void updateStatus(statusLesson, status)} />}
        {paymentLesson && <LessonPaymentModal language={language} onClose={() => setPaymentLesson(null)} onSelect={(paymentMethod) => void settlePayment(paymentLesson, paymentMethod)} />}
    </section>;
}

function EditLessonModal({ lesson, language, onClose, onSave }: { lesson: Lesson; language: 'en' | 'zh'; onClose: () => void; onSave: (input: Pick<Lesson, 'title' | 'starts_at' | 'duration_minutes' | 'location' | 'timezone'>) => Promise<void> }) {
    const isZh = language === 'zh';
    const [title, setTitle] = useState(lesson.title);
    const [startsAt, setStartsAt] = useState(() => toZonedInputValue(lesson.starts_at, lesson.timezone || 'UTC'));
    const [duration, setDuration] = useState(String(lesson.duration_minutes));
    const [location, setLocation] = useState(lesson.location ?? '');
    const [timezone, setTimezone] = useState(lesson.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const durationMinutes = Number(duration);
        if (!title.trim() || !startsAt || durationMinutes < 15 || durationMinutes > 480) return setError(isZh ? '请填写有效的课程信息。' : 'Enter valid lesson details.');
        setSaving(true); setError('');
        try { await onSave({ title: title.trim(), starts_at: zonedDateTimeToIso(startsAt, timezone), duration_minutes: durationMinutes, location: location.trim() || null, timezone }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : (isZh ? '无法更新课程。' : 'Could not update lesson.')); } finally { setSaving(false); }
    };

    return <div className="crm-lesson-editor-backdrop" role="dialog" aria-modal="true" aria-label={isZh ? '编辑课程' : 'Edit lesson'}><form className="crm-lesson-editor" onSubmit={submit}><header><div><p className="crm-eyebrow">{isZh ? '编辑课程' : 'Edit lesson'}</p><h2>{lesson.title}</h2></div><button type="button" onClick={onClose} aria-label={isZh ? '关闭' : 'Close'}><X aria-hidden="true" /></button></header><label> {isZh ? '课程名称' : 'Lesson name'}<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><div className="crm-lesson-editor-grid"><label>{isZh ? '开始时间' : 'Starts'}<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label>{isZh ? '分钟' : 'Minutes'}<input type="number" min="15" max="480" step="15" value={duration} onChange={(event) => setDuration(event.target.value)} required /></label></div><label>{isZh ? '场地 / 地点' : 'Court / location'}<input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label>{isZh ? '课程时区' : 'Lesson timezone'}<select value={timezone} onChange={(event) => setTimezone(event.target.value)}>{[...new Set([timezone, ...commonTimezones])].map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>{error && <p className="crm-lesson-editor-error" role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</button><button type="submit" disabled={saving}>{saving ? (isZh ? '正在保存...' : 'Saving...') : (isZh ? '保存更改' : 'Save changes')}</button></footer></form></div>;
}

function LessonStatusModal({ lesson, language, onClose, onSelect }: { lesson: Lesson; language: 'en' | 'zh'; onClose: () => void; onSelect: (status: Lesson['status']) => void }) {
    const isZh = language === 'zh';
    const choices: { status: Lesson['status']; label: string }[] = [{ status: 'scheduled', label: isZh ? '未完成' : 'Not completed' }, { status: 'completed', label: isZh ? '已完成' : 'Completed' }, { status: 'cancelled', label: isZh ? '已取消' : 'Cancelled' }];
    return <div className="crm-lesson-editor-backdrop" role="dialog" aria-modal="true" aria-label={isZh ? '更新课程状态' : 'Update lesson status'}><section className="crm-lesson-choice-modal"><header><div><p className="crm-eyebrow">{isZh ? '课程状态' : 'Lesson status'}</p><h2>{lesson.title}</h2></div><button type="button" onClick={onClose} aria-label={isZh ? '关闭' : 'Close'}><X aria-hidden="true" /></button></header><div className="crm-lesson-choice-list">{choices.map(({ status, label }) => <button key={status} type="button" data-active={lesson.status === status} data-status={status} onClick={() => onSelect(status)}>{label}</button>)}</div></section></div>;
}

function LessonPaymentModal({ language, onClose, onSelect }: { language: 'en' | 'zh'; onClose: () => void; onSelect: (paymentMethod: LessonPaymentMethod) => void }) {
    const isZh = language === 'zh';
    const methods: { value: LessonPaymentMethod; label: string }[] = [{ value: 'cash', label: isZh ? '现金' : 'Cash' }, { value: 'online_transfer', label: isZh ? '转账' : 'Transfer' }, { value: 'zelle', label: 'Zelle' }, { value: 'fps', label: 'FPS' }, { value: 'other', label: isZh ? '其他' : 'Other' }];
    return <div className="crm-lesson-editor-backdrop" role="dialog" aria-modal="true" aria-label={isZh ? '记录付款' : 'Record payment'}><section className="crm-lesson-choice-modal"><header><div><p className="crm-eyebrow">{isZh ? '记录付款' : 'Record payment'}</p><h2>{isZh ? '选择付款方式' : 'Choose payment method'}</h2></div><button type="button" onClick={onClose} aria-label={isZh ? '关闭' : 'Close'}><X aria-hidden="true" /></button></header><p>{isZh ? '选择后，课程将标记为已付款。' : 'Choosing a method marks this lesson as paid.'}</p><div className="crm-lesson-choice-list">{methods.map(({ value, label }) => <button key={value} type="button" onClick={() => onSelect(value)}>{label}</button>)}</div></section></div>;
}

function ScheduleWeekView({ dates, lessons, students, language, timezone, onSelectDay }: { dates: Date[]; lessons: Lesson[]; students: Student[]; language: 'en' | 'zh'; timezone: string; onSelectDay: (date: Date) => void }) {
    const isZh = language === 'zh';
    const todayKey = dayKey(new Date());
    return <div className="crm-scheduler-calendar-view crm-scheduler-week-view">{dates.map((date) => {
        const dayLessons = lessons.filter((lesson) => lessonDayKey(lesson) === dayKey(date)).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
        return <section key={dayKey(date)} data-today={dayKey(date) === todayKey}><button type="button" className="crm-calendar-day-label" onClick={() => onSelectDay(date)}><span>{date.toLocaleDateString(isZh ? 'zh-CN' : undefined, { weekday: 'short' })}</span><strong>{date.getDate()}</strong></button><div>{dayLessons.map((lesson) => <button type="button" key={lesson.id} className="crm-calendar-lesson" data-status={lesson.status} onClick={() => onSelectDay(date)}><time>{formatLessonTime(lesson.starts_at, lesson.timezone || timezone, language)}</time><strong>{lesson.title}</strong><span>{students.find((student) => student.id === lesson.student_id)?.full_name ?? (isZh ? '学员' : 'Student')}</span>{lesson.location && <small>{lesson.location}</small>}</button>)}</div></section>;
    })}</div>;
}

function ScheduleMonthView({ dates, selectedDate, lessons, students, language, onSelectDay, heading, onMove }: { dates: Date[]; selectedDate: Date; lessons: Lesson[]; students: Student[]; language: 'en' | 'zh'; onSelectDay: (date: Date) => void; heading: string; onMove: (direction: -1 | 1) => void }) {
    const isZh = language === 'zh';
    const weekdayLabels = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 7 + index).toLocaleDateString(isZh ? 'zh-CN' : undefined, { weekday: 'short' }));
    const todayKey = dayKey(new Date());
    return <div className="crm-scheduler-month"><header><button type="button" className="crm-scheduler-date-arrow" onClick={() => onMove(-1)} aria-label={isZh ? '上个月' : 'Previous month'}><ChevronLeft aria-hidden="true" /></button><h3>{heading}</h3><button type="button" className="crm-scheduler-date-arrow" onClick={() => onMove(1)} aria-label={isZh ? '下个月' : 'Next month'}><ChevronRight aria-hidden="true" /></button></header><div className="crm-scheduler-month-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="crm-scheduler-month-grid">{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lessonDayKey(lesson) === dayKey(date)); return <button type="button" key={dayKey(date)} data-muted={date.getMonth() !== selectedDate.getMonth()} data-today={dayKey(date) === todayKey} onClick={() => onSelectDay(date)}><strong>{date.getDate()}</strong>{dayLessons.slice(0, 2).map((lesson) => <span key={lesson.id} className="crm-calendar-month-lesson" data-status={lesson.status}><b>{lesson.title}</b><i>{students.find((student) => student.id === lesson.student_id)?.full_name ?? (isZh ? '学员' : 'Student')}</i>{lesson.location && <i>{lesson.location}</i>}</span>)}{dayLessons.length > 2 && <small>+{dayLessons.length - 2}</small>}</button>; })}</div></div>;
}

function ScheduleAgendaView({ lessons, students, language, timezone, onSelectDay, onMove }: { lessons: Lesson[]; students: Student[]; language: 'en' | 'zh'; timezone: string; onSelectDay: (date: Date) => void; onMove: (direction: -1 | 1) => void }) {
    const isZh = language === 'zh';
    const sortedLessons = [...lessons].sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
    const todayKey = dayKey(new Date());
    return <div className="crm-scheduler-running"><header><button type="button" className="crm-scheduler-date-arrow" onClick={() => onMove(-1)} aria-label={isZh ? '更早日程' : 'Earlier schedule'}><ChevronLeft aria-hidden="true" /></button><h3>{isZh ? '全部课程日程' : 'All lesson agenda'}</h3><button type="button" className="crm-scheduler-date-arrow" onClick={() => onMove(1)} aria-label={isZh ? '更晚日程' : 'Later schedule'}><ChevronRight aria-hidden="true" /></button></header>{sortedLessons.length ? <div>{sortedLessons.map((lesson) => { const date = new Date(lesson.starts_at); return <button type="button" key={lesson.id} data-status={lesson.status} data-today={lessonDayKey(lesson) === todayKey} onClick={() => onSelectDay(dateFromDayKey(lessonDayKey(lesson)))}><time><strong>{new Intl.DateTimeFormat(isZh ? 'zh-CN' : undefined, { month: 'short', day: 'numeric', timeZone: lesson.timezone || timezone }).format(date)}</strong><span>{formatLessonTime(lesson.starts_at, lesson.timezone || timezone, language)}</span></time><span><strong>{lesson.title}</strong><small>{students.find((student) => student.id === lesson.student_id)?.full_name ?? (isZh ? '学员' : 'Student')}</small></span></button>; })}</div> : <div className="crm-scheduler-empty"><CalendarDays aria-hidden="true" /><strong>{isZh ? '还没有课程' : 'No lessons yet'}</strong></div>}</div>;
}