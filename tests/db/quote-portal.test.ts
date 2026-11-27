import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase, type Q } from "./db";

/**
 * Quote first, then contract (owner, Nov 2026): one client-page link issued from the quote
 * (/p/Q-…/<token>), the client accepts / asks for changes / declines there, and the same link
 * follows the contract made from the quote. Old contract links keep working.
 */
let owner: string, sup: string, other: string, viewer: string, org: string, orgB: string, client: string, clientB: string;
const year = new Date().getFullYear();
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const tok = (c: string) => `tok_${c.repeat(20)}`;
const PAY = JSON.stringify([{ label: "عند التوقيع", percent: 50, due_event: "signing" }, { label: "التسليم", percent: 50, due_event: "handover" }]);

async function newQuote(q: Q, o = org, cl = client, totals: number[] = [10000]): Promise<{ id: string; number: string }> {
  const r = await q<{ id: string; number: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'interior') returning id, number", [o, cl]);
  for (const [i, t] of totals.entries()) {
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,$3,'{}','{}','{\"workTypes\":[]}',$4,0,0,$4)", [o, r.rows[0].id, i + 1, t]);
  }
  return r.rows[0];
}
const issue = (q: Q, id: string) => q("select public.issue_quote($1, current_date + 7)", [id]);
const link = (u: string, quote: string, t: string) => as({ userId: u }, (q) => q<{ id: string }>("select public.issue_quote_link($1,$2) as id", [quote, hash(t)]));
const svc = <T extends Record<string, unknown>>(sql: string, params: unknown[]) => as("service_role", (q) => q<T>(sql, params));
type View = {
  stage: string;
  quote: Record<string, unknown> & { client_view: unknown; client_accepted_at?: unknown };
  options: { version: number; label: string; total: string }[];
  client: { name: string };
  contract: unknown;
};
const view = (n: string, t: string) => svc<{ v: View | null }>("select public.portal_view($1,$2) as v", [n, t]).then((r) => r.rows[0].v);
const accept = (n: string, t: string, version: number | null = 1) =>
  svc<{ ok: boolean }>("select public.portal_accept_quote($1,$2,'أبو فهد','1.2.3.4','iPhone',$3) as ok", [n, t, version]).then((r) => r.rows[0].ok);
const changes = (n: string, t: string, note = "نبي نغير لون الصالة") =>
  svc<{ ok: boolean }>("select public.portal_request_quote_changes($1,$2,$3,'1.2.3.4','iPhone') as ok", [n, t, note]).then((r) => r.rows[0].ok);
const reject = (n: string, t: string, reason: string | null = "السعر عالي") =>
  svc<{ ok: boolean }>("select public.portal_reject_quote($1,$2,$3,'1.2.3.4','iPhone') as ok", [n, t, reason]).then((r) => r.rows[0].ok);
const quoteRow = (id: string) => asAdmin((q) => q<Record<string, unknown>>("select * from public.quotes where id = $1", [id])).then((r) => r.rows[0]);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009101");
  sup = await createUser("966500009102");
  other = await createUser("966500009103");
  viewer = await createUser("966500009104");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: other }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, sup]);
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'أبو فهد','966511119999','1000000008') returning id", [org])).rows[0].id;
  });
  await as({ userId: other }, async (q) => {
    clientB = (await q<{ id: string }>("insert into public.clients (organization_id, phone, name, id_number) values ($1,'966500008888','عميل ب','1000000008') returning id", [orgB])).rows[0].id;
  });
});
afterAll(closePool);

describe("issuing the quote link", () => {
  it("only an issued quote, by quotes.manage of its organization; expiry = validity + 30 days", async () => {
    const qt = await as({ userId: owner }, (q) => newQuote(q));
    // draft → refused
    await expectDenied(link(owner, qt.id, tok("a")), /quote not issued/);
    await as({ userId: owner }, (q) => issue(q, qt.id));
    await expectDenied(link(viewer, qt.id, tok("a")), /not allowed/);
    await expectDenied(link(other, qt.id, tok("a")), /not allowed/);
    await expectDenied(as({ userId: owner }, (q) => q("select public.issue_quote_link($1,'not-a-hash')", [qt.id])), /invalid link/);
    await link(owner, qt.id, tok("a"));
    const l = await asAdmin((q) => q<{ contract_id: string | null; quote_id: string; expires_at: Date; d: string }>(
      "select contract_id, quote_id, expires_at, ((current_date + 7 + 31)::timestamp at time zone 'Asia/Riyadh') = expires_at as d from public.client_portal_links where token_hash = $1", [hash(tok("a"))]));
    expect(l.rows[0]).toMatchObject({ contract_id: null, quote_id: qt.id, d: true });
    // reissuing replaces the earlier link
    await link(owner, qt.id, tok("b"));
    expect(await view(qt.number, tok("a"))).toBeNull();
    expect((await view(qt.number, tok("b")))?.stage).toBe("quote");
  });

  it("users can't insert or re-point quote links themselves", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.client_portal_links (organization_id, quote_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '5 days')", [org, qt.id, hash(tok("c"))])), /issue_quote_link/);
    await link(owner, qt.id, tok("c"));
    const other = await as({ userId: owner }, (q) => newQuote(q));
    await expectDenied(as({ userId: owner }, (q) => q("update public.client_portal_links set quote_id = $1 where token_hash = $2", [other.id, hash(tok("c"))])), /only be revoked/);
    // revoking stays possible
    await as({ userId: owner }, (q) => q("update public.client_portal_links set revoked_at = now() where token_hash = $1", [hash(tok("c"))]));
    expect(await view(qt.number, tok("c"))).toBeNull();
  });

  it("another organization's member sees no quote link", async () => {
    const r = await as({ userId: other }, (q) => q("select id from public.client_portal_links"));
    expect(r.rows).toHaveLength(0);
  });
});

describe("the client page on the quote", () => {
  let qt: { id: string; number: string };
  beforeAll(async () => {
    qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("d"));
  });

  it("shows the quote; a wrong / revoked token or another number gives nothing", async () => {
    const v = await view(qt.number, tok("d"));
    expect(v).toMatchObject({ stage: "quote", quote: { number: qt.number, status: "issued", decision: null }, contract: null });
    expect(v?.quote.client_view).toEqual({ workTypes: [] });
    expect(await view(qt.number, tok("x"))).toBeNull();
    expect(await view(`Q-${year}-999`, tok("d"))).toBeNull();
    expect(await accept(qt.number, tok("x"))).toBe(false);
    expect(await changes(qt.number, tok("x"))).toBe(false);
    expect(await reject(qt.number, tok("x"))).toBe(false);
  });

  it("only the service role can call the client functions", async () => {
    for (const who of ["anon", { userId: owner }] as const) {
      await expectDenied(as(who, (q) => q("select public.portal_accept_quote($1,$2,'x y','1','ua')", [qt.number, tok("d")])), /permission denied/);
      await expectDenied(as(who, (q) => q("select public.portal_request_quote_changes($1,$2,'x','1','ua')", [qt.number, tok("d")])), /permission denied/);
      await expectDenied(as(who, (q) => q("select public.portal_reject_quote($1,$2,null,'1','ua')", [qt.number, tok("d")])), /permission denied/);
    }
  });

  it("users never write the client's answer", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set client_decision = 'accepted', client_decided_at = now(), client_version = 1 where id = $1", [qt.id])), /only the client/);
  });

  it("changes requested → notified; a new version clears it and the page shows the new offer", async () => {
    expect(await changes(qt.number, tok("d"))).toBe(true);
    const row = await quoteRow(qt.id);
    expect(row).toMatchObject({ client_decision: "changes_requested", client_note: "نبي نغير لون الصالة", client_ip: "1.2.3.4", status: "issued" });
    const n = await asAdmin((q) => q<{ user_id: string; link: string; kind: string }>("select user_id, link, kind from public.notifications where kind = 'quote_changes_requested'"));
    expect(n.rows.map((x) => x.user_id).sort()).toEqual([owner, sup, viewer].sort());
    expect(n.rows[0].link).toBe(`/quotations/${qt.number}`);
    // a new version: the request is cleared, the quote is a draft → the page shows no document until issued
    await as({ userId: owner }, async (q) => {
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,2,'{}','{}','{\"workTypes\":[1]}',9000,0,0,9000)", [org, qt.id]);
      await asServer(q, "update public.quotes set current_version = 2 where id = $1", [qt.id]);
    });
    expect(await quoteRow(qt.id)).toMatchObject({ client_decision: null, client_note: null, status: "draft" });
    const draft = await view(qt.number, tok("d"));
    expect(draft?.quote.client_view).toBeNull();
    await expect(accept(qt.number, tok("d"))).rejects.toThrow(/quote not open/);
    await as({ userId: owner }, (q) => issue(q, qt.id));
    expect((await view(qt.number, tok("d")))?.quote).toMatchObject({ version: 2, client_view: { workTypes: [1] }, decision: null });
  });

  it("accepting keeps the price, needs a name, can't be done twice and freezes the offer", async () => {
    await expect(svc("select public.portal_accept_quote($1,$2,' ','1','ua')", [qt.number, tok("d")])).rejects.toThrow(/name required/);
    // the version on the client's screen (1) is no longer the offer (2) → refused
    await expect(accept(qt.number, tok("d"), 1)).rejects.toThrow(/offer changed/);
    expect(await accept(qt.number, tok("d"), 2)).toBe(true);
    expect(await quoteRow(qt.id)).toMatchObject({ client_decision: "accepted", client_version: 2, client_name: "أبو فهد", status: "issued", current_version: 2 });
    await expect(accept(qt.number, tok("d"), 2)).rejects.toThrow(/already decided/);
    await expect(reject(qt.number, tok("d"))).rejects.toThrow(/already decided/);
    await expect(changes(qt.number, tok("d"))).rejects.toThrow(/already decided/);
    const n = await asAdmin((q) => q<{ c: number }>("select count(*)::int as c from public.notifications where kind = 'quote_accepted'"));
    expect(n.rows[0].c).toBe(3);
    // no new version once the client accepted
    await expectDenied(as({ userId: owner }, async (q) => {
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,3,'{}','{}','{}',1,0,0,1)", [org, qt.id]);
      await asServer(q, "update public.quotes set current_version = 3 where id = $1", [qt.id]);
    }), /client accepted/);
    const audit = await asAdmin((q) => q<{ c: number }>("select count(*)::int as c from public.audit_log where action = 'client_accept_quote' and record_id = $1", [qt.id]));
    expect(audit.rows[0].c).toBe(1);
  });

  it("the contract made from it takes over the same link (quote and contract numbers both open it)", async () => {
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string; number: string } }>("select public.create_contract($1, current_date + 5, 20, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    const l = await asAdmin((q) => q<{ contract_id: string; expires_at: Date; ok: boolean }>(
      "select contract_id, expires_at, expires_at >= ((current_date + 5 + 20 + 30 + interval '6 months')::date::timestamp at time zone 'Asia/Riyadh') as ok from public.client_portal_links where token_hash = $1", [hash(tok("d"))]));
    expect(l.rows[0]).toMatchObject({ contract_id: c.id, ok: true });
    const ver = await asAdmin((q) => q<{ quote_version: number; options: unknown }>("select quote_version, options from public.contracts where id = $1", [c.id]));
    expect(ver.rows[0]).toMatchObject({ quote_version: 2, options: null });
    // draft contract: the page still shows the (accepted) quote, waiting for the contract
    const v = await view(qt.number, tok("d"));
    expect(v).toMatchObject({ stage: "quote", quote: { decision: "accepted" }, contract: { number: c.number, status: "draft" } });
    // sent: same link, contract stage — by the quote number and by the contract number
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'sent' where id = $1", [c.id]));
    const s1 = await view(qt.number, tok("d"));
    expect(s1).toMatchObject({ stage: "contract", contract: { number: c.number, status: "sent" } });
    expect(s1?.quote.client_accepted_at).toBeTruthy();
    expect((await view(c.number, tok("d")))?.stage).toBe("contract");
    // the quote can't be answered any more; the contract is accepted through the same link
    await expect(accept(qt.number, tok("d"))).resolves.toBe(false);
    await svc("select public.portal_accept($1,$2,'أبو فهد',null,'1.1.1.1','x')", [qt.number, tok("d")]);
    const acc = await asAdmin((q) => q<{ status: string }>("select status from public.contracts where id = $1", [c.id]));
    expect(acc.rows[0].status).toBe("accepted");
    // contract-scoped calls work through the quote number too
    const terms = await svc<{ t: unknown }>("select public.portal_warranty($1,$2) as t", [qt.number, tok("d")]);
    expect(terms.rows[0].t).toMatchObject({ contract_id: c.id });
    // no new quote link once a contract exists
    await expectDenied(link(owner, qt.id, tok("e")), /quote not issued|contract exists/);
  });

  it("a member restricted to other projects no longer sees the link once it belongs to a contract", async () => {
    const m = await asAdmin((q) => q<{ id: string }>("select id from public.memberships where organization_id = $1 and user_id = $2", [org, sup]));
    await as({ userId: owner }, (q) => q("update public.memberships set project_scope = 'assigned' where id = $1", [m.rows[0].id]));
    const r = await as({ userId: sup }, (q) => q("select id from public.client_portal_links where token_hash = $1", [hash(tok("d"))]));
    expect(r.rows).toHaveLength(0);
    await as({ userId: owner }, (q) => q("update public.memberships set project_scope = 'all' where id = $1", [m.rows[0].id]));
  });
});

describe("options, rejection and expiry", () => {
  it("with options the client must choose one; the contract uses it without offering options again", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q, org, client, [12000, 9500]);
      await q("update public.quotes set options = $2::jsonb where id = $1", [x.id, JSON.stringify([{ version: 1, label: "جوتن" }, { version: 2, label: "الجزيرة" }])]);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("f"));
    const v = await view(qt.number, tok("f"));
    expect(v?.options.map((o) => [o.version, o.label, Number(o.total)])).toEqual([[1, "جوتن", 12000], [2, "الجزيرة", 9500]]);
    await expect(accept(qt.number, tok("f"), null)).rejects.toThrow(/choose an option/);
    await expect(accept(qt.number, tok("f"), 3)).rejects.toThrow(/choose an option/);
    expect(await accept(qt.number, tok("f"), 2)).toBe(true);
    expect(await quoteRow(qt.id)).toMatchObject({ client_decision: "accepted", client_version: 2 });
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    const row = await asAdmin((q) => q<{ quote_version: number; options: unknown; total: string }>("select quote_version, options, total from public.contracts where id = $1", [c.id]));
    expect(row.rows[0]).toMatchObject({ quote_version: 2, options: null });
    expect(Number(row.rows[0].total)).toBe(9500);
  });

  it("a single quote: the client must confirm the version he saw", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("g"));
    await expect(accept(qt.number, tok("g"), 5)).rejects.toThrow(/offer changed/);
    await expect(accept(qt.number, tok("g"), null)).rejects.toThrow(/offer changed/);
  });

  it("declining rejects the quote (lost); issuing again opens it to the client again", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("h"));
    expect(await reject(qt.number, tok("h"), null)).toBe(true);
    expect(await quoteRow(qt.id)).toMatchObject({ status: "rejected", client_decision: "rejected", client_note: null });
    expect((await view(qt.number, tok("h")))?.quote).toMatchObject({ status: "rejected", decision: "rejected" });
    await expect(accept(qt.number, tok("h"))).rejects.toThrow(/quote not open/);
    // no contract from a rejected quote
    await expectDenied(as({ userId: owner }, (q) => q("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb)", [qt.id, PAY])), /quote not issued/);
    await as({ userId: owner }, (q) => issue(q, qt.id));
    expect(await quoteRow(qt.id)).toMatchObject({ status: "issued", client_decision: null });
    expect(await accept(qt.number, tok("h"))).toBe(true);
  });

  it("a declined quote revised with a new version becomes a draft again (issue it to reopen the page)", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("l"));
    expect(await reject(qt.number, tok("l"))).toBe(true);
    await as({ userId: owner }, async (q) => {
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,2,'{}','{}','{}',8000,0,0,8000)", [org, qt.id]);
      await asServer(q, "update public.quotes set current_version = 2 where id = $1", [qt.id]);
    });
    expect(await quoteRow(qt.id)).toMatchObject({ status: "draft", client_decision: null, client_note: null });
    expect((await view(qt.number, tok("l")))?.quote).toMatchObject({ status: "draft", client_view: null });
  });

  it("an expired quote can't be accepted, but the client may still ask for changes", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("i"));
    await asAdmin((q) => q("update public.quotes set valid_until = current_date - 2 where id = $1", [qt.id]));
    await expect(accept(qt.number, tok("i"))).rejects.toThrow(/quote expired/);
    expect(await changes(qt.number, tok("i"), "جددوا العرض")).toBe(true);
  });

  it("a contract made without the client's online acceptance still works (verbal agreement), with options kept", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q, org, client, [5000, 6000]);
      await q("update public.quotes set options = $2::jsonb where id = $1", [x.id, JSON.stringify([{ version: 1, label: "أ" }, { version: 2, label: "ب" }])]);
      await issue(q, x.id);
      return x;
    });
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    const row = await asAdmin((q) => q<{ options: unknown[] }>("select options from public.contracts where id = $1", [c.id]));
    expect(row.rows[0].options).toHaveLength(2);
  });
});

describe("old contract links", () => {
  it("a link issued on the contract number keeps working as before", async () => {
    const { qt, c } = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      const r = await q<{ r: { id: string; number: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [x.id, PAY]);
      return { qt: x, c: r.rows[0].r };
    });
    await as({ userId: owner }, (q) => q("select public.issue_portal_link($1,$2, now() + interval '40 days')", [c.id, hash(tok("j"))]));
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'sent' where id = $1", [c.id]));
    const v = await view(c.number, tok("j"));
    expect(v).toMatchObject({ stage: "contract", contract: { number: c.number } });
    // a contract link is not opened by the quote number
    expect(await view(qt.number, tok("j"))).toBeNull();
    // and the quote functions don't answer through it
    expect(await accept(c.number, tok("j"))).toBe(false);
  });
});

describe("organization isolation", () => {
  it("a quote of another organization can't be linked, and a token never opens another org's number", async () => {
    const qb = await as({ userId: other }, async (q) => {
      const x = await newQuote(q, orgB, clientB);
      await issue(q, x.id);
      return x;
    });
    await expectDenied(link(owner, qb.id, tok("k")), /not allowed/);
    await link(other, qb.id, tok("k"));
    // org A's quote number with org B's token → nothing
    const a = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q);
      await issue(q, x.id);
      return x;
    });
    if (a.number !== qb.number) expect(await view(a.number, tok("k"))).toBeNull();
    expect((await view(qb.number, tok("k")))?.client.name).toBe("عميل ب");
  });
});

describe("review fixes", () => {
  const mk = () => as({ userId: owner }, async (q) => {
    const x = await newQuote(q);
    await issue(q, x.id);
    return x;
  });
  const newVersion = (id: string, v: number) => as({ userId: owner }, async (q) => {
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,$3,'{}','{}','{}',777,0,0,777)", [org, id, v]);
    await asServer(q, "update public.quotes set current_version = $2 where id = $1", [id, v]);
  });

  it("a quote being revised sends no total or version to the client", async () => {
    const qt = await mk();
    await link(owner, qt.id, tok("m"));
    await newVersion(qt.id, 2);
    const v = await view(qt.number, tok("m"));
    expect(v?.quote).toMatchObject({ status: "draft", client_view: null, total: null, version: null });
  });

  it("a contract from a quote the client accepted keeps his version and no options (direct writes refused)", async () => {
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q, org, client, [4000, 4500]);
      await q("update public.quotes set options = $2::jsonb where id = $1", [x.id, JSON.stringify([{ version: 1, label: "أ" }, { version: 2, label: "ب" }])]);
      await issue(q, x.id);
      return x;
    });
    await link(owner, qt.id, tok("n"));
    expect(await accept(qt.number, tok("n"), 2)).toBe(true);
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set quote_version = 1 where id = $1", [c.id])), /client accepted/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set options = $2::jsonb where id = $1", [c.id, JSON.stringify([{ version: 1, label: "أ" }, { version: 2, label: "ب" }])])), /client accepted/);
  });

  it("cancelling a draft contract gives the link back to the quote and reopens the accepted offer", async () => {
    const qt = await mk();
    await link(owner, qt.id, tok("o"));
    expect(await accept(qt.number, tok("o"))).toBe(true);
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'cancelled' where id = $1", [c.id]));
    const l = await asAdmin((q) => q<{ contract_id: string | null; revoked_at: Date | null }>("select contract_id, revoked_at from public.client_portal_links where token_hash = $1", [hash(tok("o"))]));
    expect(l.rows[0]).toMatchObject({ contract_id: null, revoked_at: null });
    expect(await quoteRow(qt.id)).toMatchObject({ status: "issued", client_decision: null });
    expect(await view(qt.number, tok("o"))).toMatchObject({ stage: "quote", contract: null, quote: { decision: null } });
    // the quote can be revised again, and the client can answer again
    await newVersion(qt.id, 2);
    await as({ userId: owner }, (q) => issue(q, qt.id));
    expect(await accept(qt.number, tok("o"), 2)).toBe(true);
  });

  it("cancelling a contract made without the client's acceptance also hands the link back", async () => {
    const qt = await mk();
    await link(owner, qt.id, tok("p"));
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'cancelled' where id = $1", [c.id]));
    expect(await view(qt.number, tok("p"))).toMatchObject({ stage: "quote", contract: null });
    expect(await changes(qt.number, tok("p"))).toBe(true);
  });

  it("cancelling an ACCEPTED contract never hands its link back to the quote (the page closes, expiry untouched)", async () => {
    const qt = await mk();
    await link(owner, qt.id, tok("x"));
    expect(await accept(qt.number, tok("x"))).toBe(true);
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    // the client signed the contract (set as the server would, past the user guards)
    await asAdmin((q) => q("update public.contracts set status = 'accepted', accepted_at = now() where id = $1", [c.id]));
    const before = await asAdmin((q) => q<{ expires_at: Date }>("select expires_at from public.client_portal_links where token_hash = $1", [hash(tok("x"))]));
    await asAdmin((q) => q("update public.contracts set status = 'cancelled' where id = $1", [c.id]));
    const l = await asAdmin((q) => q<{ contract_id: string | null; expires_at: Date }>("select contract_id, expires_at from public.client_portal_links where token_hash = $1", [hash(tok("x"))]));
    expect(l.rows[0].contract_id).toBe(c.id);
    expect(l.rows[0].expires_at.getTime()).toBe(before.rows[0].expires_at.getTime());
    expect((await quoteRow(qt.id)).client_decision).toBe("accepted");
    expect(await view(qt.number, tok("x"))).toBeNull();
  });

  it("renewing the validity or issuing again clears a change request", async () => {
    const qt = await mk();
    await link(owner, qt.id, tok("q"));
    expect(await changes(qt.number, tok("q"))).toBe(true);
    // issued again with the same date
    const d = (await quoteRow(qt.id)).valid_until;
    await as({ userId: owner }, (q) => q("select public.issue_quote($1, $2)", [qt.id, d]));
    expect(await quoteRow(qt.id)).toMatchObject({ status: "issued", client_decision: null });
    expect(await changes(qt.number, tok("q"))).toBe(true);
    await as({ userId: owner }, (q) => q("update public.quotes set valid_until = current_date + 20 where id = $1", [qt.id]));
    expect(await quoteRow(qt.id)).toMatchObject({ client_decision: null });
  });
});
