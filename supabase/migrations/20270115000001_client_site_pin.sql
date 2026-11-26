-- Maps (owner, Nov 2026): the project's site as a pin on the client (set on a map, from the phone's
-- position, or read from a Google Maps link). Both or neither; same ranges as site_visits.
alter table public.clients
  add column latitude numeric(9, 6) check (latitude between -90 and 90),
  add column longitude numeric(9, 6) check (longitude between -180 and 180),
  add constraint clients_pin_pair check ((latitude is null) = (longitude is null));

comment on column public.clients.latitude is 'project site pin (with longitude); null = not set';

-- Backfill from links that already carry the coordinates (…!3d…!4d…, ?q=…, @…); short links are
-- resolved by the app when the client is next saved.
update public.clients c
   set latitude = p.lat, longitude = p.lng
  from (
    select id,
      coalesce(substring(location_url from '!3d(-?\d{1,2}\.\d+)!4d'), substring(location_url from '[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),'), substring(location_url from '@(-?\d{1,2}\.\d+),'))::numeric as lat,
      coalesce(substring(location_url from '!3d-?\d{1,2}\.\d+!4d(-?\d{1,3}\.\d+)'), substring(location_url from '[?&](?:q|query|ll|destination)=-?\d{1,2}\.\d+,\+?(-?\d{1,3}\.\d+)'), substring(location_url from '@-?\d{1,2}\.\d+,(-?\d{1,3}\.\d+)'))::numeric as lng
    from public.clients
    where latitude is null and location_url is not null
  ) p
 where c.id = p.id and p.lat between -90 and 90 and p.lng between -180 and 180;
