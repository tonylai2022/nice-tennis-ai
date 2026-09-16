create table public.homework_assignments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  instructions text not null check (char_length(trim(instructions)) > 0),
  due_at timestamptz,
  is_published boolean not null default true,
  status text not null default 'assigned' check (status in ('assigned', 'completed', 'reviewed')),
  student_reflection text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.homework_evidence (
  id uuid primary key default gen_random_uuid(),
  homework_assignment_id uuid not null references public.homework_assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create index homework_assignments_student_status_due_idx
  on public.homework_assignments (student_id, status, due_at asc nulls last);
create index homework_evidence_assignment_idx on public.homework_evidence (homework_assignment_id);

create trigger homework_assignments_set_updated_at
  before update on public.homework_assignments
  for each row execute procedure public.set_student_updated_at();

alter table public.homework_assignments enable row level security;
alter table public.homework_evidence enable row level security;

create policy "Coaches manage homework for their roster"
  on public.homework_assignments for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and exists (
    select 1 from public.students where students.id = homework_assignments.student_id and students.coach_id = auth.uid()
  ));

create policy "Students read their published homework"
  on public.homework_assignments for select to authenticated
  using (is_published and exists (
    select 1 from public.students where students.id = homework_assignments.student_id and students.auth_user_id = auth.uid()
  ));

create policy "Coaches read homework evidence for their roster"
  on public.homework_evidence for select to authenticated
  using (exists (
    select 1 from public.homework_assignments where homework_assignments.id = homework_evidence.homework_assignment_id and homework_assignments.coach_id = auth.uid()
  ));

create policy "Students read their homework evidence"
  on public.homework_evidence for select to authenticated
  using (exists (
    select 1 from public.students where students.id = homework_evidence.student_id and students.auth_user_id = auth.uid()
  ));

create policy "Students add evidence to their homework"
  on public.homework_evidence for insert to authenticated
  with check (exists (
    select 1 from public.homework_assignments
    join public.students on students.id = homework_assignments.student_id
    where homework_assignments.id = homework_evidence.homework_assignment_id
      and homework_assignments.student_id = homework_evidence.student_id
      and homework_assignments.is_published
      and students.auth_user_id = auth.uid()
  ));

create or replace function public.complete_my_homework(homework_id uuid, reflection text default null)
returns public.homework_assignments
language plpgsql
security definer set search_path = public
as $$
declare
  assignment_row public.homework_assignments;
begin
  update public.homework_assignments
  set status = 'completed',
      student_reflection = nullif(trim(reflection), ''),
      completed_at = coalesce(completed_at, now())
  where id = homework_id
    and is_published
    and exists (
      select 1 from public.students where students.id = homework_assignments.student_id and students.auth_user_id = auth.uid()
    )
  returning * into assignment_row;

  if not found then
    raise exception 'Homework assignment is not available to this student.';
  end if;
  return assignment_row;
end;
$$;

revoke all on function public.complete_my_homework(uuid, text) from public;
grant execute on function public.complete_my_homework(uuid, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('homework-evidence', 'homework-evidence', false)
on conflict (id) do nothing;

create policy "Students upload their homework evidence"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'homework-evidence' and exists (
    select 1 from public.homework_assignments
    join public.students on students.id = homework_assignments.student_id
    where homework_assignments.id::text = (storage.foldername(name))[2]
      and students.id::text = (storage.foldername(name))[1]
      and homework_assignments.is_published
      and students.auth_user_id = auth.uid()
  ));

create policy "Homework owners read their evidence objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'homework-evidence' and exists (
    select 1 from public.homework_evidence
    join public.students on students.id = homework_evidence.student_id
    where homework_evidence.storage_path = name and students.auth_user_id = auth.uid()
  ));

create policy "Coaches read roster homework evidence objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'homework-evidence' and exists (
    select 1 from public.homework_evidence
    join public.homework_assignments on homework_assignments.id = homework_evidence.homework_assignment_id
    where homework_evidence.storage_path = name and homework_assignments.coach_id = auth.uid()
  ));