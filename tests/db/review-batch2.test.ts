import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Review batch 1, second round (Nov 2026):
 * #1 quote versions only from the server (forged margins) · #2 legacy paid addenda ·
 * #3 profit alerts need hr.view · #4 one employee-day across teams · #5 Qoyod drafts approved ·
 * #6 requestable payments from the database · #7 a sent contract freezes its quote · #8 approval links.
 */
let owner: string, sup: string, fin: string, viewer: string, restricted: string;
let org: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

type Made = { id: string; number: string; quote: string; token: string; payments: string[] };

const VERSION = (total: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ selection: {}, quantities: {}, client_view: {}, pricing_method: "unit", estimated: false, discount: 0, subtotal: total, vat_percent: 0, vat: 0, total, notes: null, problems: 0, ...extra });
const COSTS = (margin: number) => JSON.stringify({ cost: 100, cost_with_contingency: 105, margin_percent: margin, lines: [], purchase_list: [] });

/** What saveQuoteVersion does through the service-role client. */
const saveVersion = (user: string, quote: string, total: number, margin: number | null, extra: Record<string, unknown> = {}) =>
  as("service_role", (q) =>
    q<{ id: string; version: number }>("select * from public.save_quote_version($1, $2, jsonb_build_object('version', $3::jsonb, 'costs', $4::jsonb))", [user, quote, VERSION(total, extra), margin == null ? null : COSTS(margin)]),
  ).then((r) => r.rows[0]);

async function makeContract(total: number, events: string[] = ["signing"], accept = true): Promise<Made> {
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',$3,$3)", [org, quote, total]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,$4,'sent') returning id, number", [org, quote, client, total])).rows[0];
    const payments: string[] = [];
    const share = Math.round((total / events.length) * 100) / 100;
    for (const [i, e] of events.entries()) {
      payments.push((await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, c.id, i + 1, `دفعة ${i + 1}`, 100 / events.length, share, e])).rows[0].id);
    }
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, quote, token, payments };
  });
  if (accept) await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}

async function makeAddendum(c: Made, total: number): Promise<{ id: string; number: string }> {
  const a = await as({ userId: owner }, async (q) => {
    const row = (await q<{ id: string; number: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, vat, total, extra_days) values ($1,$2,'أعمال إضافية','بيت إنارة',$3,0,$3,2) returning id, number", [org, c.id, total])).rows[0];
    await q("select public.submit_addendum($1)", [row.id]);
    await q("update public.addenda set status = 'sent' where id = $1", [row.id]);
    return row;
  });
  await as("service_role", (q) => q("select public.portal_accept_addendum($1,$2,$3,'محمد',null,'1.1.1.1','x')", [c.number, c.token, a.id]));
  return a;
}

const newQuote = (user: string) =>
  as({ userId: user }, async (q) => (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500019001");
  sup = await createUser("966500019002");
  fin = await createUser("966500019003");
  viewer = await createUser("966500019004");
  restricted = await createUser("966500019005");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance'),($1,$4,'viewer'),($1,$5,'supervisor')", [org, sup, fin, viewer, restricted]);
    await q("update public.memberships set project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, phone, name) values ($1,'966500008888','عميل') returning id", [org])).rows[0].id;
    await q("insert into public.pricing_settings (organization_id, min_margin_percent) values ($1, 20) on conflict (organization_id) do update set min_margin_percent = 20", [org]);
  });
});
afterAll(closePool);

describe("#1 quote versions are written only by the server", () => {
  it("signed-in users can't insert versions or costs (even with quotes.manage)", async () => {
    const quote = await newQuote(sup);
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, quote])), /permission denied/);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, quote])), /permission denied/);
    const v = await saveVersion(sup, quote, 1000, 25);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines) values ($1,$2,1,1,90,'[]')", [v.id, org])), /permission denied/);
    // reading stays as before
    const seen = await as({ userId: sup }, (q) => q<{ n: number }>("select count(*)::int as n from public.quote_version_costs where quote_version_id = $1", [v.id]));
    expect(seen.rows[0].n).toBe(1);
  });

  it("a forged margin can't get a low-margin quote issued without the owner", async () => {
    const quote = await newQuote(sup);
    // the server saves the real version (margin 10 % < 20 %) and asks the owner
    await saveVersion(sup, quote, 5000, 10);
    await as({ userId: sup }, (q) => q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_margin','quote',$2,'{\"version\":1}')", [org, quote]));
    // the supervisor tries to write his own version with a comfortable margin
    await expectDenied(
      as({ userId: sup }, async (q) => {
        const v = (await q<{ id: string }>("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',5000,5000) returning id", [org, quote])).rows[0].id;
        await q("insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines) values ($1,$2,1,1,50,'[]')", [v, org]);
      }),
      /permission denied/,
    );
    await expectDenied(as({ userId: sup }, (q) => q("select public.issue_quote($1, null)", [quote])), /approval/);
    const s = await asAdmin((q) => q<{ status: string; current_version: number }>("select status, current_version from public.quotes where id = $1", [quote]));
    expect(s.rows[0]).toEqual({ status: "draft", current_version: 1 });
  });

  it("save_quote_version: service role only, checks the user's permissions, stamps created_by", async () => {
    const quote = await newQuote(owner);
    await expectDenied(as({ userId: owner }, (q) => q("select * from public.save_quote_version($1,$2,'{}'::jsonb)", [owner, quote])), /permission denied/);
    // a viewer (no quotes.manage) and a non-member are refused
    await expectDenied(saveVersion(viewer, quote, 100, 30), /not allowed/);
    const stranger = await createUser("966500019099");
    await expectDenied(saveVersion(stranger, quote, 100, 30), /not allowed/);
    // costs need costs.view
    await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":[],"deny":["costs.view"]}' where organization_id = $1 and user_id = $2`, [org, sup]));
    try {
      await expectDenied(saveVersion(sup, quote, 100, 30), /not allowed/);
    } finally {
      await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":[],"deny":[]}' where organization_id = $1 and user_id = $2`, [org, sup]));
    }
    const v1 = await saveVersion(sup, quote, 100, 30, { problems: 2, notes: "ملاحظة" });
    const v2 = await saveVersion(sup, quote, 120, 31);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const row = await asAdmin((q) => q<{ created_by: string; total: string; problems: number; notes: string; cb: string; margin: string }>(
      "select v.created_by, v.total, v.problems, v.notes, c.created_by as cb, c.margin_percent as margin from public.quote_versions v join public.quote_version_costs c on c.quote_version_id = v.id where v.id = $1", [v1.id]));
    expect(row.rows[0]).toMatchObject({ created_by: sup, total: "100.00", problems: 2, notes: "ملاحظة", cb: sup, margin: "30.00" });
  });
});

describe("#2 legacy paid addenda", () => {
  it("a row marked paid without an amount counts as fully paid and is backfilled with its receipt", async () => {
    const c = await makeContract(10000);
    const ad = await makeAddendum(c, 1500);
    // what rows from before amounts were recorded look like
    await asAdmin((q) => q("update public.addenda set payment_status = 'paid', paid_amount = null, paid_at = null where id = $1", [ad.id]));
    const docs = await as("service_role", (q) => q<{ d: { number: string; paid: number; total: number }[] }>("select public.portal_invoice_docs($1,$2) as d", [c.number, c.token]));
    const inv = docs.rows[0].d.find((x) => x.number.startsWith("INV") && Number(x.total) === 1500);
    expect(Number(inv?.paid)).toBe(1500);
    await asAdmin((q) => q("select private.review_backfill()"));
    const a = await asAdmin((q) => q<{ paid_amount: string; paid_at: string | null }>("select paid_amount, paid_at from public.addenda where id = $1", [ad.id]));
    expect(Number(a.rows[0].paid_amount)).toBe(1500);
    expect(a.rows[0].paid_at).toBeTruthy();
    const rv = await asAdmin((q) => q<{ amount: string }>("select amount from public.client_receipts where addendum_id = $1", [ad.id]));
    expect(rv.rows.map((r) => Number(r.amount))).toEqual([1500]);
    // running it again changes nothing
    await asAdmin((q) => q("select private.review_backfill()"));
    expect((await asAdmin((q) => q<{ n: number }>("select count(*)::int as n from public.client_receipts where addendum_id = $1", [ad.id]))).rows[0].n).toBe(1);
  });
});

describe("#3 profit alerts are built from salaries", () => {
  it("project_losing goes only to members with costs.view and hr.view; over-budget to costs.view", async () => {
    const c = await makeContract(3000);
    await asAdmin(async (q) => {
      const qv = (await q<{ id: string }>("select v.id from public.quote_versions v where v.quote_id = $1 and v.version = 1", [c.quote])).rows[0].id;
      await q("insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list) values ($1,$2,100,100,30,'[{\"group\":\"material\",\"cost\":100}]','[]')", [qv, org]);
      const item = (await q<{ id: string }>("insert into public.inventory_items (organization_id, name, unit, is_general) values ($1,'جبس','board',false) returning id", [org])).rows[0].id;
      await q("insert into public.inventory_movements (organization_id, item_id, contract_id, kind, quantity, unit_cost) values ($1,$2,$3,'issue',10,500)", [org, item, c.id]);
    });
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const who = (kind: string) =>
      asAdmin((q) => q<{ user_id: string }>("select user_id from public.notifications where kind = $1 and dedupe_key like $2", [kind, `%${c.id}%`])).then((r) => r.rows.map((x) => x.user_id).sort());
    expect(await who("project_losing")).toEqual([owner, fin].sort());
    expect(await who("project_over_budget")).toEqual([owner, sup, fin].sort());
  });
});

describe("#4 an employee's day is counted once", () => {
  it("an employee in two in-house teams booked the same day costs one day, split between the projects", async () => {
    const c1 = await makeContract(5000);
    const c2 = await makeContract(5000);
    const day = "2026-11-02"; // a Monday
    const { e, f } = await as({ userId: owner }, async (q) => {
      const e = (await q<{ id: string }>("insert into public.employees (organization_id, phone, full_name, is_saudi, basic_salary, housing_allowance, transport_allowance, other_allowances) values ($1,'966500009999','مشترك',false,2600,0,0,0) returning id", [org])).rows[0].id;
      const f = (await q<{ id: string }>("insert into public.employees (organization_id, phone, full_name, is_saudi, basic_salary, housing_allowance, transport_allowance, other_allowances) values ($1,'966500009999','ثاني',false,5200,0,0,0) returning id", [org])).rows[0].id;
      const t1 = (await q<{ id: string }>("insert into public.teams (organization_id, name, kind) values ($1,'فريق ١','inhouse') returning id", [org])).rows[0].id;
      const t2 = (await q<{ id: string }>("insert into public.teams (organization_id, name, kind) values ($1,'فريق ٢','inhouse') returning id", [org])).rows[0].id;
      await q("insert into public.team_members (organization_id, team_id, employee_id) values ($1,$2,$3),($1,$2,$4),($1,$5,$3)", [org, t1, e, f, t2]);
      await q("insert into public.schedule_entries (organization_id, team_id, contract_id, kind, start_date, end_date) values ($1,$2,$3,'work',$5,$5),($1,$4,$6,'work',$5,$5)", [org, t1, c1.id, t2, day, c2.id]);
      return { e, f };
    });
    const r = await asAdmin((q) =>
      q<{ de: string; df: string; l1: string; l2: string }>(
        "select private.employee_day_cost($1) as de, private.employee_day_cost($2) as df, private.project_labour($3, $5::date, $5::date) as l1, private.project_labour($4, $5::date, $5::date) as l2",
        [e, f, c1.id, c2.id, day],
      ),
    );
    const { de, df, l1, l2 } = r.rows[0];
    expect(Number(l1)).toBeCloseTo(Number(df) + Number(de) / 2, 2);
    expect(Number(l2)).toBeCloseTo(Number(de) / 2, 2);
    expect(Number(l1) + Number(l2)).toBeCloseTo(Number(de) + Number(df), 2);
  });

  it("month to date uses the same daily rate as the allocated cost", async () => {
    const r = await as({ userId: owner }, (q) => q<{ to_date: string }>("select to_date from public.team_cost_month($1)", [org]));
    const x = await asAdmin((q) =>
      q<{ v: string }>(
        `select sum(private.employee_day_cost(e.id)) * private.work_days(date_trunc('month', now() at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date) as v
         from public.employees e where e.organization_id = $1 and e.status = 'active'
           and exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id where m.employee_id = e.id and t.kind = 'inhouse' and t.is_active)`,
        [org],
      ),
    );
    expect(Number(r.rows[0].to_date)).toBeCloseTo(Number(x.rows[0].v), 2);
  });
});

describe("#5 Qoyod: drafts approved by the owner", () => {
  it("qoyod_wake_waiting sends the waiting jobs now (settings.manage or finance.manage)", async () => {
    const ids = await asAdmin(async (q) => {
      const mk = async (ref: string, err: string | null, status = "queued") =>
        (await q<{ id: string }>("insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref, status, next_attempt_at, last_error) values ($1,'invoice_payment','contract_payment',gen_random_uuid(),$2,$3, now() + interval '12 hours',$4) returning id", [org, ref, status, err])).rows[0].id;
      return { draft: await mk("w1", "waiting:invoice_draft"), approved: await mk("w2", "waiting:approved"), other: await mk("w3", "timeout"), failed: await mk("w4", "waiting:x", "failed") };
    });
    await expectDenied(as({ userId: sup }, (q) => q("select public.qoyod_wake_waiting($1)", [org])), /not allowed/);
    const n = await as({ userId: fin }, (q) => q<{ n: number }>("select public.qoyod_wake_waiting($1) as n", [org]));
    expect(n.rows[0].n).toBe(2);
    const due = await asAdmin((q) => q<{ id: string; due: boolean }>("select id, next_attempt_at <= now() as due from public.qoyod_sync_jobs where id = any($1::uuid[])", [Object.values(ids)]));
    const map = Object.fromEntries(due.rows.map((r) => [r.id, r.due]));
    expect([map[ids.draft], map[ids.approved], map[ids.other], map[ids.failed]]).toEqual([true, true, false, false]);
  });
});

describe("#6 requestable payments come from the database", () => {
  it("lists exactly the payments request_contract_payment accepts, for whoever may request them", async () => {
    const c = await makeContract(8000, ["signing", "material_supply", "board_closing", "primer_done"]);
    // the project has a board-closing stage (the client's confirmation requests that payment), no primer stage
    await asAdmin((q) => q("insert into public.project_stages (organization_id, contract_id, seq, name, payment_event) values ($1,$2,40,'إغلاق الألواح','board_closing')", [org, c.id]));
    const list = (user: string) =>
      as({ userId: user }, (q) => q<{ payment_id: string }>("select payment_id from public.requestable_payments($1, $2)", [org, c.id])).then((r) => r.rows.map((x) => x.payment_id).sort());
    // signing is already requested; board closing follows the client's confirmation; primer has no stage on a gypsum project
    expect(await list(fin)).toEqual([c.payments[1], c.payments[3]].sort());
    expect(await list(sup)).toEqual([c.payments[1], c.payments[3]].sort());
    expect(await list(viewer)).toEqual([]);
    expect(await list(restricted)).toEqual([]);
    // whole organization (no contract given)
    const all = await as({ userId: fin }, (q) => q<{ payment_id: string }>("select payment_id from public.requestable_payments($1)", [org]));
    expect(all.rows.map((x) => x.payment_id)).toEqual(expect.arrayContaining([c.payments[1], c.payments[3]]));
    for (const p of [c.payments[1], c.payments[3]]) await as({ userId: fin }, (q) => q("select public.request_contract_payment($1)", [p]));
    expect(await list(fin)).toEqual([]);
    const sent = await makeContract(1000, ["signing", "custom"], false);
    expect(await as({ userId: fin }, (q) => q("select payment_id from public.requestable_payments($1, $2)", [org, sent.id])).then((r) => r.rows)).toEqual([]);
  });
});

describe("#7 a sent contract freezes its quote", () => {
  it("no new version or options while the contract waits for the client; acceptance keeps current_version = the agreed version", async () => {
    const quote = await newQuote(owner);
    await saveVersion(owner, quote, 1000, 30);
    await saveVersion(owner, quote, 900, 30);
    const opts = JSON.stringify([{ version: 1, label: "أ" }, { version: 2, label: "ب" }]);
    const token = "tok_" + randomBytes(24).toString("hex");
    const c = await as({ userId: owner }, async (q) => {
      await q("update public.quotes set options = $2::jsonb where id = $1", [quote, opts]);
      await q("select public.issue_quote($1, null)", [quote]);
      const row = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status, options) values ($1,$2,2,$3,'gypsum',current_date,10,900,'sent',$4::jsonb) returning id, number", [org, quote, client, opts])).rows[0];
      await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'دفعة',100,900,'signing')", [org, row.id]);
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, row.id, hash(token)]);
      return row;
    });
    await expectDenied(saveVersion(owner, quote, 800, 30), /sent/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set options = null where id = $1", [quote])), /sent/);
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x',1)", [c.number, token]));
    const qq = await asAdmin((q) => q<{ status: string; current_version: number }>("select status, current_version from public.quotes where id = $1", [quote]));
    expect(qq.rows[0]).toEqual({ status: "accepted", current_version: 1 });
  });
});

describe("#8 addendum approvals carry their contract", () => {
  it("the backfill adds the contract number to older addendum approvals", async () => {
    const c = await makeContract(4000);
    const ad = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, total) values ($1,$2,'قديم','قديم',100,100) returning id", [org, c.id])).rows[0].id);
    const ap = await asAdmin(async (q) => {
      await q("update public.addenda set status = 'pending_approval' where id = $1", [ad]);
      return (await q<{ id: string }>("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'addendum','addendum',$2,'{\"number\":\"AD-old\"}') returning id", [org, ad])).rows[0].id;
    });
    await asAdmin((q) => q("select private.review_backfill()"));
    const d = await asAdmin((q) => q<{ details: Record<string, unknown>; status: string }>("select details, status from public.approvals where id = $1", [ap]));
    expect(d.rows[0].details).toMatchObject({ number: "AD-old", contract: c.number });
    expect(d.rows[0].status).toBe("pending");
  });
});

describe("third review round", () => {
  it("a draft contract freezes its quote too (it would be sent on an older version)", async () => {
    const quote = await newQuote(owner);
    await saveVersion(owner, quote, 1000, 30);
    await as({ userId: owner }, async (q) => {
      await q("select public.issue_quote($1, null)", [quote]);
      await q("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'draft')", [org, quote, client]);
    });
    await expectDenied(saveVersion(owner, quote, 800, 30), /contract/);
  });

  it("saving a version through the server records the user in the audit log", async () => {
    const quote = await newQuote(owner);
    const v = await saveVersion(sup, quote, 1000, null);
    const log = await asAdmin((q) => q<{ actor_id: string | null }>("select actor_id from public.audit_log where table_name = 'quote_versions' and record_id = $1", [v.id]));
    expect(log.rows.map((r) => r.actor_id)).toEqual([sup]);
  });
});
