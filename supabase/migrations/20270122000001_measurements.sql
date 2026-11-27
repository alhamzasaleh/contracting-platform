-- Measurement sheets and quantity settlement (owner, Nov 2026).
-- At the end of each work type the supervisor records the actual m² («كشف القياس»); the client signs it
-- (or objects) on his page; the difference is priced at the contract's price per m² (same discount % and
-- VAT) and settled in the final payment: added as a «تسوية الأمتار» payment requested with the final
-- handover, or taken off the last payments still pending; what can't be taken off any more is owed to the
-- client (refund). Lump-sum contracts have no measurement. Nothing here rewrites an issued invoice.

-- 1) payments: a settlement row (kind measurement, 0 %) and the amount a measurement took off a payment
alter table public.contract_payments add column kind text not null default 'schedule' check (kind in ('schedule', 'measurement'));
alter table public.contract_payments add column measure_adjust numeric(14, 2) not null default 0;
alter table public.contract_payments drop constraint contract_payments_percent_check;
alter table public.contract_payments add constraint contract_payments_percent_check check (
  (kind = 'schedule' and percent > 0 and percent <= 100) or (kind = 'measurement' and percent = 0));

create or replace function private.guard_contract_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.paid_amount is not null or new.paid_at is not null or new.paid_method is not null
       or new.paid_reference is not null or new.requested_at is not null then
      raise exception 'payments are recorded through record_client_payment' using errcode = '42501';
    end if;
    if new.kind <> 'schedule' or new.measure_adjust <> 0 then
      raise exception 'settlement payments are made by the database' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.paid_amount is distinct from old.paid_amount or new.paid_at is distinct from old.paid_at
     or new.paid_method is distinct from old.paid_method or new.paid_reference is distinct from old.paid_reference
     or new.requested_at is distinct from old.requested_at then
    raise exception 'payments are recorded through record_client_payment' using errcode = '42501';
  end if;
  if new.kind is distinct from old.kind or new.measure_adjust is distinct from old.measure_adjust then
    raise exception 'settlement payments are made by the database' using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts c where c.id = old.contract_id and c.status = 'accepted') and (
     new.percent is distinct from old.percent or new.amount is distinct from old.amount or new.label is distinct from old.label
     or new.due_event is distinct from old.due_event or new.seq is distinct from old.seq or new.contract_id is distinct from old.contract_id) then
    raise exception 'the payment schedule of an accepted contract can''t change' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- a payment a measurement reduced to nothing is settled when its time comes (no invoice, no Qoyod, no receipt)
create or replace function private.zero_payment_paid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'requested' and old.status = 'pending' and new.amount <= 0 then
    new.status := 'paid';
    new.paid_amount := 0;
    new.paid_at := (now() at time zone 'Asia/Riyadh')::date;
  end if;
  return new;
end;
$$;
revoke all on function private.zero_payment_paid() from public;
create trigger contract_payments_zero_paid before update of status on public.contract_payments
  for each row execute function private.zero_payment_paid();

create or replace function private.qoyod_on_contract_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount <= 0 then
    return null;
  end if;
  if new.status in ('requested', 'paid') and (tg_op = 'INSERT' or old.status = 'pending') then
    perform private.qoyod_enqueue(new.organization_id, 'invoice', 'contract_payment', new.id, 'cp:' || new.id);
  end if;
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    perform private.qoyod_enqueue(new.organization_id, 'invoice', 'contract_payment', new.id, 'cp:' || new.id);
    perform private.qoyod_enqueue(new.organization_id, 'invoice_payment', 'contract_payment', new.id,
      'cp:' || new.id || ':' || new.paid_amount, new.paid_amount - coalesce(old.paid_amount, 0));
  end if;
  return null;
end;
$$;

-- 2) measurement sheets
create or replace function private.document_prefix(p_doc_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_doc_type
    when 'client' then 'CL'
    when 'request' then 'R'
    when 'survey' then 'SV'
    when 'quote' then 'Q'
    when 'contract' then 'C'
    when 'project' then 'P'
    when 'purchase' then 'PO'
    when 'invoice' then 'INV'
    when 'addendum' then 'AD'
    when 'maintenance' then 'MR'
    when 'receipt' then 'RV'
    when 'marketer' then 'MK'
    when 'payment_voucher' then 'PV'
    when 'measurement' then 'MS'
  end
$$;

create table public.contract_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  number text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'objected')),
  -- users send [{work_type, measured_area}]; the database fills agreed_area, price_per_m2, diff_area, diff_amount
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) < 20000),
  notes text check (char_length(notes) <= 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 12),
  -- money (filled by the database): difference before VAT after the contract's discount %, VAT, total
  diff_subtotal numeric(14, 2) not null default 0,
  diff_vat numeric(14, 2) not null default 0,
  diff_total numeric(14, 2) not null default 0,
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  client_decided_at timestamptz,
  client_name text,
  client_note text,
  client_ip text,
  client_user_agent text,
  client_signature text,
  -- how the difference was settled (database only)
  applied jsonb,
  credit_amount numeric(14, 2) not null default 0 check (credit_amount >= 0),
  refunded_at date,
  refunded_method text check (refunded_method in ('transfer', 'cash', 'cheque', 'card')),
  refunded_reference text check (char_length(refunded_reference) <= 80),
  refunded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index contract_measurements_contract_idx on public.contract_measurements (contract_id);

create trigger contract_measurements_number before insert on public.contract_measurements
  for each row execute function private.assign_document_number('measurement');
create trigger contract_measurements_lock_number before update on public.contract_measurements
  for each row execute function private.lock_number();
create trigger contract_measurements_created_by before insert on public.contract_measurements
  for each row execute function private.set_created_by();
create trigger contract_measurements_updated_at before update on public.contract_measurements
  for each row execute function private.set_updated_at();

-- the contract's agreed work types: [{workType, area, pricePerM2}], discount %, VAT %, method
create or replace function private.contract_measure_basis(p_contract uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'method', coalesce(qv.client_view ->> 'method', 'unit'),
    'work_types', coalesce(qv.client_view -> 'workTypes', '[]'::jsonb),
    'discount_percent', coalesce((qv.client_view ->> 'discountPercent')::numeric,
      case when coalesce((qv.client_view ->> 'subtotal')::numeric, 0) > 0
           then coalesce((qv.client_view ->> 'discount')::numeric, 0) / (qv.client_view ->> 'subtotal')::numeric * 100 else 0 end),
    'vat_percent', coalesce((qv.client_view ->> 'vatPercent')::numeric, qv.vat_percent, 0))
  from public.contracts c
  join public.quote_versions qv on qv.quote_id = c.quote_id and qv.version = c.quote_version
  where c.id = p_contract
$$;
revoke all on function private.contract_measure_basis(uuid) from public;

-- users can't write what the database fills or what the client answered (invoker: current_user is the caller)
create or replace function private.guard_measurement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    if new.contract_id is distinct from old.contract_id or new.organization_id is distinct from old.organization_id then
      raise exception 'a measurement stays on its contract' using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.sent_at is distinct from old.sent_at or new.sent_by is distinct from old.sent_by
       or new.client_decided_at is distinct from old.client_decided_at or new.client_name is distinct from old.client_name
       or new.client_note is distinct from old.client_note or new.client_ip is distinct from old.client_ip
       or new.client_user_agent is distinct from old.client_user_agent or new.client_signature is distinct from old.client_signature
       or new.applied is distinct from old.applied or new.credit_amount is distinct from old.credit_amount
       or new.refunded_at is distinct from old.refunded_at or new.refunded_method is distinct from old.refunded_method
       or new.refunded_reference is distinct from old.refunded_reference or new.refunded_by is distinct from old.refunded_by then
      raise exception 'measurements are sent and answered through their functions' using errcode = '42501';
    end if;
    if old.status not in ('draft', 'objected') then
      raise exception 'a sent measurement can''t change' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and current_user in ('authenticated', 'anon') then
    if new.status <> 'draft' or new.sent_at is not null or new.client_decided_at is not null or new.applied is not null
       or new.credit_amount <> 0 or new.refunded_at is not null or new.client_name is not null or new.client_signature is not null then
      raise exception 'a measurement starts as a draft' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_measurement() from public;
create trigger contract_measurements_guard before insert or update on public.contract_measurements
  for each row execute function private.guard_measurement();

-- users write only work types + measured m² (+ notes, photos) while draft/objected; the rest is computed here
create or replace function private.measurement_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  b jsonb;
  l jsonb;
  w jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_type text;
  v_measured numeric;
  v_agreed numeric;
  v_price numeric;
  v_sum numeric := 0;
  v_disc numeric;
  v_vat numeric;
begin
  -- nothing to recompute once sent (only the database moves it on)
  if tg_op = 'UPDATE' and old.status not in ('draft', 'objected') then
    return new;
  end if;

  -- lock the contract: two sheets saved at once can't both take the same work type
  select * into c from public.contracts where id = new.contract_id for update;
  if c.id is null or c.organization_id <> new.organization_id then
    raise exception 'invalid contract' using errcode = '22023';
  end if;
  if c.status <> 'accepted' then
    raise exception 'the contract isn''t accepted' using errcode = '22023';
  end if;
  b := private.contract_measure_basis(c.id);
  if b is null or b ->> 'method' = 'lump' then
    raise exception 'lump sum contract' using errcode = '22023';
  end if;
  if jsonb_array_length(new.lines) > 20 then
    raise exception 'invalid measurement' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    v_type := l ->> 'work_type';
    begin
      v_measured := (l ->> 'measured_area')::numeric;
    exception when others then
      raise exception 'invalid measurement' using errcode = '22023';
    end;
    if v_type is null or v_measured is null or v_measured < 0 or v_measured > 1000000 or v_type = any (v_seen) then
      raise exception 'invalid measurement' using errcode = '22023';
    end if;
    select x into w from jsonb_array_elements(b -> 'work_types') x where x ->> 'workType' = v_type limit 1;
    if w is null then
      raise exception 'work type not in the contract' using errcode = '22023';
    end if;
    if exists (select 1 from public.contract_measurements m, jsonb_array_elements(m.lines) ml
               where m.contract_id = new.contract_id and m.id <> new.id and ml ->> 'work_type' = v_type) then
      raise exception 'work type already measured' using errcode = '23505';
    end if;
    v_seen := v_seen || v_type;
    v_measured := round(v_measured, 2);
    v_agreed := round(coalesce((w ->> 'area')::numeric, 0), 2);
    v_price := coalesce((w ->> 'pricePerM2')::numeric, 0);
    v_lines := v_lines || jsonb_build_object('work_type', v_type, 'measured_area', v_measured, 'agreed_area', v_agreed,
      'price_per_m2', v_price, 'diff_area', v_measured - v_agreed, 'diff_amount', round((v_measured - v_agreed) * v_price, 2));
    v_sum := v_sum + round((v_measured - v_agreed) * v_price, 2);
  end loop;
  v_disc := least(100, greatest(0, coalesce((b ->> 'discount_percent')::numeric, 0)));
  v_vat := greatest(0, coalesce((b ->> 'vat_percent')::numeric, 0));
  new.lines := v_lines;
  new.diff_subtotal := round(v_sum * (1 - v_disc / 100), 2);
  new.diff_vat := round(new.diff_subtotal * v_vat / 100, 2);
  new.diff_total := new.diff_subtotal + new.diff_vat;
  if exists (select 1 from unnest(new.photos) p where p !~ ('^' || new.organization_id || '/' || new.contract_id || '/measure/[0-9a-f-]{36}\.jpg$')) then
    raise exception 'invalid photo' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.measurement_fill() from public;
create trigger contract_measurements_fill before insert or update on public.contract_measurements
  for each row execute function private.measurement_fill();

-- only drafts and objected sheets can be deleted (a sent or approved sheet is the record)
create or replace function private.guard_measurement_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and old.status not in ('draft', 'objected') then
    raise exception 'a sent measurement can''t be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_measurement_delete() from public;
create trigger contract_measurements_delete before delete on public.contract_measurements
  for each row execute function private.guard_measurement_delete();

select private.enable_audit('public.contract_measurements');

alter table public.contract_measurements enable row level security;
create policy contract_measurements_select on public.contract_measurements for select to authenticated
  using ((select private.has_permission(organization_id, 'projects.view')) or (select private.has_permission(organization_id, 'quotes.view'))
         or (select private.has_permission(organization_id, 'finance.view')));
create policy contract_measurements_insert on public.contract_measurements for insert to authenticated
  with check ((select private.has_permission(organization_id, 'projects.manage')));
create policy contract_measurements_update on public.contract_measurements for update to authenticated
  using ((select private.has_permission(organization_id, 'projects.manage')))
  with check ((select private.has_permission(organization_id, 'projects.manage')));
create policy contract_measurements_delete on public.contract_measurements for delete to authenticated
  using ((select private.has_permission(organization_id, 'projects.manage')));
create policy contract_measurements_project_scope on public.contract_measurements as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, contract_id))
  with check (private.can_access_contract(organization_id, contract_id));
revoke all on public.contract_measurements from anon, authenticated;
grant select, insert, update, delete on public.contract_measurements to authenticated;
grant all on public.contract_measurements to service_role;

-- 3) staff send the sheet to the client
create or replace function public.send_measurement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.contract_measurements;
begin
  select * into m from public.contract_measurements where id = p_id for update;
  if m.id is null or not private.has_permission(m.organization_id, 'projects.manage')
     or not private.can_access_contract(m.organization_id, m.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.status not in ('draft', 'objected') then
    raise exception 'already sent' using errcode = '22023';
  end if;
  if jsonb_array_length(m.lines) = 0 then
    raise exception 'empty measurement' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contracts c where c.id = m.contract_id and c.status = 'accepted') then
    raise exception 'the contract isn''t accepted' using errcode = '22023';
  end if;
  update public.contract_measurements
  set status = 'sent', sent_at = now(), sent_by = auth.uid(),
      client_decided_at = null, client_name = null, client_note = null, client_ip = null, client_user_agent = null, client_signature = null
  where id = m.id;
end;
$$;
revoke all on function public.send_measurement(uuid) from public, anon;
grant execute on function public.send_measurement(uuid) to authenticated;

-- 4) settle an approved difference (see the header)
create or replace function private.apply_measurement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.contract_measurements;
  r record;
  v_left numeric;
  v_take numeric;
  v_applied jsonb := '[]'::jsonb;
  v_row public.contract_payments;
  v_handed boolean;
  v_seq int;
begin
  select * into m from public.contract_measurements where id = p_id for update;
  -- one settlement at a time per contract
  perform 1 from public.contracts where id = m.contract_id for update;
  v_left := m.diff_total;
  if v_left > 0 then
    -- a) what the company still owed the client from an earlier measurement
    for r in select id, credit_amount from public.contract_measurements
             where contract_id = m.contract_id and id <> m.id and status = 'approved' and credit_amount > 0 and refunded_at is null
             order by client_decided_at for update loop
      exit when v_left <= 0;
      v_take := least(v_left, r.credit_amount);
      update public.contract_measurements set credit_amount = credit_amount - v_take where id = r.id;
      v_applied := v_applied || jsonb_build_object('kind', 'credit_used', 'measurement', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- b) give back what earlier measurements took off payments still pending
    for r in select id, measure_adjust from public.contract_payments
             where contract_id = m.contract_id and kind = 'schedule' and status = 'pending' and measure_adjust < 0
             order by seq for update loop
      exit when v_left <= 0;
      v_take := least(v_left, -r.measure_adjust);
      update public.contract_payments set amount = amount + v_take, measure_adjust = measure_adjust + v_take where id = r.id;
      v_applied := v_applied || jsonb_build_object('kind', 'restored', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- c) the rest is a settlement payment, requested with the final handover (or now, if already handed over)
    if v_left > 0 then
      select * into v_row from public.contract_payments
      where contract_id = m.contract_id and kind = 'measurement' and status = 'pending' order by seq desc limit 1 for update;
      if v_row.id is not null then
        update public.contract_payments set amount = amount + v_left where id = v_row.id;
      else
        select coalesce(max(seq), 0) + 1 into v_seq from public.contract_payments where contract_id = m.contract_id;
        insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event, kind)
        values (m.organization_id, m.contract_id, v_seq, 'تسوية الأمتار', 0, v_left, 'handover', 'measurement')
        returning * into v_row;
        select exists (select 1 from public.project_stages s where s.contract_id = m.contract_id and s.is_final and s.status = 'confirmed')
        into v_handed;
        if v_handed then
          update public.contract_payments set status = 'requested' where id = v_row.id;
        end if;
      end if;
      v_applied := v_applied || jsonb_build_object('kind', 'settlement', 'payment', v_row.id, 'amount', v_left);
    end if;
  elsif v_left < 0 then
    v_left := -v_left;
    -- a) a settlement payment still pending
    for r in select id, amount from public.contract_payments
             where contract_id = m.contract_id and kind = 'measurement' and status = 'pending'
             order by seq desc for update loop
      exit when v_left <= 0;
      v_take := least(v_left, r.amount);
      if v_take >= r.amount then
        delete from public.contract_payments where id = r.id;
      else
        update public.contract_payments set amount = amount - v_take where id = r.id;
      end if;
      v_applied := v_applied || jsonb_build_object('kind', 'settlement_reduced', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- b) the last payments still pending (the final payment first)
    for r in select id, amount from public.contract_payments
             where contract_id = m.contract_id and kind = 'schedule' and status = 'pending' and amount > 0
             order by seq desc for update loop
      exit when v_left <= 0;
      v_take := least(v_left, r.amount);
      update public.contract_payments set amount = amount - v_take, measure_adjust = measure_adjust - v_take where id = r.id;
      v_applied := v_applied || jsonb_build_object('kind', 'reduced', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- c) already billed: the company owes the client the rest
    if v_left > 0 then
      v_applied := v_applied || jsonb_build_object('kind', 'credit', 'amount', v_left);
    end if;
  end if;
  update public.contract_measurements set applied = v_applied, credit_amount = greatest(v_left, 0) * (case when m.diff_total < 0 then 1 else 0 end)
  where id = m.id;
end;
$$;
revoke all on function private.apply_measurement(uuid) from public;

-- 5) the client answers on his page (service role, after per-IP rate limiting)
create or replace function public.portal_answer_measurement(p_number text, p_token text, p_measurement uuid, p_approve boolean,
                                                            p_name text, p_note text, p_signature text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  m public.contract_measurements;
  v_number text;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return false;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null or v_link.contract_id is null then
    return false;
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  select * into m from public.contract_measurements where id = p_measurement and contract_id = v_link.contract_id for update;
  if m.id is null or m.status <> 'sent' then
    return false;
  end if;
  if not exists (select 1 from public.contracts c where c.id = m.contract_id and c.status = 'accepted') then
    return false;
  end if;
  if p_approve then
    if p_signature is null or char_length(p_signature) > 200000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then
      raise exception 'invalid signature' using errcode = '22023';
    end if;
  elsif p_note is null or char_length(trim(p_note)) < 3 or char_length(p_note) > 2000 then
    raise exception 'invalid note' using errcode = '22023';
  end if;
  update public.contract_measurements
  set status = case when p_approve then 'approved' else 'objected' end,
      client_decided_at = now(), client_name = trim(p_name),
      client_note = case when p_approve then nullif(trim(coalesce(p_note, '')), '') else trim(p_note) end,
      client_ip = left(p_ip, 64), client_user_agent = left(p_user_agent, 400),
      client_signature = case when p_approve then p_signature end
  where id = m.id;
  if p_approve then
    perform private.apply_measurement(m.id);
  end if;
  select number into v_number from public.contracts where id = m.contract_id;
  perform private.notify(m.organization_id, 'projects.manage',
    case when p_approve then 'measurement_approved' else 'measurement_objected' end,
    jsonb_build_object('number', v_number, 'measurement', m.number, 'amount', m.diff_total),
    '/projects/' || v_number || '?m=' || m.number, 'measurement:' || m.id || ':' || case when p_approve then 'ok' else 'no:' || extract(epoch from now())::bigint end,
    m.contract_id);
  return true;
end;
$$;
revoke all on function public.portal_answer_measurement(text, text, uuid, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_answer_measurement(text, text, uuid, boolean, text, text, text, text, text) to service_role;

-- 6) money the company owes the client back (recorded by finance)
create or replace function public.record_measurement_refund(p_id uuid, p_paid_on date, p_method text, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.contract_measurements;
begin
  select * into m from public.contract_measurements where id = p_id for update;
  if m.id is null or not private.has_permission(m.organization_id, 'finance.manage')
     or not private.can_access_contract(m.organization_id, m.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.status <> 'approved' or m.credit_amount <= 0 or m.refunded_at is not null then
    raise exception 'nothing to refund' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Riyadh')::date or p_method is null
     or p_method not in ('transfer', 'cash', 'cheque', 'card') or char_length(p_reference) > 80 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  update public.contract_measurements
  set refunded_at = p_paid_on, refunded_method = p_method, refunded_reference = nullif(trim(p_reference), ''), refunded_by = auth.uid()
  where id = m.id;
end;
$$;
revoke all on function public.record_measurement_refund(uuid, date, text, text) from public, anon;
grant execute on function public.record_measurement_refund(uuid, date, text, text) to authenticated;

-- 7) the final handover waits for the client's answer to a sheet he was sent
create or replace function public.portal_confirm_stage(p_number text, p_token text, p_stage uuid, p_name text, p_signature text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  s public.project_stages;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return false;
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_signature is not null and (char_length(p_signature) > 200000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$') then
    raise exception 'invalid signature' using errcode = '22023';
  end if;
  select * into s from public.project_stages where id = p_stage and contract_id = v_link.contract_id for update;
  if s.id is null or s.status <> 'awaiting_client' then
    return false;
  end if;
  if s.is_final and p_signature is null then
    raise exception 'the final handover needs a signature' using errcode = '22023';
  end if;
  if s.is_final and exists (select 1 from public.contract_measurements m where m.contract_id = s.contract_id and m.status = 'sent') then
    raise exception 'measurement pending' using errcode = '22023';
  end if;
  update public.project_stages
  set status = 'confirmed', progress = 100, confirmed_at = now(), confirmed_name = trim(p_name),
      confirmed_ip = left(p_ip, 64), confirmed_user_agent = left(p_user_agent, 400), confirmed_signature = p_signature
  where id = s.id;
  -- §3.7: a stage done → its payment is requested
  if s.payment_event is not null then
    update public.contract_payments set status = 'requested'
    where contract_id = v_link.contract_id and due_event = s.payment_event and status = 'pending';
  end if;
  return true;
end;
$$;

-- 8) the client page shows the sheets that were sent to him
create or replace function public.portal_measurements(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null or v_link.contract_id is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'number', m.number, 'status', m.status, 'lines', m.lines, 'notes', m.notes, 'photos', to_jsonb(m.photos),
      'diff_subtotal', m.diff_subtotal, 'diff_vat', m.diff_vat, 'diff_total', m.diff_total, 'sent_at', m.sent_at,
      'client_decided_at', m.client_decided_at, 'client_name', m.client_name, 'client_note', m.client_note,
      'credit_amount', m.credit_amount, 'refunded_at', m.refunded_at) order by m.sent_at)
    from public.contract_measurements m
    where m.contract_id = v_link.contract_id and m.status in ('sent', 'approved', 'objected')), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_measurements(text, text) from public, anon, authenticated;
grant execute on function public.portal_measurements(text, text) to service_role;

-- 9) notifications
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late',
  'doc_expiry', 'approval_reminder', 'maintenance_request', 'project_delay', 'project_over_budget', 'project_losing', 'missed_visit',
  'agreement_review', 'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due',
  'measurement_approved', 'measurement_objected'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late',
  'doc_expiry', 'approval_reminder', 'maintenance_request', 'project_delay', 'project_over_budget', 'project_losing', 'missed_visit',
  'agreement_review', 'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due',
  'measurement_approved', 'measurement_objected'));

-- 10) what can be measured on a project (staff with projects.view + project access): the contract's
-- method, agreed work types (area, price per m²), discount % and VAT % — the measurement dialog previews
-- the difference with the same rule the database applies (private.measurement_fill)
create or replace function public.measurement_basis(p_contract uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.contracts;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null or not private.has_permission(c.organization_id, 'projects.view')
     or not private.can_access_contract(c.organization_id, c.id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.contract_measure_basis(c.id);
end;
$$;
revoke all on function public.measurement_basis(uuid) from public, anon;
grant execute on function public.measurement_basis(uuid) to authenticated;

-- 11) the client page's payments say which one is the quantity settlement and what a measurement took off
create or replace function public.portal_view(p_number text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link public.client_portal_links;
  v_out jsonb;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  update public.client_portal_links set last_opened_at = now(), open_count = open_count + 1 where id = v_link.id;

  if v_link.contract_id is null
     or (v_link.quote_id is not null and exists (select 1 from public.contracts c where c.id = v_link.contract_id and c.status = 'draft')) then
    return private.portal_quote_payload(v_link);
  end if;

  select jsonb_build_object(
    'stage', 'contract',
    'org', jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number,
                              'phone', o.phone, 'city', o.city, 'address', o.address, 'logo_path', o.logo_path, 'brand', o.brand,
                              'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title),
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', cl.id_number,
                                 'site_own', c.site_own, 'site_city', c.site_city, 'site_district', c.site_district),
    'contract', jsonb_build_object('number', c.number, 'status', c.status, 'service', c.service, 'project_type', c.project_type,
                                   'start_date', c.start_date, 'duration_days', c.duration_days, 'warranty_months', c.warranty_months,
                                   'total', c.total, 'notes', c.notes, 'accepted_at', c.accepted_at, 'accepted_name', c.accepted_name, 'created_at', c.created_at),
    'quote', jsonb_build_object('number', q.number, 'version', v.version, 'date', v.created_at, 'valid_until', q.valid_until,
                                'client_view', v.client_view, 'notes', v.notes,
                                'client_accepted_at', case when q.client_decision = 'accepted' then q.client_decided_at end),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('seq', p.seq, 'label', p.label, 'percent', p.percent, 'amount', p.amount,
                                                              'due_event', p.due_event, 'status', p.status, 'kind', p.kind, 'adjust', p.measure_adjust) order by p.seq)
                          from public.contract_payments p where p.contract_id = c.id), '[]'::jsonb),
    'expires_at', v_link.expires_at
  ) into v_out
  from public.contracts c
  join public.organizations o on o.id = c.organization_id
  join public.clients cl on cl.id = c.client_id
  join public.quotes q on q.id = c.quote_id
  join public.quote_versions v on v.quote_id = q.id and v.version = c.quote_version
  where c.id = v_link.contract_id;
  return v_out;
end;
$function$;
