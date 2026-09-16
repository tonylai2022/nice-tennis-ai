drop policy if exists "Coaches manage growth reports for their roster" on public.growth_report_snapshots;

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
  );