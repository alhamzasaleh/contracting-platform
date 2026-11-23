-- §3.19 / §6.1: the owner's organization takes its brand from the approved
-- identity (ملمس / MALMAS): primary = clay #B5653E, accent = sand #D9CBB5.
-- New organizations default to the same until they set their own.
-- The previous value stays in the audit log; it can be changed again in Settings → Branding.
alter table public.organizations
  alter column brand set default '{"primary":"#B5653E","accent":"#D9CBB5","source":"default"}'::jsonb;

update public.organizations
set brand = '{"primary":"#B5653E","accent":"#D9CBB5","source":"manual"}'::jsonb;
