create table public.coach_record_media (
  id uuid primary key default gen_random_uuid(),
  coach_record_id uuid not null references public.coach_records(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  original_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  pose_landmarks jsonb,
  annotations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index coach_record_media_record_id_idx on public.coach_record_media(coach_record_id);

alter table public.coach_record_media enable row level security;

create policy "Coaches manage media for their records"
  on public.coach_record_media for all to authenticated
  using (exists (select 1 from public.coach_records where coach_records.id = coach_record_media.coach_record_id and coach_records.coach_id = auth.uid()))
  with check (exists (select 1 from public.coach_records where coach_records.id = coach_record_media.coach_record_id and coach_records.coach_id = auth.uid()));

create policy "Students read media for published records"
  on public.coach_record_media for select to authenticated
  using (exists (
    select 1 from public.coach_records
    join public.students on students.id = coach_records.student_id
    where coach_records.id = coach_record_media.coach_record_id
      and coach_records.is_published
      and students.auth_user_id = auth.uid()
  ));

insert into storage.buckets (id, name, public)
values ('coach-record-media', 'coach-record-media', false)
on conflict (id) do nothing;

create policy "Coaches upload record media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'coach-record-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Coaches read their record media"
  on storage.objects for select to authenticated
  using (bucket_id = 'coach-record-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Coaches delete their record media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'coach-record-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Students read published record media objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'coach-record-media' and exists (
    select 1 from public.coach_record_media
    join public.coach_records on coach_records.id = coach_record_media.coach_record_id
    join public.students on students.id = coach_records.student_id
    where coach_record_media.storage_path = name
      and coach_records.is_published
      and students.auth_user_id = auth.uid()
  ));