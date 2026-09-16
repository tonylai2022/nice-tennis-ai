create table public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_count integer not null check (session_count between 1 and 100),
  session_duration_minutes integer not null check (session_duration_minutes between 15 and 480),
  price numeric(10, 2) not null check (price >= 0),
  created_at timestamptz not null default now()
);

create index lesson_packages_coach_student_idx on public.lesson_packages (coach_id, student_id, created_at desc);
alter table public.lesson_packages enable row level security;

create policy "Coaches manage their lesson packages"
  on public.lesson_packages for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

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

  update public.students
  set remaining_credits = remaining_credits + p_session_count
  where id = p_student_id and coach_id = auth.uid()
  returning * into updated_student;
  if not found then raise exception 'Student not found in your roster'; end if;

  insert into public.lesson_packages (coach_id, student_id, session_count, session_duration_minutes, price)
  values (auth.uid(), p_student_id, p_session_count, p_session_duration_minutes, p_price);
  return updated_student;
end;
$$;

grant execute on function public.purchase_lesson_package(uuid, integer, integer, numeric) to authenticated;