-- Run while signed in as Student A, then repeat as Student B.
-- Do not use a service-role key for these checks.

-- Expected: every returned record is published and belongs to the signed-in student.
select coach_records.id, coach_records.student_id, coach_records.title, coach_records.is_published
from public.coach_records
order by coach_records.published_at desc nulls last;

-- Copy an unpublished record ID owned by the current student here.
-- Expected: zero rows.
select id, title, is_published
from public.coach_records
where id = 'REPLACE_WITH_CURRENT_STUDENTS_PRIVATE_RECORD_UUID'::uuid;

-- Copy a published record ID assigned to the other student here.
-- Expected: zero rows.
select id, student_id, title, is_published
from public.coach_records
where id = 'REPLACE_WITH_OTHER_STUDENTS_PUBLISHED_RECORD_UUID'::uuid;

-- Copy media IDs for the same private and other-student records here.
-- Expected: zero rows for each query.
select id, coach_record_id, original_name
from public.coach_record_media
where coach_record_id in (
  'REPLACE_WITH_CURRENT_STUDENTS_PRIVATE_RECORD_UUID'::uuid,
  'REPLACE_WITH_OTHER_STUDENTS_PUBLISHED_RECORD_UUID'::uuid
);