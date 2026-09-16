import { Banknote, Landmark, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Lesson, LessonPackage, Student } from '../services/CoachCRMService';

type Timeframe = 'week' | 'month' | 'ytd';
type FinancialDashboardProps = {
    students: Student[];
    lessons: Lesson[];
    packages: LessonPackage[];
    language?: 'en' | 'zh';
    onSettle: (lesson: Lesson) => Promise<void>;
};

const startFor = (timeframe: Timeframe, now: Date) => {
    const start = new Date(now);
    if (timeframe === 'week') start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    if (timeframe === 'month') start.setDate(1);
    if (timeframe === 'ytd') start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return start;
};

const previousStartFor = (timeframe: Timeframe, start: Date) => {
    const previous = new Date(start);
    if (timeframe === 'week') previous.setDate(previous.getDate() - 7);
    if (timeframe === 'month') previous.setMonth(previous.getMonth() - 1);
    if (timeframe === 'ytd') previous.setFullYear(previous.getFullYear() - 1);
    return previous;
};

const currency = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
const methodIcon = (method: Lesson['payment_method']) => method === 'cash' ? Banknote : method === 'online_transfer' ? Landmark : Smartphone;
const packageAmountForLesson = (lesson: Lesson, packages: LessonPackage[]) => {
    const lessonPackage = packages.find((item) => item.id === lesson.package_id);
    return lessonPackage ? lessonPackage.price / lessonPackage.session_count : null;
};

export function FinancialDashboard({ students, lessons, packages, language = 'en', onSettle }: FinancialDashboardProps) {
    const isZh = language === 'zh';
    const [timeframe, setTimeframe] = useState<Timeframe>('month');
    const [settling, setSettling] = useState<Lesson | null>(null);
    const [saving, setSaving] = useState(false);
    const metrics = useMemo(() => {
        const now = new Date(); const start = startFor(timeframe, now); const previousStart = previousStartFor(timeframe, start);
        const inRange = (date: string, from: Date, until: Date) => { const value = new Date(date); return value >= from && value < until; };
        const revenueFor = (from: Date, until: Date) => lessons.filter((lesson) => lesson.status === 'completed' && lesson.payment_status === 'paid' && inRange(lesson.completed_at ?? lesson.starts_at, from, until)).reduce((sum, lesson) => sum + (lesson.payment_type === 'single' ? lesson.amount_paid ?? 0 : packageAmountForLesson(lesson, packages) ?? 0), 0);
        const revenue = revenueFor(start, now); const previousRevenue = revenueFor(previousStart, start);
        const pending = lessons.filter((lesson) => lesson.payment_type === 'single' && lesson.payment_status === 'pending' && lesson.status !== 'cancelled' && inRange(lesson.starts_at, start, now));
        const completed = lessons.filter((lesson) => lesson.status === 'completed' && inRange(lesson.starts_at, start, now));
        const activePackageStudents = students.filter((student) => student.remaining_credits > 0);
        return { revenue, previousRevenue, pending, completed, activePackageStudents, lowCredits: activePackageStudents.filter((student) => student.remaining_credits <= 2), credits: activePackageStudents.reduce((sum, student) => sum + student.remaining_credits, 0) };
    }, [timeframe, lessons, packages, students]);
    const comparison = metrics.previousRevenue ? Math.round((metrics.revenue - metrics.previousRevenue) / metrics.previousRevenue * 100) : null;
    const activity = useMemo(() => [...packages.map((item) => ({ id: `package-${item.id}`, date: item.created_at, student: students.find((student) => student.id === item.student_id), title: isZh ? '套餐预付款' : 'Package prepaid', detail: isZh ? `${item.session_count} 节课 · 已收款，完成课程后确认收入` : `${item.session_count} sessions · payment received, recognized as income after each completed lesson`, amount: item.price, status: 'prepaid' as const, method: null, lesson: null })), ...lessons.map((lesson) => {
        const packageAmount = packageAmountForLesson(lesson, packages);
        const completed = lesson.status === 'completed';
        const paid = lesson.payment_status === 'paid';
        return { id: `lesson-${lesson.id}`, date: completed ? lesson.completed_at ?? lesson.starts_at : lesson.starts_at, student: students.find((student) => student.id === lesson.student_id), title: lesson.title, detail: lesson.payment_type === 'package' ? (completed ? (isZh ? '套餐课时 · 已确认收入' : 'Package lesson · income recognized') : (isZh ? '已预留套餐课时 · 未确认收入' : 'Package credit reserved · income not recognized')) : (completed && paid ? (isZh ? '单次课 · 已确认收入' : 'Single drop-in · income recognized') : paid ? (isZh ? '已收款 · 等待完成课程' : 'Payment received · awaiting lesson completion') : (isZh ? '待收款' : 'Payment pending')), amount: lesson.payment_type === 'package' ? packageAmount : lesson.amount_paid, status: completed && paid ? 'recognized' as const : lesson.payment_status, method: lesson.payment_method, lesson };
    })].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 8), [lessons, packages, students, isZh]);
    const settle = async () => { if (!settling) return; setSaving(true); try { await onSettle(settling); setSettling(null); } finally { setSaving(false); } };
    const timeframeOptions: readonly [Timeframe, string][] = isZh
        ? [['week', '本周'], ['month', '本月'], ['ytd', '今年至今']]
        : [['week', 'This week'], ['month', 'This month'], ['ytd', 'YTD']];

    return <section className="space-y-4 pb-24"><div className="flex rounded-md bg-slate-100 p-1" aria-label={isZh ? '数据面板时间范围' : 'Dashboard timeframe'}>{timeframeOptions.map(([value, label]) => <button type="button" key={value} onClick={() => setTimeframe(value)} className={`min-h-11 flex-1 rounded px-2 text-sm font-bold ${timeframe === value ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}>{label}</button>)}</div><section className="grid grid-cols-2 gap-3"><article className="col-span-2 rounded-md bg-emerald-800 p-5 text-white"><span className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-100">{isZh ? '总营业额' : 'Gross revenue'}</span><strong className="mt-1 block text-4xl font-bold">{currency(metrics.revenue)}</strong><small className="mt-2 block text-emerald-100">{comparison === null ? (isZh ? '暂无前期对比数据' : 'No prior-period comparison yet') : `${comparison >= 0 ? '+' : ''}${comparison}% ${isZh ? '比上一时段' : 'vs previous period'}`}</small></article><article className={`rounded-md border p-4 ${metrics.pending.length ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}><span className="text-xs font-bold uppercase tracking-[0.08em] text-slate-600">{isZh ? '待收款项' : 'Pending cash'}</span><strong className={`mt-1 block text-2xl font-bold ${metrics.pending.length ? 'text-amber-800' : 'text-slate-900'}`}>{currency(metrics.pending.reduce((sum, lesson) => sum + (lesson.amount_paid ?? 0), 0))}</strong><small className="mt-1 block text-slate-600">{isZh ? `${metrics.pending.length} 节单次课待收款` : `${metrics.pending.length} drop-in${metrics.pending.length === 1 ? '' : 's'} awaiting payment`}</small></article><article className="rounded-md border border-slate-200 bg-white p-4"><span className="text-xs font-bold uppercase tracking-[0.08em] text-slate-600">{isZh ? '套餐健康度' : 'Package health'}</span><strong className="mt-1 block text-2xl font-bold text-slate-900">{metrics.activePackageStudents.length}</strong><small className="mt-1 block text-slate-600">{isZh ? `位活跃学员 · ${metrics.lowCredits.length} 位课时不足` : `active · ${metrics.lowCredits.length} low credits`}</small></article></section><section className="rounded-md border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-700">{isZh ? '教学课时统计' : 'Coaching volume'}</p><h2 className="text-xl font-bold text-slate-900">{isZh ? `${metrics.completed.length} 节已完成课程` : `${metrics.completed.length} completed lessons`}</h2></div><strong className="text-lg font-bold text-emerald-700">{isZh ? `${metrics.credits} 课时` : `${metrics.credits} credits`}</strong></div><p className="mt-2 text-sm text-slate-600">{isZh ? `${metrics.completed.filter((lesson) => lesson.payment_type === 'package').length} 套餐课 · ${metrics.completed.filter((lesson) => lesson.payment_type === 'single').length} 单次课` : `${metrics.completed.filter((lesson) => lesson.payment_type === 'package').length} package · ${metrics.completed.filter((lesson) => lesson.payment_type === 'single').length} drop-in`}</p></section><section className="rounded-md border border-slate-200 bg-white"><div className="border-b border-slate-200 p-4"><p className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-700">{isZh ? '流水账单' : 'Quick ledger'}</p><h2 className="text-xl font-bold text-slate-900">{isZh ? '近期收支' : 'Recent activity'}</h2></div>{activity.length ? <div className="divide-y divide-slate-100">{activity.map((item) => { const Icon = methodIcon(item.method); return <article key={item.id} className="flex items-center gap-3 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600"><Icon size={18} /></span><div className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-900">{item.student?.full_name ?? (isZh ? '学员' : 'Student')}</strong><span className="block truncate text-xs text-slate-600">{item.title} · {item.detail}</span></div><div className="text-right"><strong className="block text-sm text-slate-900">{item.amount === null ? (isZh ? '1 课时' : '1 credit') : currency(item.amount)}</strong>{item.status === 'pending' && item.lesson ? <button type="button" onClick={() => setSettling(item.lesson)} className="mt-1 rounded-full bg-amber-200 px-2 py-1 text-xs font-bold text-amber-900">{isZh ? '收款' : 'Collect'}</button> : <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">{item.status === 'paid' ? (isZh ? '已付' : 'Paid') : (isZh ? '套餐' : 'Package')}</span>}</div></article>; })}</div> : <p className="p-6 text-center text-sm text-slate-600">{isZh ? '所选时间段内暂无财务记录。' : 'No financial activity in this timeframe.'}</p>}</section>{settling && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-5"><div role="dialog" aria-modal="true" aria-label={isZh ? '确认已收款' : 'Confirm payment collected'} className="w-full max-w-sm rounded-lg bg-white p-5"><p className="text-xs font-bold uppercase tracking-[0.08em] text-amber-700">{isZh ? '收取费用' : 'Collect payment'}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{isZh ? '标记为已支付？' : 'Mark as paid?'}</h2><p className="mt-2 text-sm text-slate-600">{students.find((student) => student.id === settling.student_id)?.full_name ?? (isZh ? '学员' : 'Student')} · {currency(settling.amount_paid ?? 0)}</p><div className="mt-5 flex gap-3"><button type="button" onClick={() => setSettling(null)} className="min-h-11 flex-1 rounded-md border border-slate-300 font-bold text-slate-700">{isZh ? '取消' : 'Cancel'}</button><button type="button" disabled={saving} onClick={() => void settle()} className="min-h-11 flex-1 rounded-md bg-emerald-700 font-bold text-white">{saving ? (isZh ? '正在保存...' : 'Saving...') : (isZh ? '标记已付' : 'Mark paid')}</button></div></div></div>}</section>;
}