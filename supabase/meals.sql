create extension if not exists pgcrypto;

create table if not exists public.meals (
  id uuid not null default gen_random_uuid (),
  user_id text null,
  meal_text text null,
  created_at timestamp without time zone null default now(),
  calories integer null,
  breakdown jsonb null,
  constraint meals_pkey primary key (id)
) TABLESPACE pg_default;

alter table public.meals enable row level security;

drop policy if exists "Public can read meals" on public.meals;
create policy "Public can read meals"
on public.meals
for select
to anon, authenticated
using (true);

drop policy if exists "Public can insert meals" on public.meals;
create policy "Public can insert meals"
on public.meals
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public can update meals" on public.meals;
create policy "Public can update meals"
on public.meals
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public can delete meals" on public.meals;
create policy "Public can delete meals"
on public.meals
for delete
to anon, authenticated
using (true);

alter table public.meals replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meals'
  ) then
    alter publication supabase_realtime add table public.meals;
  end if;
end
$$;

insert into public.meals (
  id,
  user_id,
  meal_text,
  created_at,
  calories,
  breakdown
)
values (
  'a5498fc5-fa0f-41de-b767-36953d7186df',
  '2134910518',
  'one banana',
  '2026-03-20 09:03:03.329057',
  105,
  '[{"name":"Banana","quantity":"1 medium","calories":105}]'::jsonb
)
on conflict (id) do nothing;
