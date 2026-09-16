alter table public.coach_records
  add column if not exists updated_at timestamptz not null default now();

update public.coach_records
set updated_at = created_at
where updated_at > created_at;

create or replace function public.set_coach_record_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coach_records_set_updated_at on public.coach_records;
create trigger coach_records_set_updated_at
  before update on public.coach_records
  for each row execute procedure public.set_coach_record_updated_at();

drop policy if exists "Coaches can update their own draft records" on public.coach_records;
create policy "Coaches can update their own records"
  on public.coach_records for update to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());