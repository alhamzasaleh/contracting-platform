-- Exterior paint from the elevations (owner, Nov 2026): the façades the owner reviewed (parts by
-- finish, openings, included or not) are kept on the survey, so the façade area stays traceable
-- (Appendix A.0) and the review can be reopened. Written with clients.manage like the survey itself.
-- Non-destructive.
alter table public.surveys add column if not exists facades jsonb
  check (facades is null or (jsonb_typeof(facades) = 'array' and pg_column_size(facades) < 262144));
comment on column public.surveys.facades is 'reviewed façades read from the elevations (src/lib/survey/facade.ts Facade[]); totals.facade = their paint area';
