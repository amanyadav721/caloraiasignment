create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid not null default gen_random_uuid (),
  telegram_id text null,
  experiment_group text null,
  created_at timestamp without time zone null default now(),
  onboarding_step text null,
  onboarding_completed boolean null default false,
  constraint users_pkey primary key (id),
  constraint users_telegram_id_key unique (telegram_id)
) TABLESPACE pg_default;

alter table public.users
drop constraint if exists onboarding_step_check;

alter table public.users
add constraint onboarding_step_check check (
  onboarding_step = any (array['step_1'::text, 'step_2'::text, 'step_3'::text, 'completed'::text])
  or onboarding_step is null
);

alter table public.users enable row level security;

drop policy if exists "Public can read users" on public.users;
create policy "Public can read users"
on public.users
for select
to anon, authenticated
using (true);

create table if not exists public.events (
  id uuid not null default gen_random_uuid (),
  telegram_id text null,
  event_name text null,
  event_value text null,
  created_at timestamp without time zone null default now(),
  constraint events_pkey primary key (id)
) TABLESPACE pg_default;

alter table public.events enable row level security;

drop policy if exists "Public can read events" on public.events;
create policy "Public can read events"
on public.events
for select
to anon, authenticated
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'users'
  ) then
    alter publication supabase_realtime add table public.users;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end
$$;
