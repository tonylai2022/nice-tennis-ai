create table public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reminder_offset_minutes integer not null default 60 check (reminder_offset_minutes in (15, 30, 60, 120, 1440)),
  notifications_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

create table public.lesson_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reminder_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (lesson_id, user_id, reminder_at)
);

create index lesson_reminder_deliveries_lookup_idx on public.lesson_reminder_deliveries(lesson_id, user_id);

create or replace function public.set_notification_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute procedure public.set_notification_updated_at();

alter table public.user_notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.lesson_reminder_deliveries enable row level security;

create policy "Users manage their own notification preferences"
  on public.user_notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage their own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());