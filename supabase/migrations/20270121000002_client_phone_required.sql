-- The client's phone is required (owner, Nov 2026: «رقم جوال العميل ضروري») — WhatsApp messages,
-- the client page link and the contract's second party all use it.
-- Non-destructive: no column change. Signed-in users can't add a client without a phone or empty
-- one. The app's form always asks for it (every client had one when this shipped); an older row
-- without one isn't refused on other updates, so database functions touching other columns
-- (pins, links) keep working.

-- invoker: it checks who is writing (a definer would always run as the owner)
create or replace function private.client_phone_required()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.phone is null
     and (tg_op = 'INSERT' or old.phone is not null) then
    raise exception 'client phone required' using errcode = '23502';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_phone_required on public.clients;
create trigger clients_phone_required before insert or update of phone on public.clients
  for each row execute function private.client_phone_required();
