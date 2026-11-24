import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Review batch 3 (Nov 2026): #18 client payment upper bound · #19 atomic schedule edit ·
 * #20 subcontractor work caps · #21 push device on a shared iPad · #22 progress stage of the same
 * contract · #23 staff may close a maintenance request (owner decision).
 */
let owner: string, sup: string, fin: string, viewer: string, restricted: string, other: string;
let org: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
type Made = { id: string; number: string; token: string; payments: string[] };

async function makeContract(total: number, accept = true, percents = [100]): Promise<Made> {
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',$3,$3)", [org, quote, total]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,$4,'sent') returning id, number", [org, quote, client, total])).rows[0];
    const payments: string[] = [];
    for (const [i, p] of percents.entries()) {
      const due = i === 0 ? "signing" : "custom";
      payments.push((await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, c.id, i + 1, `دفعة ${i + 1}`, p, Math.round(total * p) / 100, due])).rows[0].id);
    }
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '60 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, token, payments };
  });
  if (accept) await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500003001");
  sup = await createUser("966500003002");
  fin = await createUser("966500003003");
  viewer = await createUser("966500003004");
  restricted = await createUser("966500003005");
  other = await createUser("966500003006");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance'),($1,$4,'viewer'),($1,$5,'supervisor'),($1,$6,'viewer')", [org, sup, fin, viewer, restricted, other]);
    await q("update public.memberships set project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'عميل','966511112222') returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("#18 record_client_payment upper bound", () => {
  it("refuses more than the payment's amount (cumulative), allows exactly the rest", async () => {
    const c = await makeContract(10000);
    const pay = c.payments[0];
    await as({ userId: fin }, (q) => q("select public.record_client_payment($1, current_date, 6000, 'transfer', null)", [pay]));
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_client_payment($1, current_date, 4000.01, 'cash', null)", [pay])), /more than the amount due/);
    const r = await as({ userId: fin }, (q) => q<{ s: string }>("select public.record_client_payment($1, current_date, 4000, 'cash', null) as s", [pay]));
    expect(r.rows[0].s).toBe("paid");
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_client_payment($1, current_date, 1, 'cash', null)", [pay])), /already paid|more than the amount due/);
    const p = await asAdmin((q) => q<{ paid_amount: string }>("select paid_amount from public.contract_payments where id = $1", [pay]));
    expect(Number(p.rows[0].paid_amount)).toBe(10000);
  });
});

describe("#19 save_contract_schedule (one step)", () => {
  const sched = (rows: { label: string; percent: number; due_event: string }[]) => JSON.stringify(rows);

  it("rewrites dates and the schedule together; the last payment absorbs rounding", async () => {
    const c = await makeContract(1000, false, [50, 50]);
    await as({ userId: sup }, (q) => q("select public.save_contract_schedule($1, current_date + 3, 20, 12, 'ملاحظة', $2::jsonb)", [c.id, sched([
      { label: "توقيع", percent: 33.33, due_event: "signing" }, { label: "توريد", percent: 33.33, due_event: "material_supply" }, { label: "تسليم", percent: 33.34, due_event: "handover" },
    ])]));
    const p = await asAdmin((q) => q<{ seq: number; amount: string; status: string }>("select seq, amount, status from public.contract_payments where contract_id = $1 order by seq", [c.id]));
    expect(p.rows.map((x) => [x.seq, Number(x.amount), x.status])).toEqual([[1, 333.3, "pending"], [2, 333.3, "pending"], [3, 333.4, "pending"]]);
    const k = await asAdmin((q) => q<{ d: number; w: number; notes: string; later: boolean }>("select duration_days as d, warranty_months as w, notes, start_date = current_date + 3 as later from public.contracts where id = $1", [c.id]));
    expect(k.rows[0]).toEqual({ d: 20, w: 12, notes: "ملاحظة", later: true });
  });

  it("an invalid schedule changes nothing (the old schedule and dates stay)", async () => {
    const c = await makeContract(1000, false, [40, 60]);
    for (const bad of [
      sched([{ label: "أ", percent: 60, due_event: "signing" }, { label: "ب", percent: 60, due_event: "handover" }]), // 120 %
      sched([{ label: "أ", percent: 50, due_event: "signing" }, { label: "ب", percent: 49.98, due_event: "handover" }]), // 99.98 %
      sched([{ label: "أ", percent: 100, due_event: "whenever" }]),
      sched([{ label: " ", percent: 100, due_event: "signing" }]),
      sched([]),
      '{"label":"x"}',
    ]) {
      await expectDenied(as({ userId: sup }, (q) => q("select public.save_contract_schedule($1, current_date + 9, 30, 6, null, $2::jsonb)", [c.id, bad])), /invalid payment schedule/);
    }
    const p = await asAdmin((q) => q<{ percent: string }>("select percent from public.contract_payments where contract_id = $1 order by seq", [c.id]));
    expect(p.rows.map((x) => Number(x.percent))).toEqual([40, 60]);
    const k = await asAdmin((q) => q<{ d: number }>("select duration_days as d from public.contracts where id = $1", [c.id]));
    expect(k.rows[0].d).toBe(10);
  });

  it("only quotes.manage with project access, and only draft/sent contracts", async () => {
    const c = await makeContract(1000, false);
    const ok = sched([{ label: "كامل", percent: 100, due_event: "signing" }]);
    await expectDenied(as({ userId: viewer }, (q) => q("select public.save_contract_schedule($1, current_date, 10, 6, null, $2::jsonb)", [c.id, ok])), /not allowed/);
    await expectDenied(as({ userId: restricted }, (q) => q("select public.save_contract_schedule($1, current_date, 10, 6, null, $2::jsonb)", [c.id, ok])), /not allowed/);
    const accepted = await makeContract(1000, true);
    await expectDenied(as({ userId: owner }, (q) => q("select public.save_contract_schedule($1, current_date, 10, 6, null, $2::jsonb)", [accepted.id, ok])), /accepted|locked/);
  });
});

describe("#20 subcontractor work caps", () => {
  let contract: string, sub: string;
  beforeAll(async () => {
    contract = (await makeContract(5000)).id;
    sub = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.subcontractors (organization_id, name) values ($1,'مقاول الاختبار') returning id", [org])).rows[0].id);
  });
  const agreement = (basis: "lump" | "per_m2", qty: number | null) =>
    as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, auto_progress) values ($1,$2,$3,'تركيب',$4,$5,$6,'weekly',false) returning id", [org, sub, contract, basis, basis === "lump" ? 10000 : 20, qty])).rows[0].id);
  const work = (g: string, col: "percent" | "quantity_m2", v: number) =>
    as({ userId: owner }, (q) => q(`insert into public.subcontractor_work (organization_id, agreement_id, ${col}, amount) values ($1,$2,$3,0)`, [org, g, v]));

  it("lump sum: the shares of the job never total more than 100 %", async () => {
    const g = await agreement("lump", null);
    await work(g, "percent", 60);
    await work(g, "percent", 40);
    await expectDenied(work(g, "percent", 1), /more than the agreement/);
    // editing an entry counts the others, not itself
    const first = (await asAdmin((q) => q<{ id: string }>("select id from public.subcontractor_work where agreement_id = $1 and percent = 60", [g]))).rows[0].id;
    await expectDenied(as({ userId: owner }, (q) => q("update public.subcontractor_work set percent = 61 where id = $1", [first])), /more than the agreement/);
    await as({ userId: owner }, (q) => q("update public.subcontractor_work set percent = 55 where id = $1", [first]));
  });

  it("per m²: executed area never totals more than the agreed area (small rounding tolerance)", async () => {
    const g = await agreement("per_m2", 100);
    await work(g, "quantity_m2", 70);
    await work(g, "quantity_m2", 30.01); // within 0.01 m²
    await expectDenied(work(g, "quantity_m2", 0.5), /more than the agreement/);
  });

  it("no work on a closed agreement", async () => {
    const g = await agreement("per_m2", 100);
    await as({ userId: owner }, (q) => q("update public.subcontractor_agreements set status = 'closed' where id = $1", [g]));
    await expectDenied(work(g, "quantity_m2", 5), /closed/);
  });

  it("the automatic progress sync still records up to the agreement and stops there", async () => {
    const g = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule) values ($1,$2,$3,'دهان',$4,20,80,'progress') returning id", [org, sub, contract, "per_m2"])).rows[0].id);
    await work(g, "quantity_m2", 50); // manual entry first
    await asAdmin((q) => q("update public.project_stages set progress = 100, status = 'confirmed' where contract_id = $1", [contract]));
    const done = await asAdmin((q) => q<{ q: string; n: number }>("select sum(quantity_m2) as q, count(*) filter (where auto)::int as n from public.subcontractor_work where agreement_id = $1", [g]));
    expect(Number(done.rows[0].q)).toBe(80);
    expect(done.rows[0].n).toBe(1);
  });
});

describe("#21 push device on a shared iPad", () => {
  const endpoint = "https://web.push.apple.com/QOS-" + "a".repeat(40);
  const keys = ["B" + "x".repeat(86), "y".repeat(22)];

  it("claiming an endpoint moves this device to the caller (never to someone else)", async () => {
    await as({ userId: sup }, (q) => q("select public.claim_push_subscription($1,$2,$3,$4,'iPad')", [org, endpoint, ...keys]));
    // a different user signs in on the same iPad and turns notifications on
    await as({ userId: viewer }, (q) => q("select public.claim_push_subscription($1,$2,$3,$4,'iPad')", [org, endpoint, ...keys]));
    const rows = await asAdmin((q) => q<{ user_id: string; failures: number }>("select user_id, failures from public.push_subscriptions where endpoint = $1", [endpoint]));
    expect(rows.rows).toEqual([{ user_id: viewer, failures: 0 }]);
    // re-subscribing (new keys) by the same user keeps one row
    await as({ userId: viewer }, (q) => q("select public.claim_push_subscription($1,$2,$3,$4,'iPad')", [org, endpoint, "C" + "z".repeat(86), keys[1]]));
    expect((await asAdmin((q) => q("select 1 from public.push_subscriptions where endpoint = $1", [endpoint]))).rowCount).toBe(1);
  });

  it("refuses non-members, bad endpoints and anonymous callers", async () => {
    const outsider = await createUser("966500003099");
    await expectDenied(as({ userId: outsider }, (q) => q("select public.claim_push_subscription($1,$2,$3,$4,null)", [org, endpoint, ...keys])), /not allowed/);
    await expectDenied(as({ userId: sup }, (q) => q("select public.claim_push_subscription($1,'https://evil.example/x',$2,$3,null)", [org, ...keys])), /check|invalid/);
    await expectDenied(as("anon", (q) => q("select public.claim_push_subscription($1,$2,$3,$4,null)", [org, endpoint, ...keys])));
    const rows = await asAdmin((q) => q<{ user_id: string }>("select user_id from public.push_subscriptions where endpoint = $1", [endpoint]));
    expect(rows.rows[0].user_id).toBe(viewer);
  });

  it("a user can delete only his own device row (what sign-out does)", async () => {
    await as({ userId: sup }, (q) => q("delete from public.push_subscriptions where endpoint = $1", [endpoint]));
    expect((await asAdmin((q) => q("select 1 from public.push_subscriptions where endpoint = $1", [endpoint]))).rowCount).toBe(1);
    await as({ userId: viewer }, (q) => q("delete from public.push_subscriptions where endpoint = $1", [endpoint]));
    expect((await asAdmin((q) => q("select 1 from public.push_subscriptions where endpoint = $1", [endpoint]))).rowCount).toBe(0);
  });
});

describe("#22 progress updates use a stage of the same contract", () => {
  it("a stage of another contract is refused (progress and client notes)", async () => {
    const a = await makeContract(1000);
    const b = await makeContract(1000);
    const stageB = (await asAdmin((q) => q<{ id: string }>("select id from public.project_stages where contract_id = $1 order by seq limit 1", [b.id]))).rows[0].id;
    const stageA = (await asAdmin((q) => q<{ id: string }>("select id from public.project_stages where contract_id = $1 order by seq limit 1", [a.id]))).rows[0].id;
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.progress_updates (organization_id, contract_id, stage_id, progress) values ($1,$2,$3,40)", [org, a.id, stageB])), /stage/);
    await expectDenied(as("service_role", (q) => q("insert into public.client_notes (organization_id, contract_id, stage_id, body) values ($1,$2,$3,'ملاحظة')", [org, a.id, stageB])), /stage/);
    await as({ userId: owner }, (q) => q("insert into public.progress_updates (organization_id, contract_id, stage_id, progress) values ($1,$2,$3,40)", [org, a.id, stageA]));
  });
});

describe("#23 maintenance closed by staff or the client", () => {
  let c: Made;
  const open = async () => {
    const r = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.maintenance_requests (organization_id, contract_id, body) values ($1,$2,'تشقق') returning id", [org, c.id]));
    return r.rows[0].id;
  };
  beforeAll(async () => {
    c = await makeContract(1000);
    await asAdmin((q) => q("update public.project_stages set status = 'confirmed', confirmed_at = now() where contract_id = $1", [c.id]));
  });

  it("staff closing stamps closed_by and closed_at; the client page shows who closed it", async () => {
    const id = await open();
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'closed' where id = $1", [id]));
    const r = await asAdmin((q) => q<{ closed_by: string; closed_at: string | null; client_confirmed_at: string | null }>("select closed_by, closed_at, client_confirmed_at from public.maintenance_requests where id = $1", [id]));
    expect(r.rows[0].closed_by).toBe(sup);
    expect(r.rows[0].closed_at).not.toBeNull();
    expect(r.rows[0].client_confirmed_at).toBeNull();
    const w = await as("service_role", (q) => q<{ w: { requests: { id: string; status: string; closed_at: string | null; closed_by_staff: boolean }[] } }>("select public.portal_warranty($1,$2) as w", [c.number, c.token]));
    const mine = w.rows[0].w.requests.find((x) => x.id === id)!;
    expect(mine).toMatchObject({ status: "closed", closed_by_staff: true });
    expect(mine.closed_at).not.toBeNull();
    const audit = await asAdmin((q) => q("select 1 from public.audit_log where table_name = 'maintenance_requests' and record_id = $1 and action = 'update'", [id]));
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it("staff can't fake closed_by / closed_at; reopening clears them", async () => {
    const id = await open();
    await expectDenied(as({ userId: sup }, (q) => q("update public.maintenance_requests set closed_by = $2 where id = $1", [id, owner])), /permission denied/);
    await expectDenied(as({ userId: sup }, (q) => q("update public.maintenance_requests set closed_at = '2020-01-01' where id = $1", [id])), /permission denied/);
    let r = await asAdmin((q) => q<{ closed_by: string | null; closed_at: string | null }>("select closed_by, closed_at from public.maintenance_requests where id = $1", [id]));
    expect(r.rows[0]).toEqual({ closed_by: null, closed_at: null });
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'closed' where id = $1", [id]));
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'in_progress' where id = $1", [id]));
    r = await asAdmin((q) => q("select closed_by, closed_at from public.maintenance_requests where id = $1", [id]));
    expect(r.rows[0]).toEqual({ closed_by: null, closed_at: null });
  });

  it("client confirms → staff reopen → staff close: credited to staff, not the client", async () => {
    const id = await open();
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'resolved' where id = $1", [id]));
    await as("service_role", (q) => q("select public.portal_confirm_maintenance($1,$2,$3)", [c.number, c.token, id]));
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'in_progress' where id = $1", [id]));
    let r = await asAdmin((q) => q<{ client_confirmed_at: string | null; closed_by: string | null }>("select client_confirmed_at, closed_by from public.maintenance_requests where id = $1", [id]));
    expect(r.rows[0]).toEqual({ client_confirmed_at: null, closed_by: null });
    await as({ userId: owner }, (q) => q("update public.maintenance_requests set status = 'closed' where id = $1", [id]));
    r = await asAdmin((q) => q("select client_confirmed_at, closed_by from public.maintenance_requests where id = $1", [id]));
    expect(r.rows[0]).toEqual({ client_confirmed_at: null, closed_by: owner });
    const w = await as("service_role", (q) => q<{ w: { requests: { id: string; closed_by_staff: boolean; client_confirmed_at: string | null }[] } }>("select public.portal_warranty($1,$2) as w", [c.number, c.token]));
    expect(w.rows[0].w.requests.find((x) => x.id === id)).toMatchObject({ closed_by_staff: true, client_confirmed_at: null });
  });

  it("client confirms → staff move it to resolved → staff close: the old confirmation no longer counts", async () => {
    const id = await open();
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'resolved' where id = $1", [id]));
    await as("service_role", (q) => q("select public.portal_confirm_maintenance($1,$2,$3)", [c.number, c.token, id]));
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'resolved' where id = $1", [id]));
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'closed' where id = $1", [id]));
    const r = await asAdmin((q) => q<{ client_confirmed_at: string | null; closed_by: string | null }>("select client_confirmed_at, closed_by from public.maintenance_requests where id = $1", [id]));
    expect(r.rows[0]).toEqual({ client_confirmed_at: null, closed_by: sup });
  });

  it("rejected by staff reads as closed by staff on the client page", async () => {
    const id = await open();
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'rejected', reply = 'غير مشمول' where id = $1", [id]));
    const w = await as("service_role", (q) => q<{ w: { requests: { id: string; status: string; closed_by_staff: boolean }[] } }>("select public.portal_warranty($1,$2) as w", [c.number, c.token]));
    expect(w.rows[0].w.requests.find((x) => x.id === id)).toMatchObject({ status: "rejected", closed_by_staff: true });
  });

  it("the client closing a resolved request leaves closed_by empty (closed by the client)", async () => {
    const id = await open();
    await as({ userId: sup }, (q) => q("update public.maintenance_requests set status = 'resolved' where id = $1", [id]));
    await as("service_role", (q) => q("select public.portal_confirm_maintenance($1,$2,$3)", [c.number, c.token, id]));
    const w = await as("service_role", (q) => q<{ w: { requests: { id: string; status: string; closed_by_staff: boolean; client_confirmed_at: string | null }[] } }>("select public.portal_warranty($1,$2) as w", [c.number, c.token]));
    const mine = w.rows[0].w.requests.find((x) => x.id === id)!;
    expect(mine).toMatchObject({ status: "closed", closed_by_staff: false });
    expect(mine.client_confirmed_at).not.toBeNull();
  });
});

describe("review: a new contract and its schedule are one step", () => {
  const sched = (rows: { label: string; percent: number; due_event: string }[]) => JSON.stringify(rows);
  const full = sched([{ label: "توقيع", percent: 30, due_event: "signing" }, { label: "تسليم", percent: 70, due_event: "handover" }]);
  async function issuedQuote(total: number) {
    return as({ userId: owner }, async (q) => {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{\"options\":{\"projectType\":\"labour\"}}','{}','{}',$3,$3)", [org, quote, total]);
      await q("select public.issue_quote($1, null)", [quote]);
      return quote;
    });
  }
  const contractsOf = (quote: string) => asAdmin((q) => q<{ id: string }>("select id from public.contracts where quote_id = $1", [quote]));

  it("creates the contract from the issued quote (total, project type, clause template) with its payments", async () => {
    await as({ userId: owner }, (q) => q("insert into public.contract_templates (organization_id, terms) values ($1, '{\"custom\":[]}') on conflict (organization_id) do update set terms = excluded.terms", [org]));
    const quote = await issuedQuote(2000);
    const r = await as({ userId: sup }, (q) => q<{ c: { id: string; number: string } }>("select public.create_contract($1, current_date + 2, 15, 6, 'ن', $2::jsonb) as c", [quote, full]));
    const { id, number } = r.rows[0].c;
    expect(number).toMatch(/^C-\d{4}-\d{3}$/);
    const c = await asAdmin((q) => q<{ total: string; project_type: string; terms: unknown; status: string; quote_version: number; duration_days: number }>("select total, project_type, terms, status, quote_version, duration_days from public.contracts where id = $1", [id]));
    expect(c.rows[0]).toMatchObject({ project_type: "labour", terms: { custom: [] }, status: "draft", quote_version: 1, duration_days: 15 });
    expect(Number(c.rows[0].total)).toBe(2000);
    const p = await asAdmin((q) => q<{ amount: string }>("select amount from public.contract_payments where contract_id = $1 order by seq", [id]));
    expect(p.rows.map((x) => Number(x.amount))).toEqual([600, 1400]);
  });

  it("a refused schedule leaves no contract behind (and the quote can be contracted again)", async () => {
    const quote = await issuedQuote(1000);
    for (const bad of [sched([{ label: "أ", percent: 90, due_event: "signing" }]), sched([]), sched([{ label: "أ", percent: 100, due_event: "whenever" }])]) {
      await expectDenied(as({ userId: sup }, (q) => q("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb)", [quote, bad])), /invalid payment schedule/);
    }
    expect((await contractsOf(quote)).rowCount).toBe(0);
    await as({ userId: sup }, (q) => q("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb)", [quote, full]));
    expect((await contractsOf(quote)).rowCount).toBe(1);
  });

  it("same rules as before: an unissued quote, a viewer, a restricted member are refused", async () => {
    const draft = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id);
    await expectDenied(as({ userId: sup }, (q) => q("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb)", [draft, full])), /quote not issued/);
    const quote = await issuedQuote(1000);
    await expectDenied(as({ userId: viewer }, (q) => q("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb)", [quote, full])), /quote not issued|permission denied|not allowed|row-level security/);
    expect((await contractsOf(quote)).rowCount).toBe(0);
  });

  it("defence: a contract with no payment schedule can't be sent or accepted", async () => {
    const quote = await issuedQuote(1000);
    const c = await as({ userId: owner }, async (q) => (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,10,1000) returning id, number", [org, quote, client])).rows[0]);
    const token = "tok_" + randomBytes(24).toString("hex");
    await expectDenied(as({ userId: owner }, (q) => q("select public.issue_portal_link($1, $2, now() + interval '60 days')", [c.id, hash(token)])), /no payment schedule/);
    // even if it reached the client somehow (an older link), acceptance is refused
    await as({ userId: owner }, async (q) => {
      await q("update public.contracts set status = 'sent' where id = $1", [c.id]);
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '60 days')", [org, c.id, hash(token)]);
    });
    await expectDenied(as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [c.number, token])), /no payment schedule/);
    const k = await asAdmin((q) => q<{ status: string }>("select status from public.contracts where id = $1", [c.id]));
    expect(k.rows[0].status).toBe("sent");
  });
});
