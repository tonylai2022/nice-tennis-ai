alter table public.lesson_packages
  add column if not exists remaining_credits integer;

update public.lesson_packages
set remaining_credits = session_count
where remaining_credits is null;

alter table public.lesson_packages
  alter column remaining_credits set not null,
  alter column remaining_credits set default 0,
  add constraint lesson_packages_remaining_credits_check check (remaining_credits between 0 and session_count);

alter table public.lessons
  add column if not exists package_id uuid references public.lesson_packages(id) on delete set null,
  add column if not exists payment_received_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.lessons as lesson
set package_id = (
  select lesson_package.id
  from public.lesson_packages as lesson_package
  where lesson_package.student_id = lesson.student_id
    and lesson_package.coach_id = lesson.coach_id
    and lesson_package.created_at <= lesson.created_at
  order by lesson_package.created_at desc
  limit 1
)
where lesson.payment_type = 'package' and lesson.package_id is null;

update public.lesson_packages as lesson_package
set remaining_credits = greatest(0, lesson_package.session_count - (
  select count(*)
  from public.lessons as lesson
  where lesson.package_id = lesson_package.id
));

update public.lessons
set payment_received_at = created_at
where payment_type = 'single' and payment_status = 'paid' and payment_received_at is null;

update public.lessons
set completed_at = starts_at
where status = 'completed' and completed_at is null;

create or replace function public.set_lesson_accounting_timestamps()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at = coalesce(new.completed_at, now());
  end if;

  if new.payment_type = 'single' and new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    new.payment_received_at = coalesce(new.payment_received_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists lessons_set_accounting_timestamps on public.lessons;
create trigger lessons_set_accounting_timestamps
  before insert or update on public.lessons
  for each row execute procedure public.set_lesson_accounting_timestamps();

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
  selected_package_id uuid;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;

  if not exists (select 1 from public.students where id = p_student_id and coach_id = auth.uid()) then
    raise exception 'Student not found in your roster';
  end if;

  if p_payment_type = 'package' then
    select id into selected_package_id
    from public.lesson_packages
    where student_id = p_student_id and coach_id = auth.uid() and remaining_credits > 0
    order by created_at asc
    for update skip locked
    limit 1;
    if selected_package_id is null then raise exception 'INSUFFICIENT_CREDITS'; end if;
    update public.lesson_packages set remaining_credits = remaining_credits - 1 where id = selected_package_id;
    update public.students set remaining_credits = remaining_credits - 1 where id = p_student_id;
    p_payment_method := null; p_payment_status := 'paid'; p_amount_paid := null;
  elsif p_payment_method is null or p_amount_paid is null then
    raise exception 'A payment method and amount are required for a drop-in';
  end if;

  insert into public.lessons (coach_id, student_id, title, starts_at, duration_minutes, location, timezone, payment_type, payment_method, payment_status, amount_paid, package_id)
  values (auth.uid(), p_student_id, trim(p_title), p_starts_at, p_duration_minutes, nullif(trim(p_location), ''), p_timezone, p_payment_type, p_payment_method, p_payment_status, p_amount_paid, selected_package_id)
  returning * into booked_lesson;
  return booked_lesson;
end;
$$;

create or replace function public.purchase_lesson_package(
  p_student_id uuid,
  p_session_count integer,
  p_session_duration_minutes integer,
  p_price numeric
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_student public.students;
begin
  if p_session_count < 1 or p_session_count > 100 or p_session_duration_minutes < 15 or p_session_duration_minutes > 480 or p_price < 0 then
    raise exception 'Invalid package details';
  end if;
  update public.students set remaining_credits = remaining_credits + p_session_count where id = p_student_id and coach_id = auth.uid() returning * into updated_student;
  if not found then raise exception 'Student not found in your roster'; end if;
  insert into public.lesson_packages (coach_id, student_id, session_count, remaining_credits, session_duration_minutes, price)
  values (auth.uid(), p_student_id, p_session_count, p_session_count, p_session_duration_minutes, p_price);
  return updated_student;
end;
$$;

notify pgrst, 'reload schema';