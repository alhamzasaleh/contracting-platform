import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Check-in only on site (owner, Nov 2026): a supervisor can record a visit only with the phone's
 * position, accurate to 150 m, within 300 m of the project's site pin — enforced by the database
 * (the app can't be bypassed), against the pin stored on the client (never the phone's word).
 */
let owner: string, sup: string, org: string, contract: string, client: string;
const TOKEN = "Abcdefghijklmnop";
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const visit = (lat: number | null, lng: number | null, acc: number | null) =>
  as({ userId: sup }, (q) => q("insert into public.site_visits (organization_id, contract_id, latitude, longitude, accuracy_m) values ($1,$2,$3,$4,$5)", [org, contract, lat, lng, acc]));

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009501");
  sup = await createUser("966500009502");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  let number = "";
  await as({ userId: owner }, async (q) => {
    await q("select public.seed_starter_catalogue($1)", [org]);
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, sup]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, phone, name, id_number) values ($1,'966500008888','عميل','1000000008') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'sent') returning id, number", [org, quote, client])).rows[0];
    contract = c.id;
    number = c.number;
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,1000,'custom')", [org, contract]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [number, TOKEN]));
});
afterAll(closePool);

describe("check-in only on site", () => {
  it("refused while the project's site isn't set", async () => {
    await expectDenied(visit(24.8031, 46.6105, 10), /project site not set/);
  });
  it("refused without the phone's position, or with a poor one", async () => {
    await as({ userId: owner }, (q) => q("update public.clients set latitude = 24.8031, longitude = 46.6105 where id = $1", [client]));
    await expectDenied(visit(null, null, null), /visit needs location/);
    await expectDenied(visit(24.8031, 46.6105, null), /visit location inaccurate/);
    await expectDenied(visit(24.8031, 46.6105, 400), /visit location inaccurate/);
  });
  it("refused beyond 300 m, saying how far", async () => {
    // ~1.1 km north
    await expectDenied(visit(24.8131, 46.6105, 10), /visit too far:11\d\d/);
  });
  it("recorded on site (within 300 m, accuracy ≤ 150 m)", async () => {
    await visit(24.8040, 46.6110, 25);
    const n = await as({ userId: sup }, (q) => q<{ n: number }>("select count(*)::int n from public.site_visits where contract_id = $1", [contract]));
    expect(n.rows[0].n).toBe(1);
  });

  it("a project's own site wins over the client's (a client with two villas)", async () => {
    // the client's pin is in one district, this project's villa ~2 km away
    await as({ userId: owner }, (q) => q("insert into public.project_sites (organization_id, contract_id, latitude, longitude) values ($1,$2,24.8211,46.6105)", [org, contract]));
    await expectDenied(visit(24.8031, 46.6105, 10), /visit too far/);
    await visit(24.8212, 46.6106, 10);
  });
  it("the sites list: projects.view is enough (a supervisor without clients.view); another organization sees nothing", async () => {
    const r = await as({ userId: sup }, (q) => q<{ contract_id: string; latitude: string; own: boolean }>("select contract_id, latitude, own from public.project_site_list($1)", [org]));
    expect(r.rows).toEqual([{ contract_id: contract, latitude: "24.821100", own: true }]);
    const other = await createUser("966500009503");
    const none = await as({ userId: other }, (q) => q("select * from public.project_site_list($1)", [org]));
    expect(none.rowCount).toBe(0);
  });
  it("only projects.manage sets a project's site", async () => {
    const viewer = await createUser("966500009504");
    await as({ userId: owner }, (q) => q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]));
    await as({ userId: viewer }, (q) => q("update public.project_sites set latitude = 1 where contract_id = $1", [contract]));
    const r = await as({ userId: owner }, (q) => q<{ latitude: string }>("select latitude from public.project_sites where contract_id = $1", [contract]));
    expect(r.rows[0].latitude).toBe("24.821100");
  });
});
