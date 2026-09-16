create table public.student_record_media (
  id uuid primary key default gen_random_uuid(),
  student_record_id uuid not null references public.student_records(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  original_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 26214400),
  created_at timestamptz not null default now()
);

create index student_record_media_record_idx on public.student_record_media (student_record_id);

alter table public.student_record_media enable row level security;

create policy "Students manage media for their own practice logs"
  on public.student_record_media for all to authenticated
  using (exists (
    select 1 from public.student_records
    join public.students on students.id = student_records.student_id
    where student_records.id = student_record_media.student_record_id
      and students.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.student_records
    join public.students on students.id = student_records.student_id
    where student_records.id = student_record_media.student_record_id
      and students.auth_user_id = auth.uid()
  ));

create policy "Coaches read practice-log media for their roster"
  on public.student_record_media for select to authenticated
  using (exists (
    select 1 from public.student_records
    join public.students on students.id = student_records.student_id
    where student_records.id = student_record_media.student_record_id
      and students.coach_id = auth.uid()
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-record-media', 'student-record-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Students upload their own practice-log media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'student-record-media' and exists (
    select 1 from public.student_records
    join public.students on students.id = student_records.student_id
    where student_records.id::text = (storage.foldername(name))[2]
      and students.auth_user_id = auth.uid()
  ));

create policy "Students read their own practice-log media objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'student-record-media' and exists (
    select 1 from public.student_record_media
    join public.student_records on student_records.id = student_record_media.student_record_id
    join public.students on students.id = student_records.student_id
    where student_record_media.storage_path = name and students.auth_user_id = auth.uid()
  ));

create policy "Coaches read practice-log media objects for their roster"
  on storage.objects for select to authenticated
  using (bucket_id = 'student-record-media' and exists (
    select 1 from public.student_record_media
    join public.student_records on student_records.id = student_record_media.student_record_id
    join public.students on students.id = student_records.student_id
    where student_record_media.storage_path = name and students.coach_id = auth.uid()
  ));