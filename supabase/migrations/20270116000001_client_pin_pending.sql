-- Owner (Nov 2026): «حطيت رابط موقعه» — a short WhatsApp map link (maps.app.goo.gl) carries no
-- coordinates and can only be followed on the server. Until it is, the client is pin_pending and the
-- server reads it by itself (project / client pages, daily job). Non-destructive.
alter table public.clients add column if not exists pin_pending boolean not null default false;
comment on column public.clients.pin_pending is 'the map link still has to be read on the server to set the pin';

create or replace function private.client_pin_pending()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.latitude is not null or new.location_url is null or btrim(new.location_url) = '' then
    new.pin_pending := false;
  end if;
  return new;
end $$;

drop trigger if exists clients_pin_pending on public.clients;
create trigger clients_pin_pending before insert or update on public.clients
  for each row execute function private.client_pin_pending();

-- clients saved before the maps: their link wasn't read yet
update public.clients set pin_pending = true
 where latitude is null and location_url is not null and btrim(location_url) <> '';
