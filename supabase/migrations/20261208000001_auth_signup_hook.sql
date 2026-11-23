-- §3.17: only known, invited or bootstrap phone numbers may sign up — enforced
-- inside Supabase Auth too, so the Auth API can't be used to bypass the app.
-- Enable once in Supabase: Authentication → Hooks → "Before User Created" →
-- Postgres function public.hook_before_user_created.
-- Email (or any non-phone) sign-ups are refused.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_phone(event -> 'user' ->> 'phone');
begin
  if v_phone is null or char_length(v_phone) < 8 then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Sign-up is by invited phone number only.'));
  end if;
  if not public.auth_phone_allowed(v_phone) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This phone number is not invited.'));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant usage on schema private to supabase_auth_admin;
  end if;
end $$;
grant execute on function public.hook_before_user_created(jsonb) to service_role;
