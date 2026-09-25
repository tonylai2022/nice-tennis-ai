create table if not exists public.calibration_sync (
  sync_key text primary key check (char_length(trim(sync_key)) between 1 and 128),
  bundle_json text not null check (char_length(bundle_json) > 0),
  updated_at timestamptz not null default now()
);

alter table public.calibration_sync enable row level security;

drop policy if exists "Authenticated users can read calibration sync bundles" on public.calibration_sync;
create policy "Authenticated users can read calibration sync bundles"
  on public.calibration_sync for select to authenticated
  using (true);

drop policy if exists "Authenticated users can create calibration sync bundles" on public.calibration_sync;
create policy "Authenticated users can create calibration sync bundles"
  on public.calibration_sync for insert to authenticated
  with check (true);

drop policy if exists "Authenticated users can update calibration sync bundles" on public.calibration_sync;
create policy "Authenticated users can update calibration sync bundles"
  on public.calibration_sync for update to authenticated
  using (true) with check (true);

drop policy if exists "Authenticated users can delete calibration sync bundles" on public.calibration_sync;
create policy "Authenticated users can delete calibration sync bundles"
  on public.calibration_sync for delete to authenticated
  using (true);