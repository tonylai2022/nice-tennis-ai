do $$ begin
  create type public.lesson_payment_type as enum ('package', 'single');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.lesson_payment_method as enum ('cash', 'online_transfer', 'zelle', 'fps', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.lesson_payment_status as enum ('paid', 'pending');
exception when duplicate_object then null;
end $$;

alter table public.students
  add column if not exists remaining_credits integer not null default 0
  check (remaining_credits >= 0);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null default 'Private lesson' check (char_length(trim(title)) > 0),
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  location text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  payment_type public.lesson_payment_type not null,
  payment_method public.lesson_payment_method,
  payment_status public.lesson_payment_status not null default 'paid',
  amount_paid numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payment_type = 'package' and payment_method is null and amount_paid is null)
    or (payment_type = 'single' and payment_method is not null and amount_paid is not null and amount_paid >= 0))
);

create index if not exists lessons_coach_starts_at_idx on public.lessons (coach_id, starts_at asc);
create index if not exists lessons_student_starts_at_idx on public.lessons (student_id, starts_at asc);

create trigger lessons_set_updated_at
  before update on public.lessons
  for each row execute procedure public.set_student_updated_at();

alter table public.lessons enable row level security;

create policy "Coaches manage their lessons"
  on public.lessons for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create or replace function public.book_lesson(
  p_student_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_location text,
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
  select remaining_credits into current_credits
  from public.students
  where id = p_student_id and coach_id = auth.uid()
  for update;

  if not found then raise exception 'Student not found in your roster'; end if;
  if p_payment_type = 'package' then
    if current_credits <= 0 then raise exception 'INSUFFICIENT_CREDITS'; end if;
    update public.students set remaining_credits = remaining_credits - 1 where id = p_student_id;
    p_payment_method := null; p_payment_status := 'paid'; p_amount_paid := null;
  elsif p_payment_method is null or p_amount_paid is null then
    raise exception 'A payment method and amount are required for a drop-in';
  end if;

  insert into public.lessons (coach_id, student_id, title, starts_at, duration_minutes, location, payment_type, payment_method, payment_status, amount_paid)
  values (auth.uid(), p_student_id, trim(p_title), p_starts_at, p_duration_minutes, nullif(trim(p_location), ''), p_payment_type, p_payment_method, p_payment_status, p_amount_paid)
  returning * into booked_lesson;
  return booked_lesson;
end;
$$;

grant execute on function public.book_lesson(uuid, text, timestamptz, integer, text, public.lesson_payment_type, public.lesson_payment_method, public.lesson_payment_status, numeric) to authenticated;