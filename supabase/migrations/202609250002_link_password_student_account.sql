create or replace function public.link_my_student_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  signed_in_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or signed_in_email = '' then
    raise exception 'A verified email is required to link a student account.';
  end if;

  update public.students
  set auth_user_id = auth.uid(),
      invitation_status = 'active',
      activated_at = coalesce(activated_at, now())
  where email = signed_in_email
    and student_archived_at is null
    and (auth_user_id is null or auth_user_id = auth.uid());
end;
$$;

revoke all on function public.link_my_student_account() from public;
grant execute on function public.link_my_student_account() to authenticated;