-- Fix: organizations uses column-level UPDATE grants; the signatory columns
-- (20261206000001) were never granted, so saving company settings failed.
grant update (signatory_name, signatory_title) on public.organizations to authenticated;
