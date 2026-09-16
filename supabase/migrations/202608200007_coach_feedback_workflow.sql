alter table public.coach_records
  add column if not exists lesson_date date,
  add column if not exists skill text,
  add column if not exists focus_area text,
  add column if not exists evidence_links jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_records_evidence_links_array'
      and conrelid = 'public.coach_records'::regclass
  ) then
    alter table public.coach_records
      add constraint coach_records_evidence_links_array
      check (jsonb_typeof(evidence_links) = 'array');
  end if;
end;
$$;

create index if not exists coach_records_student_lesson_date_idx
  on public.coach_records (student_id, lesson_date desc nulls last);

drop policy if exists "Coaches can update their own records" on public.coach_records;
create policy "Coaches can update their own draft records"
  on public.coach_records for update to authenticated
  using (coach_id = auth.uid() and not is_published)
  with check (coach_id = auth.uid());
