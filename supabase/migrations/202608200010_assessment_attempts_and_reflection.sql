alter table public.student_assessments
  add column if not exists student_reflection text;

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  student_assessment_id uuid not null references public.student_assessments(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  result_value numeric,
  score numeric(5, 2) check (score is null or (score >= 0 and score <= 100)),
  notes text,
  created_at timestamptz not null default now()
);

create index assessment_attempts_assessment_idx
  on public.assessment_attempts (student_assessment_id, created_at desc);

alter table public.assessment_attempts enable row level security;

create policy "Coaches manage attempts for their roster assessments"
  on public.assessment_attempts for all to authenticated
  using (coach_id = auth.uid() and exists (
    select 1 from public.student_assessments
    where student_assessments.id = assessment_attempts.student_assessment_id
      and student_assessments.coach_id = auth.uid()
  ))
  with check (coach_id = auth.uid() and exists (
    select 1 from public.student_assessments
    where student_assessments.id = assessment_attempts.student_assessment_id
      and student_assessments.coach_id = auth.uid()
  ));

create policy "Students read attempts for their published assessments"
  on public.assessment_attempts for select to authenticated
  using (exists (
    select 1 from public.student_assessments
    join public.students on students.id = student_assessments.student_id
    where student_assessments.id = assessment_attempts.student_assessment_id
      and student_assessments.is_published
      and students.auth_user_id = auth.uid()
  ));

create or replace function public.update_my_assessment_reflection(assessment_id uuid, reflection text)
returns public.student_assessments
language plpgsql
security definer set search_path = public
as $$
declare
  assessment_row public.student_assessments;
begin
  update public.student_assessments
  set student_reflection = nullif(trim(reflection), '')
  where id = assessment_id
    and is_published
    and exists (
      select 1 from public.students
      where students.id = student_assessments.student_id
        and students.auth_user_id = auth.uid()
    )
  returning * into assessment_row;

  if not found then
    raise exception 'Assessment is not available to update.';
  end if;
  return assessment_row;
end;
$$;

revoke all on function public.update_my_assessment_reflection(uuid, text) from public;
grant execute on function public.update_my_assessment_reflection(uuid, text) to authenticated;
