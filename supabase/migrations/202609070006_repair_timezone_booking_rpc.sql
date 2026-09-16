-- Use a distinct RPC name so PostgREST cannot select an outdated book_lesson overload.
create or replace function public.book_lesson_with_timezone(
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

  select remaining_credits into current_credits
  from public.students
  where id = p_student_id and coach_id = auth.uid()
  for update;
  if not found then raise exception 'Student not found in your roster'; end if;

  if p_payment_type = 'package' then
    if current_credits <= 0 then raise exception 'INSUFFICIENT_CREDITS'; end if;
    update public.students set remaining_credits = remaining_credits - 1 where id = p_student_id;
    p_payment_method := null;
    p_payment_status := 'paid';
    p_amount_paid := null;
  elsif p_payment_method is null or p_amount_paid is null then
    raise exception 'A payment method and amount are required for a drop-in';
  end if;

  insert into public.lessons (coach_id, student_id, title, starts_at, duration_minutes, location, timezone, payment_type, payment_method, payment_status, amount_paid)
  values (auth.uid(), p_student_id, trim(p_title), p_starts_at, p_duration_minutes, nullif(trim(p_location), ''), p_timezone, p_payment_type, p_payment_method, p_payment_status, p_amount_paid)
  returning * into booked_lesson;
  return booked_lesson;
end;
$$;

revoke all on function public.book_lesson_with_timezone(uuid, text, timestamptz, integer, text, text, public.lesson_payment_type, public.lesson_payment_method, public.lesson_payment_status, numeric) from public;
grant execute on function public.book_lesson_with_timezone(uuid, text, timestamptz, integer, text, text, public.lesson_payment_type, public.lesson_payment_method, public.lesson_payment_status, numeric) to authenticated;

notify pgrst, 'reload schema';