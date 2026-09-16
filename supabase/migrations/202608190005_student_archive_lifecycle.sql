alter table public.students
  add column if not exists student_archived_at timestamptz;

create index if not exists students_coach_archived_idx
  on public.students (coach_id, student_archived_at);