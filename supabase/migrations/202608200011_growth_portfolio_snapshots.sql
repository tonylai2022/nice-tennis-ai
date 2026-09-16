create function public.has_valid_capability_scores(scores jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(scores) = 'object'
    and scores ?& array[
      'forehand_drive',
      'backhand_drive',
      'forehand_volley',
      'backhand_volley',
      'forehand_slice',
      'backhand_slice',
      'serve_and_return',
      'footwork'
    ]
    and not exists (
      select 1
      from jsonb_each_text(scores) as score(key, value)
      where score.key not in (
        'forehand_drive',
        'backhand_drive',
        'forehand_volley',
        'backhand_volley',
        'forehand_slice',
        'backhand_slice',
        'serve_and_return',
        'footwork'
      )
      or score.value !~ '^(100([.]0+)?|[0-9]{1,2}([.][0-9]+)?)$'
  );
$$;

create table public.capability_assessment_snapshots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  capability_scores jsonb not null check (public.has_valid_capability_scores(capability_scores)),
  coach_notes text,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.capability_snapshot_sources (
  id uuid primary key default gen_random_uuid(),
  capability_snapshot_id uuid not null references public.capability_assessment_snapshots(id) on delete cascade,
  source_coach_record_id uuid references public.coach_records(id) on delete cascade,
  source_coach_record_media_id uuid references public.coach_record_media(id) on delete cascade,
  source_student_assessment_id uuid references public.student_assessments(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(source_coach_record_id, source_coach_record_media_id, source_student_assessment_id) = 1)
);

create table public.growth_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  capability_snapshot_id uuid references public.capability_assessment_snapshots(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0),
  report_content jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft' and published_at is null) or (status = 'published' and published_at is not null))
);

create index capability_assessment_snapshots_student_idx
  on public.capability_assessment_snapshots (student_id, assessed_at desc);
create index capability_assessment_snapshots_coach_idx
  on public.capability_assessment_snapshots (coach_id, created_at desc);
create index capability_snapshot_sources_snapshot_idx
  on public.capability_snapshot_sources (capability_snapshot_id);
create index growth_report_snapshots_student_idx
  on public.growth_report_snapshots (student_id, published_at desc);

create trigger growth_report_snapshots_set_updated_at
  before update on public.growth_report_snapshots
  for each row execute procedure public.set_student_updated_at();

create function public.lock_published_growth_report_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'Published growth report snapshots are immutable. Create a new report snapshot instead.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger growth_report_snapshots_immutable_after_publish
  before update or delete on public.growth_report_snapshots
  for each row execute procedure public.lock_published_growth_report_snapshot();

alter table public.capability_assessment_snapshots enable row level security;
alter table public.capability_snapshot_sources enable row level security;
alter table public.growth_report_snapshots enable row level security;

create policy "Coaches create roster capability snapshots"
  on public.capability_assessment_snapshots for insert to authenticated
  with check (coach_id = auth.uid() and exists (
    select 1 from public.students
    where students.id = capability_assessment_snapshots.student_id
      and students.coach_id = auth.uid()
  ));

create policy "Coaches read their capability snapshots"
  on public.capability_assessment_snapshots for select to authenticated
  using (coach_id = auth.uid());

create policy "Students read their published capability snapshots"
  on public.capability_assessment_snapshots for select to authenticated
  using (exists (
    select 1 from public.growth_report_snapshots
    join public.students on students.id = growth_report_snapshots.student_id
    where growth_report_snapshots.capability_snapshot_id = capability_assessment_snapshots.id
      and growth_report_snapshots.status = 'published'
      and students.auth_user_id = auth.uid()
  ));

create policy "Coaches add sources to their capability snapshots"
  on public.capability_snapshot_sources for insert to authenticated
  with check (exists (
    select 1 from public.capability_assessment_snapshots
    where capability_assessment_snapshots.id = capability_snapshot_sources.capability_snapshot_id
      and capability_assessment_snapshots.coach_id = auth.uid()
      and (source_coach_record_id is null or exists (
        select 1 from public.coach_records
        where coach_records.id = capability_snapshot_sources.source_coach_record_id
          and coach_records.coach_id = auth.uid()
          and coach_records.student_id = capability_assessment_snapshots.student_id
      ))
      and (source_coach_record_media_id is null or exists (
        select 1 from public.coach_record_media
        join public.coach_records on coach_records.id = coach_record_media.coach_record_id
        where coach_record_media.id = capability_snapshot_sources.source_coach_record_media_id
          and coach_records.coach_id = auth.uid()
          and coach_records.student_id = capability_assessment_snapshots.student_id
      ))
      and (source_student_assessment_id is null or exists (
        select 1 from public.student_assessments
        where student_assessments.id = capability_snapshot_sources.source_student_assessment_id
          and student_assessments.coach_id = auth.uid()
          and student_assessments.student_id = capability_assessment_snapshots.student_id
      ))
  ));

create policy "Coaches read sources for their capability snapshots"
  on public.capability_snapshot_sources for select to authenticated
  using (exists (
    select 1 from public.capability_assessment_snapshots
    where capability_assessment_snapshots.id = capability_snapshot_sources.capability_snapshot_id
      and capability_assessment_snapshots.coach_id = auth.uid()
  ));

create policy "Students read sources for their published capability snapshots"
  on public.capability_snapshot_sources for select to authenticated
  using (exists (
    select 1 from public.capability_assessment_snapshots
    join public.growth_report_snapshots on growth_report_snapshots.capability_snapshot_id = capability_assessment_snapshots.id
    join public.students on students.id = capability_assessment_snapshots.student_id
    where capability_assessment_snapshots.id = capability_snapshot_sources.capability_snapshot_id
      and growth_report_snapshots.status = 'published'
      and students.auth_user_id = auth.uid()
  ));

create policy "Coaches manage draft report snapshots for their roster"
  on public.growth_report_snapshots for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and exists (
    select 1 from public.students
    where students.id = growth_report_snapshots.student_id
      and students.coach_id = auth.uid()
  ) and (capability_snapshot_id is null or exists (
    select 1 from public.capability_assessment_snapshots
    where capability_assessment_snapshots.id = growth_report_snapshots.capability_snapshot_id
      and capability_assessment_snapshots.coach_id = auth.uid()
      and capability_assessment_snapshots.student_id = growth_report_snapshots.student_id
  )));

create policy "Students read their published growth report snapshots"
  on public.growth_report_snapshots for select to authenticated
  using (status = 'published' and exists (
    select 1 from public.students
    where students.id = growth_report_snapshots.student_id
      and students.auth_user_id = auth.uid()
  ));
