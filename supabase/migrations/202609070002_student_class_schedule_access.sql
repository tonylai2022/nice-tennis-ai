-- This helper bypasses table RLS only for the enrollment check, avoiding a
-- circular policy dependency between class_sessions and class_session_students.
create or replace function public.is_enrolled_in_class_session(p_class_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.class_session_students
    join public.students on students.id = class_session_students.student_id
    where class_session_students.class_session_id = p_class_session_id
      and students.auth_user_id = auth.uid()
  );
$$;

-- Students may see only group classes where they are enrolled.
create policy "Students view their enrolled class sessions"
  on public.class_sessions for select to authenticated
  using (public.is_enrolled_in_class_session(id));

create policy "Students view their own class attendance"
  on public.class_session_students for select to authenticated
  using (
    exists (
      select 1
      from public.students
      where students.id = class_session_students.student_id
        and students.auth_user_id = auth.uid()
    )
  );