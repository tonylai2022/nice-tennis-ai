create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.class_session_students (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_status text not null default 'unmarked' check (attendance_status in ('unmarked', 'present', 'absent', 'late')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'waived')),
  payment_amount numeric(10, 2),
  payment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_session_id, student_id),
  check (payment_amount is null or payment_amount >= 0)
);

create index class_sessions_coach_starts_at_idx on public.class_sessions (coach_id, starts_at asc);
create index class_session_students_session_idx on public.class_session_students (class_session_id);

create trigger class_sessions_set_updated_at
  before update on public.class_sessions
  for each row execute procedure public.set_student_updated_at();

create trigger class_session_students_set_updated_at
  before update on public.class_session_students
  for each row execute procedure public.set_student_updated_at();

alter table public.class_sessions enable row level security;
alter table public.class_session_students enable row level security;

create policy "Coaches manage their class sessions"
  on public.class_sessions for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create policy "Coaches manage session attendance and payments"
  on public.class_session_students for all to authenticated
  using (exists (
    select 1 from public.class_sessions
    where class_sessions.id = class_session_students.class_session_id
      and class_sessions.coach_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.class_sessions
    join public.students on students.id = class_session_students.student_id
    where class_sessions.id = class_session_students.class_session_id
      and class_sessions.coach_id = auth.uid()
      and students.coach_id = auth.uid()
  ));