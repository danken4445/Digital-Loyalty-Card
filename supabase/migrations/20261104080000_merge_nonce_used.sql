-- Migration: 20261104080000_merge_nonce_used.sql
-- Description: Single-use merge nonce lookup, so the Phase 12 app never reads audit_log with the service
--              role. Purely additive (a new function), so it is applied BEFORE the Phase 12 app deploys,
--              ahead of the destructive contract migration (20261105000000).

create or replace function public.merge_nonce_used(
  p_nonce text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.audit_log as a
    where a.action = 'customer_merge_token_used'
      and a.target = p_nonce
  );
$$;

revoke all on function public.merge_nonce_used(text) from public, anon, authenticated;
grant execute on function public.merge_nonce_used(text) to service_role;
