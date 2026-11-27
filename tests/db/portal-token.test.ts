import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, resetDatabase } from "./db";

/**
 * Short client-page links (owner, Nov 2026): new tokens are 12 random bytes = 16 base64url
 * characters. The database must accept them in every portal function, still refuse anything
 * shorter, and keep the older 43-character links working.
 */
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const SHORT = randomBytes(12).toString("base64url"); // 16 chars
const OLD = randomBytes(32).toString("base64url"); // 43 chars
const TOO_SHORT = "Abcdefghijklmn0"; // 15 chars

let owner: string, org: string, client: string;
let numShort: string, numOld: string;

async function sentContract(service: string, token: string, extraToken?: string) {
  return as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,$3) returning id", [org, client, service])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{\"total\":10000}',10000,10000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>(
      "insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, project_type, start_date, duration_days, total, status) values ($1,$2,1,$3,$4,'full',current_date + 7,12,10000,'sent') returning id, number",
      [org, quote, client, service],
    )).rows[0];
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'عند التوقيع',100,10000,'custom')", [org, c.id]);
    for (const t of [token, extraToken].filter(Boolean) as string[]) {
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, c.id, hash(t)]);
    }
    return c.number;
  });
}

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000901");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org T') as id")).rows[0].id);
  client = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'أبو فهد','966551230000','1000000008') returning id", [org])).rows[0].id);
  // a link whose stored hash is of a 15-character token: the database must still refuse it
  numShort = await sentContract("interior", SHORT, TOO_SHORT);
  numOld = await sentContract("gypsum", OLD);
});
afterAll(closePool);

const view = (n: string, t: string) => as("service_role", (q) => q<{ v: { contract: { number: string } } | null }>("select public.portal_view($1,$2) as v", [n, t])).then((r) => r.rows[0].v);
const execution = (n: string, t: string) => as("service_role", (q) => q<{ v: { stages: unknown[] } | null }>("select public.portal_execution($1,$2) as v", [n, t])).then((r) => r.rows[0].v);
const accept = (n: string, t: string) => as("service_role", (q) => q<{ ok: boolean }>("select public.portal_accept($1,$2,'فهد العتيبي',null,'1.2.3.4','Safari iPhone') as ok", [n, t])).then((r) => r.rows[0].ok);

describe("client-page token length", () => {
  it("tokens of the test are the lengths the app issues", () => {
    expect(SHORT).toHaveLength(16);
    expect(OLD).toHaveLength(43);
    expect(TOO_SHORT).toHaveLength(15);
  });

  it("a 16-character token opens the page, refuses 15 characters even when its hash is stored", async () => {
    expect((await view(numShort, SHORT))?.contract.number).toBe(numShort);
    expect(await view(numShort, TOO_SHORT)).toBeNull();
    expect(await execution(numShort, TOO_SHORT)).toBeNull();
    expect(await accept(numShort, TOO_SHORT)).toBe(false);
    expect(await view(numShort, SHORT + "x")).toBeNull();
    expect(await view(numShort, "a".repeat(101))).toBeNull();
  });

  it("the client accepts with a 16-character token, then follows the work", async () => {
    expect(await execution(numShort, SHORT)).not.toBeNull();
    expect(await accept(numShort, SHORT)).toBe(true);
    const c = await as({ userId: owner }, (q) => q<{ status: string; accepted_name: string }>("select status, accepted_name from public.contracts where number = $1", [numShort]));
    expect(c.rows[0]).toEqual({ status: "accepted", accepted_name: "فهد العتيبي" });
    const ex = await execution(numShort, SHORT);
    expect(ex?.stages.length).toBeGreaterThan(0);
    for (const fn of ["portal_options", "portal_addenda", "portal_receipts", "portal_invoices", "portal_invoice_docs", "portal_contract_terms", "portal_warranty"]) {
      const r = await as("service_role", (q) => q<{ v: unknown }>(`select public.${fn}($1,$2) as v`, [numShort, SHORT]));
      expect(r.rows[0].v, fn).not.toBeNull();
    }
  });

  it("older 43-character links keep working", async () => {
    expect((await view(numOld, OLD))?.contract.number).toBe(numOld);
    expect(await execution(numOld, OLD)).not.toBeNull();
    expect(await accept(numOld, OLD)).toBe(true);
  });

  it("no function keeps the old 32-character minimum; the portal functions share one check", async () => {
    const r = await asAdmin((q) =>
      q<{ name: string }>(
        "select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and (p.prosrc ~ 'char_length\\(\\s*p_token\\s*\\)\\s*<\\s*32' or p.prosrc ~ '\\{32,')",
      ),
    );
    expect(r.rows.map((x) => x.name)).toEqual([]);
    const users = await asAdmin((q) =>
      q<{ name: string }>("select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ 'char_length\\(\\s*p_token' order by 1"),
    );
    expect(users.rows.map((x) => x.name)).toEqual([]);
    const ok = await asAdmin((q) => q<{ a: boolean; b: boolean; c: boolean; d: boolean; e: boolean }>(
      "select private.portal_token_ok(repeat('a',16)) a, private.portal_token_ok(repeat('a',15)) b, private.portal_token_ok(repeat('a',100)) c, private.portal_token_ok(repeat('a',101)) d, coalesce(private.portal_token_ok(null), false) e",
    ));
    expect(ok.rows[0]).toEqual({ a: true, b: false, c: true, d: false, e: false });
  });

  it("the helper is not callable by API roles", async () => {
    const r = await asAdmin((q) => q<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'private.portal_token_ok(text)', 'execute') anon, has_function_privilege('authenticated', 'private.portal_token_ok(text)', 'execute') auth",
    ));
    expect(r.rows[0]).toEqual({ anon: false, auth: false });
  });
});
