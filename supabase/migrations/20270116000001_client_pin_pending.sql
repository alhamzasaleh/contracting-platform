-- Owner (Nov 2026): «حطيت رابط موقعه» — a short WhatsApp map link (maps.app.goo.gl) carries no
-- coordinates and can only be followed on the server. Until it is, the client is pin_pending and the
-- server reads it by itself (project / client pages, daily job). A link that can't be read is tried
-- MAX_PIN_TRIES times (oldest try first), then given up. Non-destructive.
alter table public.clients
  add column if not exists pin_pending boolean not null default false,
  add column if not exists pin_tries smallint not null default 0,
  add column if not exists pin_tried_at timestamptz;
comment on column public.clients.pin_pending is 'the map link still has to be read on the server to set the pin';
comment on column public.clients.pin_tries is 'failed server reads of the current map link';

create or replace function private.client_pin_pending()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- a new link starts its tries again
  if tg_op = 'UPDATE' and new.location_url is distinct from old.location_url then
    new.pin_tries := 0;
    new.pin_tried_at := null;
  end if;
  if new.latitude is not null or new.location_url is null or btrim(new.location_url) = '' then
    new.pin_pending := false;
  end if;
  return new;
end $$;

drop trigger if exists clients_pin_pending on public.clients;
create trigger clients_pin_pending before insert or update on public.clients
  for each row execute function private.client_pin_pending();

create index if not exists clients_pin_pending_idx on public.clients (organization_id, pin_tried_at nulls first) where pin_pending;

-- clients saved before the maps with a SHORT link (the earlier backfill read every link that carries
-- coordinates; a long link without a pin now was cleared on purpose — left alone)
update public.clients set pin_pending = true
 where latitude is null and location_url ~* '^https://(maps\.app\.goo\.gl/|goo\.gl/maps)';
