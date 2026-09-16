-- Retain cancelled lessons in the coach's schedule instead of deleting their history.
alter table public.lessons
  drop constraint if exists lessons_status_check;

alter table public.lessons
  add constraint lessons_status_check
  check (status in ('scheduled', 'completed', 'cancelled'));

notify pgrst, 'reload schema';