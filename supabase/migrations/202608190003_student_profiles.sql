alter table public.students
  add column if not exists date_of_birth date,
  add column if not exists gender text check (gender in ('female', 'male', 'nonbinary', 'prefer_not_to_say')),
  add column if not exists level text,
  add column if not exists dominant_hand text check (dominant_hand in ('left', 'right')),
  add column if not exists dominant_eye text check (dominant_eye in ('left', 'right')),
  add column if not exists racket_brand text,
  add column if not exists racket_model text,
  add column if not exists racket_string text,
  add column if not exists racket_head_size_sq_in numeric(5, 1) check (racket_head_size_sq_in is null or racket_head_size_sq_in > 0),
  add column if not exists racket_weight_g numeric(6, 1) check (racket_weight_g is null or racket_weight_g > 0),
  add column if not exists racket_string_tension_lbs numeric(5, 1) check (racket_string_tension_lbs is null or racket_string_tension_lbs > 0),
  add column if not exists shoes_used text,
  add column if not exists goals text,
  add column if not exists restrictions text,
  add column if not exists last_lesson_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists students_coach_last_lesson_idx
  on public.students (coach_id, last_lesson_at desc nulls last);

create or replace function public.set_student_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute procedure public.set_student_updated_at();
