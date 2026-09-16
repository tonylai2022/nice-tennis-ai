-- Return the signed-in student's future private lessons and enrolled group classes.
-- SECURITY DEFINER keeps this read path independent from table-level RLS joins.
create or replace function public.load_my_schedule()
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  duration_minutes integer,
  location text,
  kind text
)
language sql
security definer
set search_path = public
stable
as $$
  select lessons.id, lessons.title, lessons.starts_at, lessons.duration_minutes, lessons.location, 'lesson'::text
  from public.lessons
  join public.students on students.id = lessons.student_id
  where students.auth_user_id = auth.uid()
    and lessons.status = 'scheduled'
    and lessons.starts_at >= now()

  union all

  select class_sessions.id, class_sessions.title, class_sessions.starts_at, class_sessions.duration_minutes, class_sessions.location, 'class'::text
  from public.class_sessions
  join public.class_session_students on class_session_students.class_session_id = class_sessions.id
  join public.students on students.id = class_session_students.student_id
  where students.auth_user_id = auth.uid()
    and class_sessions.starts_at >= now()

  order by starts_at asc;
$$;

revoke all on function public.load_my_schedule() from public;
grant execute on function public.load_my_schedule() to authenticated;