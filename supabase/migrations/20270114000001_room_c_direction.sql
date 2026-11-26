-- Ceiling framing (owner, Nov 2026): per room, the direction of the main C channels.
-- null = automatic (the engine picks the cheaper way); the owner can force it per room.
alter table public.survey_rooms
  add column c_along text check (c_along in ('length', 'width'));
comment on column public.survey_rooms.c_along is 'C channels run along the room length or width; null = cheaper way (automatic)';
