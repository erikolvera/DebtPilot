-- Pin every privilege on plans explicitly instead of inheriting project defaults.
-- Defaults differ between projects (local CLI vs hosted with "auto-expose" off),
-- and they granted TRUNCATE to anon and authenticated, which RLS does not cover.
revoke all on table public.plans from public, anon, authenticated, service_role;
-- Owners read through RLS; the service role reads only to verify deletions.
grant select on table public.plans to authenticated, service_role;

-- Writes and verification checks run only for signed-in users.
revoke all on function public.account_verified() from public, anon, service_role;
grant execute on function public.account_verified() to authenticated;
revoke all on function public.save_plan(jsonb, bigint, uuid) from public, anon, service_role;
grant execute on function public.save_plan(jsonb, bigint, uuid) to authenticated;
