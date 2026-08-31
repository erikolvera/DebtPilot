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



-- A table's owner is exempt from RLS regardless of FORCE, and a superuser
-- bypasses RLS entirely regardless of ownership. Supabase local's default
-- `postgres` role is not a superuser but has rolbypassrls = true, so if the
-- application connected as `postgres`, every policy above would be decorative. This role is what the
-- application actually connects as; it owns nothing and bypasses nothing.
-- Not idempotent across `supabase db reset` runs without this guard.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    -- NOLOGIN and no password on purpose. This file is what `supabase db push`
    -- applies to the hosted project, so a literal here would publish a
    -- credential for a role that can impersonate any user: connect, call
    -- set_config('request.jwt.claims', '{"sub":"<any uuid>"}', true), and the
    -- policies below hand over that user's rows. The `if not exists` guard
    -- would also freeze such a password forever. Login and password are
    -- granted out of band: scripts/bootstrap_local_db.sh for development and
    -- CI, the Supabase dashboard for production.
    create role app_user with nologin nosuperuser nobypassrls;
  end if;
end
$$;

grant usage on schema public to app_user;



grant select, insert, update, delete on public.debts to app_user;

-- app_user needs no access to schema auth at all.
--
-- The obvious `grant usage on schema auth to app_user` silently no-ops: the
-- schema is owned by supabase_admin and the `postgres` role running this
-- migration has no grant option on it, so Postgres emits
-- "WARNING: no privileges were granted" instead of failing. Membership in
-- Supabase's `authenticated` role does work, but over-grants badly: measured
-- on this stack, a member gains select and insert on a brand-new public table
-- with no RLS, because Supabase sets default privileges for that role. And
-- `set local role supabase_admin` is refused -- postgres is not a member.
--
-- So the policies below do not call auth.uid(). They call our own function,
-- which reads the very setting user_scoped_connection writes. This is not a
-- mirror of Supabase's function that could drift from it: it removes the
-- dependency rather than duplicating it, and PostgREST populates the same
-- setting, so a direct Supabase client sees identical behaviour.
create or replace function public.request_user_id() returns uuid
language sql
stable
as $$
  -- The inner nullif matters: once a transaction-local setting has been reset,
  -- current_setting returns an empty string rather than NULL, and ''::json is
  -- an error rather than NULL. Without it, an unidentified connection raises
  -- instead of quietly seeing nothing.
  select nullif(
           nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
           ''
         )::uuid
$$;

grant execute on function public.request_user_id() to app_user;

create policy debts_select on public.debts for select
  using (user_id = public.request_user_id());

create policy debts_insert on public.debts for insert
  with check (user_id = public.request_user_id());

-- USING decides which rows may be touched; WITH CHECK decides what they may
-- become. Without WITH CHECK, a user could update a row they own and reassign
-- its user_id to someone else.
create policy debts_update on public.debts for update
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());

create policy debts_delete on public.debts for delete
  using (user_id = public.request_user_id());

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger debts_set_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();
