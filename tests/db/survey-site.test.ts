import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * The survey keeps its own site (owner, Nov 2026): a survey is booked before the visit at «the
 * client's site» or «another site» (a second villa) and keeps it even with no contract. A project's
 * site = its own pin, else its survey's (contract → quote → survey), else the client's.
 */
let owner: string, sup: string, viewer: string, org: string, contract: string, client: string, survey: string;
const TOKEN = "Abcdefghijklmnop";
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const visit = (lat: number, lng: number) =>
  as({ userId: sup }, (q) => q("insert into public.site_visits (organization_id, contract_id, latitude, longitude, accuracy_m) values ($1,$2,$3,$4,10)", [org, contract, lat, lng]));
const sites = () => as({ userId: sup }, (q) => q<{ latitude: string; own: boolean; source: string }>("select latitude, own, source from public.project_site_list($1)", [org])).then((r) => r.rows);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009601");
  sup = await createUser("966500009602");
  viewer = await createUser("966500009603");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  let number = "";
  await as({ userId: owner }, async (q) => {
    await q("select public.seed_starter_catalogue($1)", [org]);
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'), ($1,$3,'viewer')", [org, sup, viewer]);
    // the client's own site (his house)
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, latitude, longitude) values ($1,'عميل',24.7000,46.6000) returning id", [org])).rows[0].id;
    // the survey at a second villa, booked before the visit
    survey = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode, visit_date, visit_time, latitude, longitude, site_city, site_district) values ($1,$2,'rooms','2026-12-01','09:30',24.8031,46.6105,'الرياض','الملقا') returning id", [org, client])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, survey])).rows[0].id;
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

describe("survey site", () => {
  it("is a pair, in range; its time and place are stored", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.surveys set latitude = null where id = $1", [survey])), /surveys_pin_pair/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.surveys set latitude = 95 where id = $1", [survey])), /check constraint/);
    const r = await as({ userId: owner }, (q) => q<{ visit_time: string; site_district: string }>("select visit_time::text, site_district from public.surveys where id = $1", [survey]));
    expect(r.rows[0]).toEqual({ visit_time: "09:30:00", site_district: "الملقا" });
  });
  it("only clients.manage changes it", async () => {
    await as({ userId: viewer }, (q) => q("update public.surveys set latitude = 1, longitude = 1 where id = $1", [survey]));
    const r = await as({ userId: owner }, (q) => q<{ latitude: string }>("select latitude from public.surveys where id = $1", [survey]));
    expect(r.rows[0].latitude).toBe("24.803100");
  });
  it("the project takes its survey's site (not the client's house): check-in measured there", async () => {
    expect(await sites()).toEqual([{ latitude: "24.803100", own: false, source: "survey" }]);
    // at the client's house (~12 km away) → refused; at the villa → recorded
    await expectDenied(visit(24.7001, 46.6001), /visit too far/);
    await visit(24.8032, 46.6106);
  });
  it("the contract says where the project is (the survey's district, not the client's house) — on the client page too", async () => {
    const c = await as({ userId: owner }, (q) => q<{ site_city: string; site_district: string }>("select site_city, site_district from public.contracts where id = $1", [contract]));
    expect(c.rows[0]).toEqual({ site_city: "الرياض", site_district: "الملقا" });
    const number = (await as({ userId: owner }, (q) => q<{ number: string }>("select number from public.contracts where id = $1", [contract]))).rows[0].number;
    const v = await as("service_role", (q) => q<{ v: { client: { site_district: string } } }>("select public.portal_view($1,$2) as v", [number, TOKEN]));
    expect(v.rows[0].v.client.site_district).toBe("الملقا");
  });
  it("once accepted, the project keeps the survey's site: moving the survey later doesn't move a running project", async () => {
    const ps = await as({ userId: owner }, (q) => q<{ latitude: string; from_survey: boolean }>("select latitude, from_survey from public.project_sites where contract_id = $1", [contract]));
    expect(ps.rows).toEqual([{ latitude: "24.803100", from_survey: true }]);
    await as({ userId: owner }, (q) => q("update public.surveys set latitude = 24.9500, longitude = 46.7000, site_district = 'النخيل' where id = $1", [survey]));
    expect(await sites()).toEqual([{ latitude: "24.803100", own: false, source: "survey" }]);
    // the accepted contract's text is frozen too
    const c = await as({ userId: owner }, (q) => q<{ site_district: string }>("select site_district from public.contracts where id = $1", [contract]));
    expect(c.rows[0].site_district).toBe("الملقا");
    const place = await as({ userId: sup }, (q) => q<{ city: string; district: string }>("select city, district from public.project_site_list($1)", [org]));
    expect(place.rows[0]).toEqual({ city: "الرياض", district: "الملقا" });
    await as({ userId: owner }, (q) => q("update public.surveys set latitude = 24.8031, longitude = 46.6105, site_district = 'الملقا' where id = $1", [survey]));
  });
  it("the project's own pin still wins; without one and without a survey site, the client's", async () => {
    await as({ userId: owner }, (q) => q("insert into public.project_sites (organization_id, contract_id, latitude, longitude) values ($1,$2,24.9000,46.6000) on conflict (contract_id) do update set latitude = excluded.latitude, longitude = excluded.longitude, from_survey = false", [org, contract]));
    expect(await sites()).toEqual([{ latitude: "24.900000", own: true, source: "project" }]);
    await as({ userId: owner }, async (q) => {
      await q("delete from public.project_sites where contract_id = $1", [contract]);
      await q("update public.surveys set latitude = null, longitude = null where id = $1", [survey]);
    });
    expect(await sites()).toEqual([{ latitude: "24.700000", own: false, source: "client" }]);
  });
});

describe("a draft contract follows its survey's site until it is accepted", () => {
  it("changing the survey's site updates the draft contract's place", async () => {
    const draft = await as({ userId: owner }, async (q) => {
      const s2 = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode, latitude, longitude, site_city, site_district) values ($1,$2,'rooms',24.6,46.7,'الرياض','لبن') returning id", [org, client])).rows[0].id;
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, s2])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,10,1000) returning id", [org, quote, client])).rows[0].id;
      await q("update public.surveys set site_district = 'ظهرة لبن' where id = $1", [s2]);
      return c;
    });
    const c = await as({ userId: owner }, (q) => q<{ site_district: string }>("select site_district from public.contracts where id = $1", [draft]));
    expect(c.rows[0].site_district).toBe("ظهرة لبن");
  });
});

describe("an accepted project's site never follows later survey edits (review round 2)", () => {
  let c2: string, s2: string;
  beforeAll(async () => {
    // a survey at the client's site → contract accepted → then someone gives the survey its own site
    let number = "";
    await as({ userId: owner }, async (q) => {
      s2 = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode) values ($1,$2,'rooms') returning id", [org, client])).rows[0].id;
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, s2])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'sent') returning id, number", [org, quote, client])).rows[0];
      c2 = c.id;
      number = c.number;
      await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,1000,'custom')", [org, c2]);
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, c2, hash("Zbcdefghijklmnop")]);
    });
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [number, "Zbcdefghijklmnop"]));
  });
  const site = () => as({ userId: sup }, (q) => q<{ latitude: string; source: string }>("select latitude, source from public.project_site_list($1) where contract_id = $2", [org, c2])).then((r) => r.rows[0]);
  it("a survey given its own site after acceptance doesn't move the project (check-in stays at the agreed place)", async () => {
    // the client's pin may have changed in earlier tests: read it now
    const before = await site();
    await as({ userId: owner }, (q) => q("update public.surveys set latitude = 25.1, longitude = 46.9, site_city = 'الرياض', site_district = 'بعيد' where id = $1", [s2]));
    expect(await site()).toEqual(before);
    const cs = await as({ userId: sup }, (q) => q<{ lat: string }>("select lat from private.contract_site($1)", [c2]));
    expect(cs.rows[0].lat).toBe(before.latitude);
  });
  it("«back to the main site» after a project pin returns to the pin copied at acceptance, not the survey's current one", async () => {
    // contract 1 (accepted with the survey's pin 24.8031): owner sets a project pin, then goes back
    // state as after acceptance (pin copied from the survey: 24.8031) then a project pin set on the project page
    await asAdmin((q) => q("insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, survey_latitude, survey_longitude) values ($1,$2,24.9,46.6,false,24.8031,46.6105) on conflict (contract_id) do update set latitude = 24.9, longitude = 46.6, from_survey = false, survey_latitude = 24.8031, survey_longitude = 46.6105", [org, contract]));
    await as({ userId: owner }, (q) => q("update public.surveys set latitude = 25.2, longitude = 46.95 where id = $1", [survey]));
    await as({ userId: owner }, (q) => q("select public.reset_project_site($1)", [contract]));
    const r = await as({ userId: sup }, (q) => q<{ latitude: string; source: string }>("select latitude, source from public.project_site_list($1) where contract_id = $2", [org, contract]));
    expect(r.rows[0]).toEqual({ latitude: "24.803100", source: "survey" });
  });
});

describe("a survey's own site without names never reads as the client's house (review round 2)", () => {
  it("the place is empty, not the client's district; re-pointing a draft's quote re-reads it", async () => {
    const r = await as({ userId: owner }, async (q) => {
      const s3 = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode, latitude, longitude) values ($1,$2,'rooms',24.61,46.71) returning id", [org, client])).rows[0].id;
      const mk = async (sv: string | null) => {
        const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, sv])).rows[0].id;
        await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
        await q("select public.issue_quote($1, null)", [quote]);
        return quote;
      };
      const withSite = await mk(s3);
      const plain = await mk(null);
      const c = (await q<{ id: string; site_own: boolean; site_district: string | null }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,10,1000) returning id, site_own, site_district", [org, withSite, client])).rows[0];
      const moved = (await q<{ site_own: boolean }>("update public.contracts set quote_id = $2 where id = $1 returning site_own", [c.id, plain])).rows[0];
      return { c, moved };
    });
    expect(r.c.site_own).toBe(true);
    expect(r.c.site_district).toBeNull();
    expect(r.moved.site_own).toBe(false);
  });
  it("users can't write the place themselves", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set site_own = true, site_district = 'x' where status = 'draft'")), /comes from its survey/);
  });
});

describe("frozen once sent to the client (owner, Nov 2026)", () => {
  it("a sent contract keeps its place and pin when the survey moves; a draft still follows", async () => {
    const r = await as({ userId: owner }, async (q) => {
      const s4 = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode, latitude, longitude, site_city, site_district) values ($1,$2,'rooms',24.62,46.72,'الرياض','الروضة') returning id", [org, client])).rows[0].id;
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, s4])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,10,1000) returning id", [org, quote, client])).rows[0].id;
      // draft: follows the survey
      await q("update public.surveys set site_district = 'الروضة الشرقية' where id = $1", [s4]);
      const draft = (await q<{ site_district: string }>("select site_district from public.contracts where id = $1", [c])).rows[0].site_district;
      // sent to the client: frozen from here
      await q("update public.contracts set status = 'sent' where id = $1", [c]);
      await q("update public.surveys set latitude = 25.0, longitude = 47.0, site_district = 'بعيد' where id = $1", [s4]);
      const sent = (await q<{ site_district: string }>("select site_district from public.contracts where id = $1", [c])).rows[0].site_district;
      return { c, draft, sent };
    });
    expect(r.draft).toBe("الروضة الشرقية");
    expect(r.sent).toBe("الروضة الشرقية");
    const site = await as({ userId: sup }, (q) => q<{ latitude: string; source: string }>("select latitude, source from public.project_site_list($1) where contract_id = $2", [org, r.c]));
    expect(site.rows[0]).toEqual({ latitude: "24.620000", source: "survey" });
    const cs = await as({ userId: owner }, (q) => q<{ lat: string }>("select lat from private.contract_site($1)", [r.c]));
    expect(cs.rows[0].lat).toBe("24.620000");
  });
});

describe("frozen once sent — the other paths (review)", () => {
  const mk = async (q: Parameters<Parameters<typeof as>[1]>[0], surveyPin: [number, number] | null, status: "draft" | "sent") => {
    const sv = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode, latitude, longitude, site_city, site_district) values ($1,$2,'rooms',$3,$4,$5,$6) returning id",
      [org, client, surveyPin?.[0] ?? null, surveyPin?.[1] ?? null, surveyPin ? "الرياض" : null, surveyPin ? "القيروان" : null])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, sv])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,$4) returning id", [org, quote, client, status])).rows[0].id;
    return { sv, c };
  };
  const listed = (c: string) => as({ userId: sup }, (q) => q<{ latitude: string; source: string; district: string | null }>("select latitude, source, district from public.project_site_list($1) where contract_id = $2", [org, c])).then((r) => r.rows[0]);

  it("a contract at the client's site: sending freezes his pin and address; later client edits don't change it", async () => {
    await as({ userId: owner }, (q) => q("update public.clients set latitude = 24.70, longitude = 46.60, city = 'الرياض', district = 'العليا' where id = $1", [client]));
    const { c } = await as({ userId: owner }, async (q) => {
      const r = await mk(q, null, "draft");
      await q("update public.contracts set status = 'sent' where id = $1", [r.c]);
      await q("update public.clients set latitude = 24.90, longitude = 46.90, district = 'النخيل' where id = $1", [client]);
      return r;
    });
    expect(await listed(c)).toEqual({ latitude: "24.700000", source: "client", district: "العليا" });
    const t = await as({ userId: owner }, (q) => q<{ site_district: string }>("select site_district from public.contracts where id = $1", [c]));
    expect(t.rows[0].site_district).toBe("العليا");
    await as({ userId: owner }, (q) => q("update public.clients set latitude = 24.70, longitude = 46.60, district = 'العليا' where id = $1", [client]));
  });
  it("inserted directly as sent: frozen too; accepting later doesn't re-copy a moved survey", async () => {
    const { sv, c } = await as({ userId: owner }, (q) => mk(q, [24.63, 46.73], "sent"));
    await as({ userId: owner }, (q) => q("update public.surveys set latitude = 25.3, longitude = 47.3 where id = $1", [sv]));
    expect((await listed(c)).latitude).toBe("24.630000");
  });
  it("taken back to draft: follows its survey again", async () => {
    const { sv, c } = await as({ userId: owner }, async (q) => {
      const r = await mk(q, [24.64, 46.74], "sent");
      await q("update public.surveys set latitude = 24.65, longitude = 46.75, site_district = 'الياسمين' where id = $1", [r.sv]);
      return r;
    });
    await asAdmin((a) => a("update public.contracts set status = 'draft' where id = $1", [c]));
    expect(await listed(c)).toEqual({ latitude: "24.650000", source: "survey", district: "الياسمين" });
    void sv;
  });
  it("users can't move or drop a sent (not accepted) contract's frozen pin, nor mark a pin as copied", async () => {
    const { c } = await as({ userId: owner }, (q) => mk(q, [24.66, 46.76], "sent"));
    await expectDenied(as({ userId: owner }, (q) => q("update public.project_sites set latitude = 24.0 where contract_id = $1", [c])), /accepted/);
    await expectDenied(as({ userId: owner }, (q) => q("delete from public.project_sites where contract_id = $1", [c])), /accepted/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.project_sites set survey_latitude = 1 where contract_id = $1", [contract])), /database/);
  });
});

describe("frozen once sent — reopened contracts (review)", () => {
  it("a cancelled contract sent again freezes the survey's pin; back to draft from cancelled follows the survey", async () => {
    const r = await as({ userId: owner }, async (q) => {
      const sv = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode, latitude, longitude, site_city, site_district) values ($1,$2,'rooms',24.67,46.77,'الرياض','الصحافة') returning id", [org, client])).rows[0].id;
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, survey_id) values ($1,$2,'gypsum',$3) returning id", [org, client, sv])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,10,1000) returning id", [org, quote, client])).rows[0].id;
      return { sv, c };
    });
    await asAdmin((q) => q("update public.contracts set status = 'cancelled' where id = $1", [r.c]));
    await asAdmin((q) => q("update public.contracts set status = 'sent' where id = $1", [r.c]));
    const sent = await as({ userId: owner }, (q) => q<{ lat: string }>("select lat from private.contract_site($1)", [r.c]));
    expect(sent.rows[0].lat).toBe("24.670000");
    await asAdmin((q) => q("update public.contracts set status = 'cancelled' where id = $1", [r.c]));
    await asAdmin((q) => q("update public.contracts set status = 'draft' where id = $1", [r.c]));
    await as({ userId: owner }, (q) => q("update public.surveys set latitude = 24.68, longitude = 46.78 where id = $1", [r.sv]));
    const draft = await as({ userId: owner }, (q) => q<{ lat: string }>("select lat from private.contract_site($1)", [r.c]));
    expect(draft.rows[0].lat).toBe("24.680000");
  });
});

describe("the survey page's contract note (review)", () => {
  it("clients.view is enough (no quotes.view); another organization sees nothing", async () => {
    const clerk = await createUser("966500009604");
    await as({ userId: owner }, (q) => q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'viewer','{"grant":[],"deny":["quotes.view"]}')`, [org, clerk]));
    // RLS alone shows him no contract (quotes.view denied)…
    expect((await as({ userId: clerk }, (q) => q("select id from public.contracts"))).rowCount).toBe(0);
    const r = await as({ userId: clerk }, (q) => q<{ status: string }>("select status from public.survey_contracts($1)", [survey]));
    expect(r.rows.map((x) => x.status)).toContain("accepted");
    const other = await createUser("966500009605");
    expect((await as({ userId: other }, (q) => q("select * from public.survey_contracts($1)", [survey]))).rowCount).toBe(0);
  });
});
