import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Measurement sheets and quantity settlement (owner, Nov 2026): the difference between measured and
 * agreed m² at the contract's price per m² (same discount %, VAT) is settled in the final payment.
 */
let owner: string, sup: string, fin: string, viewer: string, restricted: string;
let org: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const SIG = "data:image/png;base64,iVBORw0KGgo=";
type Made = { id: string; number: string; token: string; payments: string[]; final: string };

const VIEW = (method: "unit" | "lump" = "unit") => JSON.stringify({
  method, service: "gypsum", discountPercent: 10, vatPercent: 15, subtotal: 7800, discount: 780,
  workTypes: [{ workType: "ceilings", area: 100, pricePerM2: 50, total: 5000 }, { workType: "partitions", area: 40, pricePerM2: 70, total: 2800 }],
});

async function makeContract(opts: { method?: "unit" | "lump"; accept?: boolean; percents?: number[] } = {}): Promise<Made> {
  const { method = "unit", accept = true, percents = [50, 50] } = opts;
  const total = 8073; // 7020 net + 15 %
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total, vat_percent) values ($1,$2,1,'{}','{}',$3::jsonb,7020,$4,15)", [org, quote, VIEW(method), total]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,$4,'sent') returning id, number", [org, quote, client, total])).rows[0];
    const payments: string[] = [];
    for (const [i, p] of percents.entries()) {
      const due = i === 0 ? "signing" : i === percents.length - 1 ? "handover" : "custom";
      payments.push((await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, c.id, i + 1, `دفعة ${i + 1}`, p, Math.round(total * p) / 100, due])).rows[0].id);
    }
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '60 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, token, payments };
  });
  let final = "";
  if (accept) {
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
    final = await asAdmin(async (q) => {
      await q("delete from public.project_stages where contract_id = $1", [made.id]);
      await q("insert into public.project_stages (organization_id, contract_id, seq, name) values ($1,$2,1,'تركيب')", [org, made.id]);
      return (await q<{ id: string }>("insert into public.project_stages (organization_id, contract_id, seq, name, is_final, payment_event) values ($1,$2,2,'التسليم',true,'handover') returning id", [org, made.id])).rows[0].id;
    });
  }
  return { ...made, final };
}

const draft = (contract: string, lines: { work_type: string; measured_area: number }[], who = sup) =>
  as({ userId: who }, async (q) => (await q<{ id: string; number: string }>("insert into public.contract_measurements (organization_id, contract_id, lines) values ($1,$2,$3::jsonb) returning id, number", [org, contract, JSON.stringify(lines)])).rows[0]);
const send = (id: string, who = sup) => as({ userId: who }, (q) => q("select public.send_measurement($1)", [id]));
const answer = (c: Made, id: string, approve: boolean, note: string | null = null, sig: string | null = SIG) =>
  as("service_role", async (q) => (await q<{ ok: boolean }>("select public.portal_answer_measurement($1,$2,$3,$4,'محمد',$5,$6,'1.1.1.1','x') as ok", [c.number, c.token, id, approve, note, sig])).rows[0].ok);
const payments = (contract: string) =>
  asAdmin(async (q) => (await q<{ seq: number; amount: string; status: string; kind: string; due_event: string; measure_adjust: string; paid_amount: string | null }>("select seq, amount, status, kind, due_event, measure_adjust, paid_amount from public.contract_payments where contract_id = $1 order by seq", [contract])).rows
    .map((p) => ({ seq: p.seq, amount: Number(p.amount), status: p.status, kind: p.kind, due: p.due_event, adjust: Number(p.measure_adjust), paid: p.paid_amount == null ? null : Number(p.paid_amount) })));
const handOver = async (c: Made) => {
  await asAdmin((q) => q("update public.project_stages set status = 'awaiting_client' where id = $1", [c.final]));
  return as("service_role", (q) => q("select public.portal_confirm_stage($1,$2,$3,'محمد',$4,'1.1.1.1','x')", [c.number, c.token, c.final, SIG]));
};
const measurement = (id: string) =>
  asAdmin(async (q) => (await q<{ status: string; diff_subtotal: string; diff_vat: string; diff_total: string; credit_amount: string; lines: { work_type: string; agreed_area: number; measured_area: number; price_per_m2: number; diff_area: number; diff_amount: number }[] }>("select * from public.contract_measurements where id = $1", [id])).rows[0]);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500004001");
  sup = await createUser("966500004002");
  fin = await createUser("966500004003");
  viewer = await createUser("966500004004");
  restricted = await createUser("966500004005");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org M') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance'),($1,$4,'viewer'),($1,$5,'supervisor')", [org, sup, fin, viewer, restricted]);
    await q("update public.memberships set project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'عميل','966511113333') returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("measurement sheet", () => {
  it("prices the difference at the contract's price per m², discount % and VAT; numbered MS-", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 110 }, { work_type: "partitions", measured_area: 38 }]);
    expect(m.number).toMatch(/^MS-\d{4}-\d{3}$/);
    const r = await measurement(m.id);
    expect(r.lines).toEqual([
      { work_type: "ceilings", agreed_area: 100, measured_area: 110, price_per_m2: 50, diff_area: 10, diff_amount: 500 },
      { work_type: "partitions", agreed_area: 40, measured_area: 38, price_per_m2: 70, diff_area: -2, diff_amount: -140 },
    ]);
    // (500 − 140) × 0.9 = 324 · VAT 48.60 · 372.60
    expect([Number(r.diff_subtotal), Number(r.diff_vat), Number(r.diff_total)]).toEqual([324, 48.6, 372.6]);
  });

  it("refuses a lump-sum contract, a contract not accepted, an unknown or repeated work type", async () => {
    const lump = await makeContract({ method: "lump" });
    await expectDenied(draft(lump.id, [{ work_type: "ceilings", measured_area: 90 }]), /lump sum contract/);
    const sent = await makeContract({ accept: false });
    await expectDenied(draft(sent.id, [{ work_type: "ceilings", measured_area: 90 }]), /isn't accepted/);
    const c = await makeContract();
    await expectDenied(draft(c.id, [{ work_type: "walls", measured_area: 90 }]), /work type not in the contract/);
    await expectDenied(draft(c.id, [{ work_type: "ceilings", measured_area: 90 }, { work_type: "ceilings", measured_area: 9 }]), /invalid measurement/);
    await expectDenied(draft(c.id, [{ work_type: "ceilings", measured_area: -1 }]), /invalid measurement/);
    await draft(c.id, [{ work_type: "ceilings", measured_area: 90 }]);
    await expectDenied(draft(c.id, [{ work_type: "ceilings", measured_area: 95 }]), /already measured/);
  });

  it("permissions: projects.manage writes, viewers read, no project access → nothing", async () => {
    const c = await makeContract();
    await expectDenied(draft(c.id, [{ work_type: "ceilings", measured_area: 90 }], viewer));
    await expectDenied(draft(c.id, [{ work_type: "ceilings", measured_area: 90 }], restricted));
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 90 }]);
    const seen = await as({ userId: viewer }, (q) => q("select id from public.contract_measurements where id = $1", [m.id]));
    expect(seen.rowCount).toBe(1);
    const hidden = await as({ userId: restricted }, (q) => q("select id from public.contract_measurements where id = $1", [m.id]));
    expect(hidden.rowCount).toBe(0);
    await expectDenied(send(m.id, viewer), /not allowed/);
    await expectDenied(send(m.id, restricted), /not allowed/);
  });

  it("users can't send, answer or settle it by hand; a sent sheet is frozen and can't be deleted", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 90 }]);
    await expectDenied(as({ userId: sup }, (q) => q("update public.contract_measurements set status = 'approved' where id = $1", [m.id])), /through their functions/);
    await expectDenied(as({ userId: sup }, (q) => q("update public.contract_measurements set credit_amount = 5 where id = $1", [m.id])), /through their functions/);
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.contract_measurements (organization_id, contract_id, status) values ($1,$2,'approved')", [org, c.id])), /starts as a draft/);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, kind) values ($1,$2,9,'x',0,10,'measurement')", [org, c.id])), /made by the database/);
    await send(m.id);
    await expectDenied(as({ userId: sup }, (q) => q("update public.contract_measurements set lines = '[{\"work_type\":\"ceilings\",\"measured_area\":1}]' where id = $1", [m.id])), /can't change/);
    await expectDenied(as({ userId: owner }, (q) => q("delete from public.contract_measurements where id = $1", [m.id])), /can't be deleted/);
  });
});

describe("the client answers", () => {
  it("approving needs a signature; objecting needs a note; staff revise and send again", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 104 }]);
    expect(await answer(c, m.id, true)).toBe(false); // not sent yet
    await send(m.id);
    await expectDenied(answer(c, m.id, true, null, null), /invalid signature/);
    await expectDenied(answer(c, m.id, false, " ", null), /invalid note/);
    expect(await answer(c, m.id, false, "السقف 102 بس", null)).toBe(true);
    expect((await measurement(m.id)).status).toBe("objected");
    const n = await asAdmin((q) => q<{ kind: string; link: string }>("select kind, link from public.notifications where organization_id = $1 and kind = 'measurement_objected'", [org]));
    expect(n.rows[0].link).toBe(`/projects/${c.number}?m=${m.number}`);
    await as({ userId: sup }, (q) => q("update public.contract_measurements set lines = '[{\"work_type\":\"ceilings\",\"measured_area\":102}]' where id = $1", [m.id]));
    await send(m.id);
    expect(await answer(c, m.id, true)).toBe(true);
    const r = await measurement(m.id);
    expect(r.status).toBe("approved");
    expect(Number(r.diff_total)).toBe(103.5); // 2 × 50 × 0.9 × 1.15
    expect(await answer(c, m.id, true)).toBe(false); // already answered
  });

  it("the final handover waits for the client's answer to a sent sheet", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 100 }]);
    await send(m.id);
    await expectDenied(handOver(c), /measurement pending/);
    await answer(c, m.id, true);
    await handOver(c);
  });
});

describe("settlement in the final payment", () => {
  it("more m² → a «تسوية الأمتار» payment requested with the final handover, invoiced on its own", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 110 }]);
    await send(m.id);
    await answer(c, m.id, true);
    // 10 × 50 × 0.9 × 1.15 = 517.50
    expect((await payments(c.id)).slice(2)).toEqual([{ seq: 3, amount: 517.5, status: "pending", kind: "measurement", due: "handover", adjust: 0, paid: null }]);
    await handOver(c);
    const p = await payments(c.id);
    expect(p.map((x) => x.status)).toEqual(["requested", "requested", "requested"]);
    const inv = await asAdmin((q) => q<{ total: string }>("select i.total from public.invoices i join public.contract_payments p on p.id = i.payment_id where p.contract_id = $1 and p.kind = 'measurement'", [c.id]));
    expect(Number(inv.rows[0].total)).toBe(517.5);
  });

  it("measured after the handover → the settlement is requested at once", async () => {
    const c = await makeContract();
    await handOver(c);
    const m = await draft(c.id, [{ work_type: "partitions", measured_area: 42 }]);
    await send(m.id);
    await answer(c, m.id, true);
    // 2 × 70 × 0.9 × 1.15 = 144.90
    const last = (await payments(c.id)).at(-1)!;
    expect([last.kind, last.amount, last.status]).toEqual(["measurement", 144.9, "requested"]);
  });

  it("fewer m² → taken off the final payment while it is pending; a later increase gives it back first", async () => {
    const c = await makeContract();
    const before = await payments(c.id);
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 90 }]);
    await send(m.id);
    await answer(c, m.id, true);
    // −10 × 50 × 0.9 × 1.15 = −517.50
    let p = await payments(c.id);
    expect(p).toHaveLength(2);
    expect(p[1].amount).toBe(before[1].amount - 517.5);
    expect(p[1].adjust).toBe(-517.5);
    expect(p[0].amount).toBe(before[0].amount);
    const m2 = await draft(c.id, [{ work_type: "partitions", measured_area: 50 }]);
    await send(m2.id);
    await answer(c, m2.id, true);
    // +10 × 70 × 0.9 × 1.15 = 724.50 → 517.50 back to the final payment, 207 as a settlement payment
    p = await payments(c.id);
    expect(p[1].amount).toBe(before[1].amount);
    expect(p[1].adjust).toBe(0);
    expect([p[2].kind, p[2].amount]).toEqual(["measurement", 207]);
  });

  it("fewer m² on a requested final payment → its unpaid part goes down, with a credit note on its invoice", async () => {
    const c = await makeContract();
    await handOver(c); // final payment requested and invoiced, not paid
    const before = await payments(c.id);
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 98 }]); // −103.50
    await send(m.id);
    await answer(c, m.id, true);
    const p = await payments(c.id);
    expect(p[1].amount).toBe(before[1].amount - 103.5);
    expect([p[1].status, p[1].adjust]).toEqual(["requested", -103.5]);
    expect(Number((await measurement(m.id)).credit_amount)).toBe(0);
    const cn = await asAdmin((q) => q<{ number: string; total: string; inv: string; payment_id: string }>("select n.number, n.total, i.payment_id as inv, n.payment_id from public.credit_notes n join public.invoices i on i.id = n.invoice_id where n.measurement_id = $1", [m.id]));
    expect(cn.rows).toHaveLength(1);
    expect(cn.rows[0].number).toMatch(/^CN-\d{4}-\d{3}$/);
    expect(Number(cn.rows[0].total)).toBe(103.5);
    expect(cn.rows[0].inv).toBe(cn.rows[0].payment_id);
    // the client pays exactly what is left
    const pay = await asAdmin(async (q) => (await q<{ id: string }>("select id from public.contract_payments where contract_id = $1 and seq = 2", [c.id])).rows[0].id);
    const r = await as({ userId: fin }, (q) => q<{ s: string }>("select public.record_client_payment($1, current_date, $2, 'transfer', null) as s", [pay, before[1].amount - 103.5]));
    expect(r.rows[0].s).toBe("paid");
  });

  it("fewer m² once everything is paid → owed to the client (credit note, finance told); finance records the refund", async () => {
    const c = await makeContract();
    await handOver(c);
    for (const p of await asAdmin(async (q) => (await q<{ id: string; amount: string }>("select id, amount from public.contract_payments where contract_id = $1", [c.id])).rows)) {
      await as({ userId: fin }, (q) => q("select public.record_client_payment($1, current_date, $2, 'transfer', null)", [p.id, Number(p.amount)]));
    }
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 98 }]);
    await send(m.id);
    await answer(c, m.id, true);
    expect(Number((await measurement(m.id)).credit_amount)).toBe(103.5);
    const cn = await asAdmin((q) => q<{ total: string; payment_id: string | null }>("select total, payment_id from public.credit_notes where measurement_id = $1", [m.id]));
    expect(cn.rows.map((x) => [Number(x.total), x.payment_id])).toEqual([[103.5, null]]);
    const n = await asAdmin((q) => q("select 1 from public.notifications where kind = 'measurement_credit' and user_id = $1", [fin]));
    expect(n.rowCount).toBe(1);
    await expectDenied(as({ userId: sup }, (q) => q("select public.record_measurement_refund($1, current_date, 'transfer', null)", [m.id])), /not allowed/);
    await as({ userId: fin }, (q) => q("select public.record_measurement_refund($1, current_date, 'transfer', 'TR-1')", [m.id]));
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_measurement_refund($1, current_date, 'transfer', null)", [m.id])), /nothing to refund/);
    // a credit note can't be written by users
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.credit_notes (organization_id, contract_id, invoice_id, kind, issue_date, description, seller, buyer, subtotal, total) select organization_id, contract_id, invoice_id, kind, issue_date, description, seller, buyer, 1, 1 from public.credit_notes limit 1")));
  });

  it("a final payment reduced to nothing is settled at the handover — no invoice, no Qoyod job", async () => {
    const c = await makeContract({ percents: [95, 5] });
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 90 }]); // −517.50 > 5 % (403.65)
    await send(m.id);
    await answer(c, m.id, true);
    const p = await payments(c.id);
    expect(p[1].amount).toBe(0);
    // the rest (517.50 − 403.65) comes off the signing payment's unpaid part, with a credit note on its invoice
    expect(p[0].amount).toBe(7555.5);
    expect(Number((await measurement(m.id)).credit_amount)).toBe(0);
    const cn = await asAdmin((q) => q<{ total: string }>("select total from public.credit_notes where measurement_id = $1", [m.id]));
    expect(cn.rows.map((x) => Number(x.total))).toEqual([113.85]);
    await handOver(c);
    const after = await payments(c.id);
    expect([after[1].status, after[1].paid]).toEqual(["paid", 0]);
    const inv = await asAdmin((q) => q("select 1 from public.invoices where payment_id = (select id from public.contract_payments where contract_id = $1 and seq = 2)", [c.id]));
    expect(inv.rowCount).toBe(0);
  });
});

describe("review fixes", () => {
  it("the client sees the sheet as sent, not the staff's unsent correction", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 104 }]);
    await send(m.id);
    await answer(c, m.id, false, "راجعوا السقف", null);
    await as({ userId: sup }, (q) => q("update public.contract_measurements set lines = '[{\"work_type\":\"ceilings\",\"measured_area\":101}]' where id = $1", [m.id]));
    const seen = async () => (await as("service_role", (q) => q<{ v: { lines: { measured_area: number }[] }[] }>("select public.portal_measurements($1,$2) as v", [c.number, c.token]))).rows[0].v[0];
    expect(Number((await seen()).lines[0].measured_area)).toBe(104);
    await send(m.id);
    expect(Number((await seen()).lines[0].measured_area)).toBe(101);
    await expectDenied(as({ userId: sup }, (q) => q("update public.contract_measurements set sent_snapshot = '{}' where id = $1", [m.id])));
  });

  it("per-m² subcontractor agreements on the project are flagged for review", async () => {
    const c = await makeContract();
    const g = await as({ userId: owner }, async (q) => {
      const sub = (await q<{ id: string }>("insert into public.subcontractors (organization_id, name) values ($1, 'مقاول ' || gen_random_uuid()) returning id", [org])).rows[0].id;
      return (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, auto_progress) values ($1,$2,$3,'تركيب','per_m2',20,100,'weekly',false) returning id", [org, sub, c.id])).rows[0].id;
    });
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 110 }]);
    await send(m.id);
    await answer(c, m.id, true);
    const f = await asAdmin((q) => q<{ r: string }>("select review_measurement_id as r from public.subcontractor_agreements where id = $1", [g]));
    expect(f.rows[0].r).toBe(m.id);
  });

  it("credit notes go to Qoyod; the allocation to an unpaid invoice waits for Approved", async () => {
    // Qoyod switched on for this test only (sending stays Draft)
    await asAdmin((q) => q("insert into public.qoyod_settings (organization_id, enabled) values ($1, true)", [org]));
    try {
      const c = await makeContract();
      await handOver(c);
      const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 98 }]);
      await send(m.id);
      await answer(c, m.id, true);
      const jobs = await asAdmin((q) => q<{ kind: string }>("select kind from public.qoyod_sync_jobs where organization_id = $1 and kind in ('credit_note','credit_allocation') order by kind", [org]));
      expect(jobs.rows.map((j) => j.kind)).toEqual(["credit_allocation", "credit_note"]);
      const claimed = await as("service_role", (q) => q<{ kind: string }>("select kind from public.qoyod_claim_jobs(50)"));
      expect(claimed.rows.map((j) => j.kind)).toContain("credit_note");
      expect(claimed.rows.map((j) => j.kind)).not.toContain("credit_allocation");
    } finally {
      await asAdmin(async (q) => {
        await q("delete from public.qoyod_sync_jobs where organization_id = $1", [org]);
        await q("delete from public.qoyod_settings where organization_id = $1", [org]);
      });
    }
  });

  it("a sheet waiting for the client is reminded after 3 days", async () => {
    const c = await makeContract();
    const m = await draft(c.id, [{ work_type: "ceilings", measured_area: 100 }]);
    await send(m.id);
    await asAdmin((q) => q("update public.contract_measurements set sent_at = now() - interval '3 days' where id = $1", [m.id]));
    await asAdmin((q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q<{ link: string }>("select link from public.notifications where kind = 'measurement_waiting' and dedupe_key like $1", [`measurement_waiting:${m.id}:%`]));
    expect(n.rows[0]?.link).toBe(`/projects/${c.number}?m=${m.number}`);
  });
});

describe("measurement_basis", () => {
  it("gives the agreed work types to staff who can see the project, nobody else", async () => {
    const c = await makeContract();
    const b = await as({ userId: viewer }, async (q) => (await q<{ b: { method: string; work_types: { workType: string; area: number }[]; discount_percent: number; vat_percent: number } }>("select public.measurement_basis($1) as b", [c.id])).rows[0].b);
    expect(b.method).toBe("unit");
    expect(b.work_types.map((w) => [w.workType, w.area])).toEqual([["ceilings", 100], ["partitions", 40]]);
    expect([Number(b.discount_percent), Number(b.vat_percent)]).toEqual([10, 15]);
    await expectDenied(as({ userId: restricted }, (q) => q("select public.measurement_basis($1)", [c.id])), /not allowed/);
  });
});
