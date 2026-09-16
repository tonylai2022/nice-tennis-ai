alter table public.lessons
  add column if not exists timezone text not null default 'UTC';

drop function if exists public.load_my_schedule();

create function public.load_my_schedule()
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  duration_minutes integer,
  location text,
  timezone text,
  kind text
)
language sql
security definer
set search_path = public
stable
as $$
  select lessons.id, lessons.title, lessons.starts_at, lessons.duration_minutes, lessons.location, lessons.timezone, 'lesson'::text
  from public.lessons
  join public.students on students.id = lessons.student_id
  where students.auth_user_id = auth.uid()
    and lessons.status = 'scheduled'
    and lessons.starts_at >= now()

  union all

  select class_sessions.id, class_sessions.title, class_sessions.starts_at, class_sessions.duration_minutes, class_sessions.location, 'UTC'::text, 'class'::text
  from public.class_sessions
  join public.class_session_students on class_session_students.class_session_id = class_sessions.id
  join public.students on students.id = class_session_students.student_id
  where students.auth_user_id = auth.uid()
    and class_sessions.starts_at >= now()

  order by starts_at asc;
$$;

grant execute on function public.load_my_schedule() to authenticated;

drop function if exists public.book_lesson(uuid, text, timestamptz, integer, text, public.lesson_payment_type, public.lesson_payment_method, public.lesson_payment_status, numeric);

create function public.book_lesson(
  p_student_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_timezone text,
  p_payment_type public.lesson_payment_type,
  p_payment_method public.lesson_payment_method default null,
  p_payment_status public.lesson_payment_status default 'paid',
  p_amount_paid numeric default null
)
returns public.lessons
language plpgsql
security definer
set search_path = public
as $$
declare
  booked_lesson public.lessons;
  current_credits integer;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  select remaining_credits into current_credits from public.students where id = p_student_id and coach_id = auth.uid() for update;
  if not found then raise exception 'Student not found in your roster'; end if;
  if p_payment_type = 'package' then
    if current_credits <= 0 then raise exception 'INSUFFICIENT_CREDITS'; end if;
    update public.students set remaining_credits = remaining_credits - 1 where id = p_student_id;
    p_payment_method := null; p_payment_status := 'paid'; p_amount_paid := null;
  elsif p_payment_method is null or p_amount_paid is null then
    raise exception 'A payment method and amount are required for a drop-in';
  end if;
  insert into public.lessons (coach_id, student_id, title, starts_at, duration_minutes, location, timezone, payment_type, payment_method, payment_status, amount_paid)
  values (auth.uid(), p_student_id, trim(p_title), p_starts_at, p_duration_minutes, nullif(trim(p_location), ''), p_timezone, p_payment_type, p_payment_method, p_payment_status, p_amount_paid)
  returning * into booked_lesson;
  return booked_lesson;
end;
$$;

grant execute on function public.book_lesson(uuid, text, timestamptz, integer, text, text, public.lesson_payment_type, public.lesson_payment_method, public.lesson_payment_status, numeric) to authenticated;

notify pgrst, 'reload schema';