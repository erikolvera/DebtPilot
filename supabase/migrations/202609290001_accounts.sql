create table public.plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  last_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_version check (data @> '{"version": 1}' and data ?& array['profile', 'checkIns']
    and jsonb_typeof(data -> 'profile') = 'object' and jsonb_typeof(data -> 'checkIns') = 'object'),
  constraint plan_no_numeric_money check (not jsonb_path_exists(data - 'version', '$.** ? (@.type() == "number")')),
  constraint plan_size check (octet_length(data::text) <= 1048576)
);

alter table public.plans enable row level security;
create or replace function public.account_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users
    where id = auth.uid() and email_confirmed_at is not null);
$$;
revoke all on function public.account_verified() from public, anon;
grant execute on function public.account_verified() to authenticated;

create policy "owners read their plan" on public.plans for select to authenticated
  using (user_id = (select auth.uid()) and (select public.account_verified()));
create policy "owners create their plan" on public.plans for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.account_verified()));
create policy "owners update their plan" on public.plans for update to authenticated
  using (user_id = (select auth.uid()) and (select public.account_verified()))
  with check (user_id = (select auth.uid()) and (select public.account_verified()));

create or replace function public.save_plan(
  p_data jsonb,
  p_expected_revision bigint,
  p_mutation_id uuid
) returns public.plans
language plpgsql security definer set search_path = '' as $$
declare saved public.plans;
begin
  if auth.uid() is null or p_mutation_id is null or not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then
    raise exception 'Authentication or mutation ID required' using errcode = '28000';
  end if;
  if p_expected_revision is null then
    insert into public.plans(user_id, data, last_mutation_id)
    values (auth.uid(), p_data, p_mutation_id)
    on conflict (user_id) do nothing returning * into saved;
  else
    update public.plans set data = p_data,
      revision = revision + 1, last_mutation_id = p_mutation_id, updated_at = now()
    where user_id = auth.uid() and revision = p_expected_revision
    returning * into saved;
  end if;
  return saved;
end;
$$;

revoke all on function public.save_plan(jsonb, bigint, uuid) from public, anon;
grant execute on function public.save_plan(jsonb, bigint, uuid) to authenticated;
revoke insert, update, delete on public.plans from public, anon, authenticated;
grant select on public.plans to authenticated;
