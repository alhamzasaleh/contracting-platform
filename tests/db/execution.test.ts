import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, viewer: string, ownerB: string;
let org: string, contract: string, draftContract: string;
const year = new Date().getFullYear();
const TOKEN = "tok_" + "e".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const num = () => `C-${year}-001`;
let stages: { id: string; seq: number; is_final: boolean; payment_event: string | null }[] = [];

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001001");
  viewer = await createUser("966500001002");
  ownerB = await createUser("966500001003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("select public.seed_starter_catalogue($1)", [org]);
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    for (const svc of ["gypsum", "interior"]) {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,$3) returning id", [org, client, svc])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,$4,current_date,10,1000,'sent') returning id", [org, quote, client, svc])).rows[0].id;
      if (svc === "gypsum") contract = c;
      else draftContract = c;
    }
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'توقيع',40,400,'signing'),($1,$2,2,'الألواح',30,300,'board_closing'),($1,$2,3,'التسليم',30,300,'handover')", [org, contract]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
});
afterAll(closePool);

describe("execution", () => {
  it("no visits or progress before the client accepts", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.site_visits (organization_id, contract_id, latitude, longitude) values ($1,$2,24.7,46.6)", [org, draftContract])), /accepts the contract/);
  });

  it("accepting the contract creates its stages from the service", async () => {
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [num(), TOKEN]));
    stages = (await as({ userId: owner }, (q) => q<{ id: string; seq: number; is_final: boolean; payment_event: string | null }>("select id, seq, is_final, payment_event from public.project_stages where contract_id = $1 order by seq", [contract]))).rows;
    expect(stages.length).toBe(5);
    expect(stages[2].payment_event).toBe("board_closing");
    expect(stages[4]).toMatchObject({ is_final: true, payment_event: "handover" });
  });

  it("check-in stores GPS with the server time", async () => {
    // a time sent by the phone is ignored — the database stamps its own clock
    const r = await as({ userId: owner }, (q) => q<{ fresh: boolean }>("insert into public.site_visits (organization_id, contract_id, latitude, longitude, accuracy_m, checked_in_at) values ($1,$2,24.71,46.67,8,'2020-01-01') returning checked_in_at > now() - interval '1 minute' as fresh", [org, contract]));
    expect(r.rows[0].fresh).toBe(true);
  });

  it("progress photos must be this contract's files", async () => {
    await as({ userId: owner }, (q) => q("insert into public.progress_updates (organization_id, contract_id, stage_id, progress, photos) values ($1,$2,$3,60,$4)", [org, contract, stages[2].id, [`${org}/${contract}/11111111-1111-1111-1111-111111111111.jpg`]]));
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.progress_updates (organization_id, contract_id, stage_id, progress, photos) values ($1,$2,$3,60,$4)", [org, contract, stages[2].id, ["../../other.jpg"]])), /invalid photo/);
  });

  it("staff send a stage but only the client can confirm it", async () => {
    await as({ userId: owner }, (q) => q("update public.project_stages set status = 'awaiting_client', progress = 100, report = 'تم تركيب الألواح', sent_at = now() where id = $1", [stages[2].id]));
    await expectDenied(as({ userId: owner }, (q) => q("update public.project_stages set status = 'confirmed' where id = $1", [stages[2].id])), /only the client/);
    const ok = await as("service_role", (q) => q<{ ok: boolean }>("select public.portal_confirm_stage($1,$2,$3,'محمد',null,'1.1.1.1','Safari') as ok", [num(), TOKEN, stages[2].id]));
    expect(ok.rows[0].ok).toBe(true);
    const p = await as({ userId: owner }, (q) => q<{ status: string }>("select status from public.contract_payments where contract_id = $1 and due_event = 'board_closing'", [contract]));
    expect(p.rows[0].status).toBe("requested");
    await expectDenied(as({ userId: owner }, (q) => q("update public.project_stages set report = 'x' where id = $1", [stages[2].id])), /can't change/);
  });

  it("the final handover needs the client's signature", async () => {
    await as({ userId: owner }, (q) => q("update public.project_stages set status = 'awaiting_client', progress = 100 where id = $1", [stages[4].id]));
    await expectDenied(as("service_role", (q) => q("select public.portal_confirm_stage($1,$2,$3,'محمد',null,'1.1.1.1','x')", [num(), TOKEN, stages[4].id])), /signature/);
    const ok = await as("service_role", (q) => q<{ ok: boolean }>("select public.portal_confirm_stage($1,$2,$3,'محمد',$4,'1.1.1.1','x') as ok", [num(), TOKEN, stages[4].id, PNG]));
    expect(ok.rows[0].ok).toBe(true);
  });

  it("the client page shows stages and the client's notes; wrong tokens see nothing", async () => {
    const note = await as("service_role", (q) => q<{ id: string }>("select public.portal_add_note($1,$2,null,'فيه شق بالسقف',$3) as id", [num(), TOKEN, [`${org}/${contract}/client/22222222-2222-2222-2222-222222222222.jpg`]]));
    expect(note.rows[0].id).toBeTruthy();
    await expectDenied(as("service_role", (q) => q("select public.portal_add_note($1,$2,null,'x',$3)", [num(), TOKEN, [`${org}/${contract}/33333333-3333-3333-3333-333333333333.jpg`]])), /invalid photo/);
    const v = await as("service_role", (q) => q<{ v: { stages: { report: string | null }[]; notes: unknown[] } }>("select public.portal_execution($1,$2) as v", [num(), TOKEN]));
    expect(v.rows[0].v.stages).toHaveLength(5);
    expect(v.rows[0].v.notes).toHaveLength(1);
    const bad = await as("service_role", (q) => q("select public.portal_execution($1,$2) as v", [num(), TOKEN + "x"]));
    expect(bad.rows[0].v).toBeNull();
    await expectDenied(as("anon", (q) => q("select public.portal_execution($1,$2)", [num(), TOKEN])));
  });

  it("viewers read but can't write; other organizations see nothing", async () => {
    const r = await as({ userId: viewer }, (q) => q("select count(*)::int as n from public.project_stages"));
    expect(r.rows[0].n).toBe(5);
    await expectDenied(as({ userId: viewer }, (q) => q("insert into public.site_visits (organization_id, contract_id) values ($1,$2)", [org, contract])));
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.project_stages) + (select count(*)::int from public.client_notes) + (select count(*)::int from public.site_visits) as n"));
    expect(b.rows[0].n).toBe(0);
    await expectDenied(as({ userId: owner }, (q) => q("update public.client_notes set body = 'x'")), /can't be edited/);
  });
});
