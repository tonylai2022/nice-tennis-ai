create or replace function public.update_lesson_package_record(
  p_package_id uuid,
  p_session_count integer,
  p_session_duration_minutes integer,
  p_price numeric
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  package_record public.lesson_packages;
  updated_student public.students;
  used_credits integer;
begin
  select * into package_record from public.lesson_packages where id = p_package_id and coach_id = auth.uid() for update;
  if not found then raise exception 'Package not found'; end if;
  select count(*) into used_credits from public.lessons where package_id = p_package_id;
  if p_session_count < used_credits or p_session_count > 100 or p_session_duration_minutes < 15 or p_session_duration_minutes > 480 or p_price < 0 then
    raise exception 'Package details cannot be less than credits already used';
  end if;
  update public.lesson_packages set session_count = p_session_count, remaining_credits = p_session_count - used_credits, session_duration_minutes = p_session_duration_minutes, price = p_price where id = p_package_id;
  update public.students set remaining_credits = remaining_credits + (p_session_count - package_record.session_count) where id = package_record.student_id returning * into updated_student;
  return updated_student;
end;
$$;

create or replace function public.delete_lesson_payment_record(p_lesson_id uuid)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  lesson_record public.lessons;
  updated_student public.students;
begin
  select * into lesson_record from public.lessons where id = p_lesson_id and coach_id = auth.uid() for update;
  if not found then raise exception 'Lesson not found'; end if;
  if lesson_record.payment_type = 'package' then
    update public.lesson_packages set remaining_credits = remaining_credits + 1 where id = lesson_record.package_id;
    update public.students set remaining_credits = remaining_credits + 1 where id = lesson_record.student_id returning * into updated_student;
  else
    select * into updated_student from public.students where id = lesson_record.student_id;
  end if;
  delete from public.lessons where id = p_lesson_id;
  return updated_student;
end;
$$;

create or replace function public.delete_lesson_package_record(p_package_id uuid)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  package_record public.lesson_packages;
  updated_student public.students;
begin
  select * into package_record from public.lesson_packages where id = p_package_id and coach_id = auth.uid() for update;
  if not found then raise exception 'Package not found'; end if;
  if exists (select 1 from public.lessons where package_id = p_package_id) then
    raise exception 'A package with linked lessons cannot be deleted. Delete or reassign those lesson records first.';
  end if;
  update public.students set remaining_credits = greatest(0, remaining_credits - package_record.remaining_credits) where id = package_record.student_id returning * into updated_student;
  delete from public.lesson_packages where id = p_package_id;
  return updated_student;
end;
$$;

grant execute on function public.update_lesson_package_record(uuid, integer, integer, numeric) to authenticated;
grant execute on function public.delete_lesson_payment_record(uuid) to authenticated;
grant execute on function public.delete_lesson_package_record(uuid) to authenticated;

notify pgrst, 'reload schema';