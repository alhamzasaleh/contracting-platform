-- Owner (Nov 2026): «قفله» — a cancelled contract stays cancelled. It can't be taken back to draft,
-- sent or accepted by anyone (not even a direct database write): a new contract is made instead.
-- (Its quote link is already handed back to the quote by private.contract_cancelled_link.)
create or replace function private.guard_cancelled_contract()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'a cancelled contract stays cancelled — make a new contract' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists contracts_cancelled_final on public.contracts;
create trigger contracts_cancelled_final before update of status on public.contracts
  for each row execute function private.guard_cancelled_contract();
