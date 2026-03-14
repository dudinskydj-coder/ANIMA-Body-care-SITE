-- ANIMA pricing admin setup for Supabase
-- 1. Open Supabase SQL editor
-- 2. Run this script
-- 3. In Authentication, create the admin user manually:
--    owner@anima.local / Anima_26!Laser#Admin74

create table if not exists public.pricing_configs (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.pricing_configs enable row level security;

create or replace function public.set_pricing_configs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_pricing_configs_updated_at on public.pricing_configs;

create trigger set_pricing_configs_updated_at
before update on public.pricing_configs
for each row
execute function public.set_pricing_configs_updated_at();

drop policy if exists "public read pricing configs" on public.pricing_configs;
drop policy if exists "authenticated insert pricing configs" on public.pricing_configs;
drop policy if exists "authenticated update pricing configs" on public.pricing_configs;

create policy "public read pricing configs"
on public.pricing_configs
for select
using (true);

create policy "authenticated insert pricing configs"
on public.pricing_configs
for insert
to authenticated
with check (auth.uid() is not null);

create policy "authenticated update pricing configs"
on public.pricing_configs
for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

insert into public.pricing_configs (key, data)
values ('laser_pricing_v1', '{}'::jsonb)
on conflict (key) do nothing;
