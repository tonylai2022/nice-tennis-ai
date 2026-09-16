-- Run while signed in as Coach A, then repeat while signed in as Coach B.
-- Each result set must contain only the current coach's students.
select id, coach_id, full_name, email, student_archived_at
from public.students
order by created_at desc;

-- Copy a student ID owned by the other coach into the placeholder below.
-- Expected result: zero rows. Do not use a service-role key for this check.
select id, coach_id, full_name
from public.students
where id = 'REPLACE_WITH_OTHER_COACHS_STUDENT_UUID'::uuid;

-- Attempting an update for another coach's student must update zero rows.
update public.students
set level = level
where id = 'REPLACE_WITH_OTHER_COACHS_STUDENT_UUID'::uuid
returning id;