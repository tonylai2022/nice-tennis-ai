create table public.assessment_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  challenge_type text not null check (challenge_type in ('rally_count', 'serve_in_percentage', 'target_hit_rate', 'rubric_score')),
  target_value numeric not null check (target_value > 0),
  unit text not null check (char_length(trim(unit)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_assessments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  template_id uuid references public.assessment_templates(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0),
  challenge_type text not null check (challenge_type in ('rally_count', 'serve_in_percentage', 'target_hit_rate', 'rubric_score')),
  target_value numeric not null check (target_value > 0),
  unit text not null check (char_length(trim(unit)) > 0),
  result_value numeric,
  score numeric(5, 2) check (score is null or (score >= 0 and score <= 100)),
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'achieved', 'not_achieved')),
  achieved_at timestamptz,
  notes text,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assessment_evidence (
  id uuid primary key default gen_random_uuid(),
  student_assessment_id uuid not null references public.student_assessments(id) on delete cascade,
  source_coach_record_id uuid references public.coach_records(id) on delete cascade,
  source_coach_record_media_id uuid references public.coach_record_media(id) on delete cascade,
  external_url text check (external_url is null or external_url ~ '^https?://'),
  label text,
  notes text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(source_coach_record_id, source_coach_record_media_id, external_url) >= 1)
);

create index assessment_templates_coach_idx on public.assessment_templates (coach_id, created_at desc);
create index student_assessments_student_status_idx on public.student_assessments (student_id, status, created_at desc);
create index student_assessments_coach_idx on public.student_assessments (coach_id, created_at desc);
create index assessment_evidence_assessment_idx on public.assessment_evidence (student_assessment_id);

create trigger assessment_templates_set_updated_at
  before update on public.assessment_templates
  for each row execute procedure public.set_student_updated_at();

create trigger student_assessments_set_updated_at
  before update on public.student_assessments
  for each row execute procedure public.set_student_updated_at();

alter table public.assessment_templates enable row level security;
alter table public.student_assessments enable row level security;
alter table public.assessment_evidence enable row level security;

create policy "Coaches manage their assessment templates"
  on public.assessment_templates for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create policy "Coaches manage assessments for their roster"
  on public.student_assessments for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and exists (
    select 1 from public.students
    where students.id = student_assessments.student_id
      and students.coach_id = auth.uid()
  ) and (template_id is null or exists (
    select 1 from public.assessment_templates
    where assessment_templates.id = student_assessments.template_id
      and assessment_templates.coach_id = auth.uid()
  )));

create policy "Students read their published assessments"
  on public.student_assessments for select to authenticated
  using (is_published and exists (
    select 1 from public.students
    where students.id = student_assessments.student_id
      and students.auth_user_id = auth.uid()
  ));

create policy "Coaches manage assessment evidence for their roster"
  on public.assessment_evidence for all to authenticated
  using (exists (
    select 1 from public.student_assessments
    where student_assessments.id = assessment_evidence.student_assessment_id
      and student_assessments.coach_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.student_assessments
    where student_assessments.id = assessment_evidence.student_assessment_id
      and student_assessments.coach_id = auth.uid()
  ) and (source_coach_record_id is null or exists (
    select 1 from public.coach_records
    where coach_records.id = assessment_evidence.source_coach_record_id
      and coach_records.coach_id = auth.uid()
      and coach_records.student_id = (select student_id from public.student_assessments where id = assessment_evidence.student_assessment_id)
  )) and (source_coach_record_media_id is null or exists (
    select 1 from public.coach_record_media
    join public.coach_records on coach_records.id = coach_record_media.coach_record_id
    where coach_record_media.id = assessment_evidence.source_coach_record_media_id
      and coach_records.coach_id = auth.uid()
      and coach_records.student_id = (select student_id from public.student_assessments where id = assessment_evidence.student_assessment_id)
  )));

create policy "Students read evidence for their published assessments"
  on public.assessment_evidence for select to authenticated
  using (exists (
    select 1 from public.student_assessments
    join public.students on students.id = student_assessments.student_id
    where student_assessments.id = assessment_evidence.student_assessment_id
      and student_assessments.is_published
      and students.auth_user_id = auth.uid()
  ));
