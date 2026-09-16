do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'growth_report_snapshots'
  loop
    execute format('drop policy if exists %I on public.growth_report_snapshots', existing_policy.policyname);
  end loop;
end;
$$;

create policy "Coaches manage growth reports for their roster"
  on public.growth_report_snapshots for all to authenticated
  using (coach_id = auth.uid())
  with check (
    coach_id = auth.uid()
    and exists (
      select 1
      from public.students
      where students.id = growth_report_snapshots.student_id
        and students.coach_id = auth.uid()
    )
    and (
      capability_snapshot_id is null
      or exists (
        select 1
        from public.capability_assessment_snapshots
        where capability_assessment_snapshots.id = growth_report_snapshots.capability_snapshot_id
          and capability_assessment_snapshots.coach_id = auth.uid()
          and capability_assessment_snapshots.student_id = growth_report_snapshots.student_id
      )
    )
  );

create policy "Students read their published growth reports"
  on public.growth_report_snapshots for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.students
      where students.id = growth_report_snapshots.student_id
        and students.auth_user_id = auth.uid()
    )
  );