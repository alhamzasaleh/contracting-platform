-- Maps (owner, Nov 2026): the project's site as a pin on the client (set on a map, from the phone's
-- position, or read from a Google Maps link). Both or neither; same ranges as site_visits.
alter table public.clients
  add column latitude numeric(9, 6) check (latitude between -90 and 90),
  add column longitude numeric(9, 6) check (longitude between -180 and 180),
  add constraint clients_pin_pair check ((latitude is null) = (longitude is null));

comment on column public.clients.latitude is 'project site pin (with longitude); null = not set';

-- Backfill from links that already carry the coordinates (…!3d…!4d…, ?q=…, @…); short links are
-- resolved by the app when the client is next saved.
-- each pair comes from one pattern (the place pin first, then ?q=…, a dropped pin path, @…); 0,0 refused
update public.clients c
   set latitude = p.pair[1]::numeric, longitude = p.pair[2]::numeric
  from (
    select id, coalesce(
      regexp_match(u, '!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)'),
      regexp_match(u, '[?&](?:q|query|ll|destination|daddr)=(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)'),
      regexp_match(u, '/maps/(?:search|place|dir)/(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)'),
      regexp_match(u, '@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)')
    ) as pair
    from (select id, replace(replace(location_url, '%2C', ','), '%2c', ',') as u from public.clients where latitude is null and location_url is not null) x
  ) p
 where c.id = p.id and p.pair is not null
   and p.pair[1]::numeric between -90 and 90 and p.pair[2]::numeric between -180 and 180
   and not (p.pair[1]::numeric = 0 and p.pair[2]::numeric = 0);
