-- A contract's payment schedule may never total more than 100 %.
-- (The app requires exactly 100 % to save; the database guarantees the upper bound
-- even if the API is called directly. Non-destructive: adds a trigger only.)
create or replace function private.check_payment_percent_sum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total numeric;
begin
  select coalesce(sum(percent), 0) into total
  from public.contract_payments
  where contract_id = new.contract_id;
  if total > 100.001 then
    raise exception 'payment percentages exceed 100%% (%)', total using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function private.check_payment_percent_sum() from public;

create trigger contract_payments_percent_cap
  after insert or update of percent, contract_id on public.contract_payments
  for each row execute function private.check_payment_percent_sum();
