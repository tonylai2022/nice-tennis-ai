alter table public.homework_assignments
  add column if not exists drill_category text;

create table public.homework_resource_media (
  id uuid primary key default gen_random_uuid(),
  homework_assignment_id uuid not null references public.homework_assignments(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  original_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create index homework_resource_media_assignment_idx
  on public.homework_resource_media (homework_assignment_id);

alter table public.homework_resource_media enable row level security;

create policy "Coaches manage homework resources for their roster"
  on public.homework_resource_media for all to authenticated
  using (exists (
    select 1 from public.homework_assignments
    where homework_assignments.id = homework_resource_media.homework_assignment_id
      and homework_assignments.coach_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.homework_assignments
    where homework_assignments.id = homework_resource_media.homework_assignment_id
      and homework_assignments.coach_id = auth.uid()
  ));

create policy "Students read resources for their published homework"
  on public.homework_resource_media for select to authenticated
  using (exists (
    select 1 from public.homework_assignments
    join public.students on students.id = homework_assignments.student_id
    where homework_assignments.id = homework_resource_media.homework_assignment_id
      and homework_assignments.is_published
      and students.auth_user_id = auth.uid()
  ));

insert into storage.buckets (id, name, public)
values ('homework-resources', 'homework-resources', false)
on conflict (id) do nothing;

create policy "Coaches upload homework resources"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'homework-resources' and exists (
    select 1 from public.homework_assignments
    where homework_assignments.id::text = (storage.foldername(name))[2]
      and homework_assignments.coach_id = auth.uid()
      and (storage.foldername(name))[1] = auth.uid()::text
  ));

create policy "Coaches read homework resources"
  on storage.objects for select to authenticated
  using (bucket_id = 'homework-resources' and exists (
    select 1 from public.homework_assignments
    where homework_assignments.id::text = (storage.foldername(name))[2]
      and homework_assignments.coach_id = auth.uid()
      and (storage.foldername(name))[1] = auth.uid()::text
  ));

create policy "Coaches delete homework resources"
  on storage.objects for delete to authenticated
  using (bucket_id = 'homework-resources' and exists (
    select 1 from public.homework_assignments
    where homework_assignments.id::text = (storage.foldername(name))[2]
      and homework_assignments.coach_id = auth.uid()
      and (storage.foldername(name))[1] = auth.uid()::text
  ));

create policy "Students read published homework resource objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'homework-resources' and exists (
    select 1 from public.homework_resource_media
    join public.homework_assignments on homework_assignments.id = homework_resource_media.homework_assignment_id
    join public.students on students.id = homework_assignments.student_id
    where homework_resource_media.storage_path = name
      and homework_assignments.is_published
      and students.auth_user_id = auth.uid()
  ));
