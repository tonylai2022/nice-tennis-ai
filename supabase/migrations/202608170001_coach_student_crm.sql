create extension if not exists pgcrypto;

create type public.crm_role as enum ('coach', 'student');
create type public.invitation_status as enum ('pending', 'active', 'disabled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.crm_role not null,
  full_name text not null check (char_length(trim(full_name)) > 0),
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) > 0),
  email text not null unique check (email = lower(email)),
  invitation_status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create table public.coach_records (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  body text not null check (char_length(trim(body)) > 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.student_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index students_coach_id_idx on public.students(coach_id);
create index coach_records_student_id_idx on public.coach_records(student_id, created_at desc);
create index student_records_student_id_idx on public.student_records(student_id, created_at desc);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::public.crm_role, 'student'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.coach_records enable row level security;
alter table public.student_records enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated using (id = auth.uid());

create policy "Coaches can read their roster"
  on public.students for select to authenticated
  using (coach_id = auth.uid());

create policy "Students can read their own record"
  on public.students for select to authenticated
  using (auth_user_id = auth.uid());

create policy "Coaches can update their roster"
  on public.students for update to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());

create policy "Coaches can read their student records"
  on public.coach_records for select to authenticated
  using (coach_id = auth.uid());

create policy "Students can read published coach records"
  on public.coach_records for select to authenticated
  using (is_published and exists (
    select 1 from public.students where students.id = coach_records.student_id and students.auth_user_id = auth.uid()
  ));

create policy "Coaches can create records for their roster"
  on public.coach_records for insert to authenticated
  with check (coach_id = auth.uid() and exists (
    select 1 from public.students where students.id = coach_records.student_id and students.coach_id = auth.uid()
  ));

create policy "Coaches can update their own records"
  on public.coach_records for update to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());

create policy "Coaches can delete their own records"
  on public.coach_records for delete to authenticated using (coach_id = auth.uid());

create policy "Coaches can read student reflections"
  on public.student_records for select to authenticated
  using (exists (
    select 1 from public.students where students.id = student_records.student_id and students.coach_id = auth.uid()
  ));

create policy "Students can read their own reflections"
  on public.student_records for select to authenticated
  using (exists (
    select 1 from public.students where students.id = student_records.student_id and students.auth_user_id = auth.uid()
  ));

create policy "Students can create their own reflections"
  on public.student_records for insert to authenticated
  with check (exists (
    select 1 from public.students where students.id = student_records.student_id and students.auth_user_id = auth.uid()
  ));

create or replace function public.activate_my_student_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.students
  set invitation_status = 'active', activated_at = coalesce(activated_at, now())
  where auth_user_id = auth.uid() and invitation_status = 'pending';
end;
$$;

revoke all on function public.activate_my_student_account() from public;
grant execute on function public.activate_my_student_account() to authenticated;

create or replace function public.complete_google_crm_sign_in(requested_role public.crm_role)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  signed_in_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  profile_row public.profiles;
  matched_student_id uuid;
begin
  if auth.uid() is null or signed_in_email = '' then
    raise exception 'A verified Google email is required.';
  end if;

  if requested_role = 'coach' then
    if exists (select 1 from public.students where auth_user_id = auth.uid()) then
      raise exception 'This Google account is registered as a student.';
    end if;
    update public.profiles set role = 'coach' where id = auth.uid()
    returning * into profile_row;
  else
    update public.students
    set auth_user_id = auth.uid(), invitation_status = 'active', activated_at = coalesce(activated_at, now())
    where email = signed_in_email
      and (auth_user_id is null or auth_user_id = auth.uid())
    returning id into matched_student_id;

    if not found then
      raise exception 'Your Google email has not been registered by a coach.';
    end if;
    update public.profiles set role = 'student' where id = auth.uid()
    returning * into profile_row;
  end if;

  return profile_row;
end;
$$;

revoke all on function public.complete_google_crm_sign_in(public.crm_role) from public;
grant execute on function public.complete_google_crm_sign_in(public.crm_role) to authenticated;