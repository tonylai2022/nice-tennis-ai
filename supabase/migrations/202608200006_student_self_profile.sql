alter table public.students
  add column if not exists age_range text check (age_range in ('under_13', '13_to_17', '18_to_25', '26_to_44', '45_plus', 'prefer_not_to_say'));

create or replace function public.update_my_student_profile(
  next_age_range text,
  next_gender text,
  next_dominant_hand text,
  next_dominant_eye text,
  next_goals text,
  next_restrictions text
)
returns public.students
language plpgsql
security definer set search_path = public
as $$
declare
  student_row public.students;
begin
  if next_age_range is not null and next_age_range not in ('under_13', '13_to_17', '18_to_25', '26_to_44', '45_plus', 'prefer_not_to_say') then
    raise exception 'Invalid age range.';
  end if;
  if next_gender is not null and next_gender not in ('female', 'male', 'nonbinary', 'prefer_not_to_say') then
    raise exception 'Invalid gender.';
  end if;
  if next_dominant_hand is not null and next_dominant_hand not in ('left', 'right') then
    raise exception 'Invalid dominant hand.';
  end if;
  if next_dominant_eye is not null and next_dominant_eye not in ('left', 'right') then
    raise exception 'Invalid dominant eye.';
  end if;

  update public.students
  set age_range = next_age_range,
      gender = next_gender,
      dominant_hand = next_dominant_hand,
      dominant_eye = next_dominant_eye,
      goals = nullif(trim(next_goals), ''),
      restrictions = nullif(trim(next_restrictions), '')
  where auth_user_id = auth.uid()
    and student_archived_at is null
  returning * into student_row;

  if not found then
    raise exception 'Student profile is not available to update.';
  end if;
  return student_row;
end;
$$;

revoke all on function public.update_my_student_profile(text, text, text, text, text, text) from public;
grant execute on function public.update_my_student_profile(text, text, text, text, text, text) to authenticated;