create table public.debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  type            text not null default 'credit_card',
  balance         numeric(10,2) not null check (balance >= 0),
  apr             numeric(5,2)  not null check (apr >= 0),
  minimum_payment numeric(10,2) not null check (minimum_payment >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index debts_user_id_idx on public.debts (user_id);

-- ENABLE turns policies on; FORCE makes them apply to the table's owner too.
-- Without FORCE, a backend connecting on Supabase's default credentials is the
-- owner and is exempt from every policy below: no error, no warning, and the
-- queries work perfectly while protecting nothing.
alter table public.debts enable row level security;
alter table public.debts force  row level security;

create policy debts_select on public.debts for select
  using (user_id = auth.uid());

create policy debts_insert on public.debts for insert
  with check (user_id = auth.uid());

-- USING decides which rows may be touched; WITH CHECK decides what they may
-- become. Without WITH CHECK, a user could update a row they own and reassign
-- its user_id to someone else.
create policy debts_update on public.debts for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy debts_delete on public.debts for delete
  using (user_id = auth.uid());

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger debts_set_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();

-- A table's owner is exempt from RLS regardless of FORCE, and a superuser
-- bypasses RLS entirely regardless of ownership. Supabase local's default
-- `postgres` role is a superuser, so if the application connected as
-- `postgres`, every policy above would be decorative. This role is what the
-- application actually connects as; it owns nothing and bypasses nothing.
-- Not idempotent across `supabase db reset` runs without this guard.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user with login password 'app_user' nosuperuser nobypassrls;
  end if;
end
$$;

grant usage on schema public, auth to app_user;
grant select, insert, update, delete on public.debts to app_user;
