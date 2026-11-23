-- =============================================================================
-- Sign-in codes by WhatsApp (§3.17): the "Send SMS" Auth hook calls the app,
-- which verifies Supabase's signature with a shared secret. The secret is kept
-- in the private schema (never in the repo or the browser) and read only by the
-- server (service role). It is written once when the hook is switched on.
-- =============================================================================
create table private.app_secrets (
  name text primary key check (name ~ '^[a-z_]{3,40}$'),
  value text not null check (char_length(value) between 20 and 500),
  updated_at timestamptz not null default now()
);
revoke all on private.app_secrets from public;

create or replace function public.auth_hook_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from private.app_secrets where name = p_name
$$;
revoke all on function public.auth_hook_secret(text) from public, anon, authenticated;
grant execute on function public.auth_hook_secret(text) to service_role;
