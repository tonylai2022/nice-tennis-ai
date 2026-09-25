create table public.reference_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  description text not null default '',
  url text not null unique,
  uploaded_by text not null default 'User',
  uploaded_at timestamptz not null default now(),
  tags text[] not null default array['tennis']::text[],
  sport text not null default 'tennis' check (sport = 'tennis'),
  phase_timestamps jsonb not null default '{}'::jsonb
);

alter table public.reference_videos enable row level security;

create policy "Anyone can read tennis reference videos"
  on public.reference_videos for select
  using (sport = 'tennis');

create policy "Authenticated users manage tennis reference videos"
  on public.reference_videos for all to authenticated
  using (sport = 'tennis')
  with check (sport = 'tennis' and 'tennis' = any(tags));

insert into storage.buckets (id, name, public)
values
  ('videos', 'videos', true),
  ('trainingvideolib', 'trainingvideolib', true),
  ('reports', 'reports', true)
on conflict (id) do update set public = excluded.public;

create policy "Anyone can read tennis media"
  on storage.objects for select
  using (bucket_id in ('videos', 'trainingvideolib', 'reports'));

create policy "Authenticated users upload tennis media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reports'
    or (bucket_id in ('videos', 'trainingvideolib') and lower(name) like 'tennis[_]%')
  );

create policy "Authenticated users update tennis media"
  on storage.objects for update to authenticated
  using (bucket_id in ('videos', 'trainingvideolib', 'reports'))
  with check (
    bucket_id = 'reports'
    or (bucket_id in ('videos', 'trainingvideolib') and lower(name) like 'tennis[_]%')
  );

create policy "Authenticated users delete tennis media"
  on storage.objects for delete to authenticated
  using (bucket_id in ('videos', 'trainingvideolib', 'reports'));