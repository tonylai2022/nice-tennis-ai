import { Banknote, Check, Landmark, Smartphone, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Lesson, LessonPaymentMethod, LessonPaymentStatus, LessonPaymentType, Student } from '../services/CoachCRMService';

type BookingModalProps = {
    students: Student[];
    initialDate: Date;
    language?: 'en' | 'zh';
    onClose: () => void;
    onBook: (lesson: Lesson, studentId: string) => void;
    bookLesson: (input: { student_id: string; title: string; starts_at: string; duration_minutes: number; location: string; timezone: string; payment_type: LessonPaymentType; payment_method: LessonPaymentMethod | null; payment_status: LessonPaymentStatus; amount_paid: number | null }) => Promise<Lesson>;
};

const getPaymentMethods = (isZh: boolean): { value: LessonPaymentMethod; label: string; Icon: typeof Banknote }[] => [
    { value: 'cash', label: isZh ? '现金' : 'Cash', Icon: Banknote },
    { value: 'online_transfer', label: isZh ? '转账' : 'Transfer', Icon: Landmark },
    { value: 'zelle', label: 'Zelle', Icon: Smartphone },
    { value: 'fps', label: isZh ? '转数快' : 'FPS', Icon: Smartphone },
    { value: 'other', label: isZh ? '其他' : 'Other', Icon: Check },
];

const getLessonNamePresets = (isZh: boolean) => isZh
    ? ['私教 1对1', '私教 1对2', '私教 1对3', '私教 1对4', '体验课']
    : ['Private 1v1', 'Private 1v2', 'Private 1v3', 'Private 1v4', 'Trial'];

const commonTimezones = ['America/Los_Angeles', 'America/New_York', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

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

export function BookingModal({ students, initialDate, language = 'en', onClose, onBook, bookLesson }: BookingModalProps) {
    const isZh = language === 'zh';
    const paymentMethods = useMemo(() => getPaymentMethods(isZh), [isZh]);
    const lessonNamePresets = useMemo(() => getLessonNamePresets(isZh), [isZh]);
    const [query, setQuery] = useState('');
    const [studentId, setStudentId] = useState('');
    const [title, setTitle] = useState(isZh ? '私教课' : 'Private lesson');

    useEffect(() => {
        setTitle((current) => {
            if (isZh && current === 'Private lesson') return '私教课';
            if (!isZh && current === '私教课') return 'Private lesson';
            return current;
        });
    }, [isZh]);

    const [startsAt, setStartsAt] = useState(() => new Date(initialDate.getTime() - initialDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    const [duration, setDuration] = useState('60');
    const [location, setLocation] = useState('');
    const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [paymentType, setPaymentType] = useState<LessonPaymentType>('package');
    const [paymentMethod, setPaymentMethod] = useState<LessonPaymentMethod>('cash');
    const [paymentStatus, setPaymentStatus] = useState<LessonPaymentStatus>('paid');
    const [amount, setAmount] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [creditWarning, setCreditWarning] = useState(false);
    const visibleStudents = useMemo(() => students.filter((student) => student.full_name.toLowerCase().includes(query.trim().toLowerCase())), [students, query]);
    const selectedStudent = students.find((student) => student.id === studentId);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedStudent) return setError(isZh ? '请选择学员。' : 'Choose a student.');
        if (paymentType === 'package' && selectedStudent.remaining_credits < 1) return setCreditWarning(true);
        if (paymentType === 'single' && (!amount || Number(amount) < 0)) return setError(isZh ? '请输入单次课金额。' : 'Add the drop-in amount.');
        const durationMinutes = Number(duration);
        if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) return setError(isZh ? '课程时长必须为 15 分钟至 8 小时。' : 'Duration must be between 15 minutes and 8 hours.');
        setSaving(true); setError('');
        try {
            const lesson = await bookLesson({ student_id: studentId, title: title.trim() || (isZh ? '私教课' : 'Private lesson'), starts_at: zonedDateTimeToIso(startsAt, timezone), duration_minutes: durationMinutes, location, timezone, payment_type: paymentType, payment_method: paymentType === 'single' ? paymentMethod : null, payment_status: paymentType === 'single' ? paymentStatus : 'paid', amount_paid: paymentType === 'single' ? Number(amount) : null });
            onBook(lesson, studentId);
            onClose();
        } catch (bookingError) {
            const message = bookingError instanceof Error ? bookingError.message : (isZh ? '无法预约该课程。' : 'Could not book this lesson.');
            if (message.includes('INSUFFICIENT_CREDITS')) setCreditWarning(true); else setError(message);
        } finally { setSaving(false); }
    };

    return <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/50 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label={isZh ? '预约课程' : 'Book lesson'}>
        <form onSubmit={submit} style={{ colorScheme: 'light' }} className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg bg-white p-5 text-slate-900 shadow-2xl sm:max-w-lg sm:rounded-lg">
            <header className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-700">{isZh ? '新课程' : 'New lesson'}</p><h2 className="text-xl font-bold text-slate-900">{isZh ? '预约场地课程' : 'Book court time'}</h2></div><button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full text-slate-600 hover:bg-slate-100" aria-label={isZh ? '关闭预约' : 'Close booking'}><X /></button></header>
            <div className="space-y-4">
                <label className="block text-sm font-bold text-slate-700">{isZh ? '查找学员' : 'Find student'}<input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400" placeholder={isZh ? '按姓名搜索' : 'Search by name'} autoFocus /></label>
                <div className="max-h-40 space-y-2 overflow-y-auto">{visibleStudents.map((student) => <button type="button" key={student.id} onClick={() => setStudentId(student.id)} className={`flex min-h-12 w-full items-center justify-between rounded-md border px-3 text-left ${student.id === studentId ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200'}`}><strong className="text-slate-800">{student.full_name}</strong><span className={`text-xs font-bold ${student.remaining_credits ? 'text-emerald-700' : 'text-amber-700'}`}>{isZh ? `剩余 ${student.remaining_credits} 课时` : `${student.remaining_credits} credits left`}</span></button>)}</div>
                <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold text-slate-700">{isZh ? '开始时间' : 'Starts'}<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 bg-white px-2 font-normal text-slate-900" required /></label><label className="text-sm font-bold text-slate-700">{isZh ? '时长（分钟）' : 'Duration (min)'}<input type="number" min="15" max="480" step="15" value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 bg-white px-2 font-normal text-slate-900" required /></label></div>
                <div><label className="block text-sm font-bold text-slate-700">{isZh ? '课程名称' : 'Lesson name'}<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900" /></label><div className="mt-2 flex flex-wrap gap-2">{lessonNamePresets.map((preset) => <button type="button" key={preset} onClick={() => setTitle(preset)} className={`min-h-9 rounded-full border px-3 text-xs font-bold ${title === preset ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-700'}`}>{preset}</button>)}</div></div>
                <label className="block text-sm font-bold text-slate-700">{isZh ? '场地 / 地点' : 'Court / location'}<input value={location} onChange={(event) => setLocation(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900" /></label>
                <label className="block text-sm font-bold text-slate-700">{isZh ? '课程时区' : 'Lesson timezone'}<select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-normal text-slate-900">{[...new Set([timezone, ...commonTimezones])].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
                <fieldset><legend className="mb-2 text-sm font-bold text-slate-700">{isZh ? '支付方式' : 'Payment'}</legend><div className="grid grid-cols-2 rounded-md bg-slate-100 p-1"><button type="button" onClick={() => setPaymentType('package')} className={`min-h-12 rounded px-2 text-sm font-bold ${paymentType === 'package' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}>{isZh ? '课时套餐' : 'Package credit'}</button><button type="button" onClick={() => setPaymentType('single')} className={`min-h-12 rounded px-2 text-sm font-bold ${paymentType === 'single' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}>{isZh ? '单次单结' : 'Single drop-in'}</button></div></fieldset>
                {paymentType === 'single' && <div className="space-y-3 border-l-2 border-emerald-500 pl-3"><div className="grid grid-cols-3 gap-2">{paymentMethods.map(({ value, label, Icon }) => <button type="button" key={value} onClick={() => setPaymentMethod(value)} className={`flex min-h-12 flex-col items-center justify-center rounded-md border text-xs font-bold ${paymentMethod === value ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}><Icon size={17} />{label}</button>)}</div><div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold text-slate-700">{isZh ? '金额' : 'Amount'}<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-slate-300 px-3 font-normal" placeholder="0.00" required /></label><div><span className="text-sm font-bold text-slate-700">{isZh ? '状态' : 'Status'}</span><div className="mt-1 flex rounded-md bg-slate-100 p-1"><button type="button" onClick={() => setPaymentStatus('paid')} className={`min-h-10 flex-1 rounded text-xs font-bold ${paymentStatus === 'paid' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}>{isZh ? '已支付' : 'Paid'}</button><button type="button" onClick={() => setPaymentStatus('pending')} className={`min-h-10 flex-1 rounded text-xs font-bold ${paymentStatus === 'pending' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-600'}`}>{isZh ? '待付款' : 'Pending'}</button></div></div></div></div>}
                {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
                <button disabled={saving} className="min-h-14 w-full rounded-md bg-emerald-700 text-base font-bold text-white disabled:opacity-60">{saving ? (isZh ? '正在预约...' : 'Booking...') : paymentType === 'package' ? (isZh ? '扣除 1 课时预约' : 'Book with 1 credit') : (isZh ? '预约单次课' : 'Book drop-in')}</button>
            </div>
        </form>
        {creditWarning && <div className="fixed inset-0 z-[71] grid place-items-center bg-slate-950/60 p-5"><div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-lg bg-white p-5 text-center shadow-2xl"><h2 className="text-lg font-bold text-slate-900">{isZh ? '课时已耗尽' : 'No package credits left'}</h2><p className="mt-2 text-sm text-slate-600">{selectedStudent?.full_name ?? (isZh ? '该学员' : 'This student')} {isZh ? '课时不足，请先充值课时包或按单次预约。' : 'needs a new package or a single drop-in booking.'}</p><button type="button" onClick={() => setCreditWarning(false)} className="mt-5 min-h-12 w-full rounded-md bg-emerald-700 font-bold text-white">{isZh ? '选择支付方式' : 'Choose payment'}</button></div></div>}
    </div>;
}