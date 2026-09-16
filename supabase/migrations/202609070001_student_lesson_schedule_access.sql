-- Students may view only lessons scheduled for their own student profile.
-- Coaches retain the existing all-operation policy from the scheduling migration.
create policy "Students view their own lessons"
  on public.lessons for select to authenticated
  using (
    exists (
      select 1
      from public.students
      where students.id = lessons.student_id
        and students.auth_user_id = auth.uid()
    )
  );