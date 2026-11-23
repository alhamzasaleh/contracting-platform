import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, org: string, orgB: string, service: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500007001");
  ownerB = await createUser("966500007002");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  service = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.services (organization_id, code, name_ar) values ($1,'exterior-paint','دهانات خارجية') returning id", [org])).rows[0].id);
});
afterAll(closePool);

describe("one subcontractor in three places", () => {
  it("an external labour rate creates (or reuses) the subcontractor and its external team", async () => {
    await as({ userId: owner }, (q) => q("insert into public.labour_rates (organization_id, service_id, name, basis, rate) values ($1,$2,'سفيان','external_per_unit',6)", [org, service]));
    const sub = await asAdmin((q) => q<{ id: string; services: string[] }>("select id, services from public.subcontractors where organization_id = $1 and name = 'سفيان'", [org]));
    expect(sub.rows).toHaveLength(1);
    expect(sub.rows[0].services).toEqual(["exterior"]);
    const team = await asAdmin((q) => q<{ kind: string; services: string[] }>("select kind, services from public.teams where subcontractor_id = $1", [sub.rows[0].id]));
    expect(team.rows).toEqual([{ kind: "external", services: ["exterior"] }]);
    // a second rate for the same contractor reuses him
    await as({ userId: owner }, (q) => q("insert into public.labour_rates (organization_id, name, basis, rate) values ($1,'سفيان','external_lump',3000)", [org]));
    expect((await asAdmin((q) => q("select id from public.subcontractors where organization_id = $1", [org]))).rows).toHaveLength(1);
    expect((await asAdmin((q) => q("select id from public.labour_rates where subcontractor_id = $1", [sub.rows[0].id]))).rows).toHaveLength(2);
  });

  it("a subcontractor added in Purchases gets his team; renaming or deactivating follows", async () => {
    const id = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.subcontractors (organization_id, name, services, phone) values ($1,'مؤسسة الجبس','{gypsum}','966500000009') returning id", [org])).rows[0].id);
    await as({ userId: owner }, (q) => q("update public.subcontractors set name = 'مؤسسة الجبس الحديثة', is_active = false where id = $1", [id]));
    const team = await asAdmin((q) => q<{ name: string; is_active: boolean; contact_phone: string }>("select name, is_active, contact_phone from public.teams where subcontractor_id = $1", [id]));
    expect(team.rows).toEqual([{ name: "مؤسسة الجبس الحديثة", is_active: false, contact_phone: "966500000009" }]);
  });

  it("links never cross organizations", async () => {
    const other = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("insert into public.subcontractors (organization_id, name) values ($1,'غريب') returning id", [orgB])).rows[0].id);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.labour_rates (organization_id, name, basis, rate, subcontractor_id) values ($1,'x','external_lump',1,$2)", [org, other])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.teams set subcontractor_id = $1 where organization_id = $2", [other, org])));
  });
});

describe("booking a subcontractor's team prepares his agreement", () => {
  it("takes the quote's rate and area once the contract is accepted", async () => {
    const { rows: [sub] } = await asAdmin((q) => q<{ id: string }>("select id from public.subcontractors where organization_id = $1 and name = 'سفيان'", [org]));
    const { rows: [rate] } = await asAdmin((q) => q<{ id: string }>("select id from public.labour_rates where subcontractor_id = $1 and basis = 'external_per_unit'", [sub.id]));
    const { rows: [team] } = await asAdmin((q) => q<{ id: string }>("select id from public.teams where subcontractor_id = $1", [sub.id]));
    const contract = await as({ userId: owner }, async (q) => {
      const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'exterior','issued') returning id", [org, client])).rows[0].id;
      await q(
        `insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total)
         values ($1,$2,1,$3::jsonb,'{}',$4::jsonb,18480,18480)`,
        [org, quote, JSON.stringify({ labour: { source: "external", externalId: rate.id } }), JSON.stringify({ workTypes: [{ workType: "facades", area: 660, pricePerM2: 28, total: 18480 }] })],
      );
      return (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'exterior',current_date,7,18480,'sent') returning id", [org, quote, client])).rows[0].id;
    });
    // booked before acceptance: nothing yet
    await as({ userId: owner }, (q) => q("insert into public.schedule_entries (organization_id, team_id, contract_id, kind, start_date, end_date) values ($1,$2,$3,'work',current_date,current_date + 6)", [org, team.id, contract]));
    expect((await asAdmin((q) => q("select id from public.subcontractor_agreements where contract_id = $1", [contract]))).rows).toHaveLength(0);
    // the client accepts → the agreement is ready: 6 per m² × 660 m²
    await asAdmin((q) => q("update public.contracts set status = 'accepted', accepted_at = now(), accepted_name = 'عميل' where id = $1", [contract]));
    const a = await asAdmin((q) => q<{ basis: string; rate: string; quantity_m2: string; schedule: string }>("select basis, rate, quantity_m2, schedule from public.subcontractor_agreements where contract_id = $1 and subcontractor_id = $2", [contract, sub.id]));
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ basis: "per_m2", schedule: "progress" });
    expect(Number(a.rows[0].rate)).toBe(6);
    expect(Number(a.rows[0].quantity_m2)).toBe(660);
    // booking him again on the same project doesn't duplicate it
    await as({ userId: owner }, (q) => q("insert into public.schedule_entries (organization_id, team_id, contract_id, kind, start_date, end_date) values ($1,$2,$3,'work',current_date + 7,current_date + 8)", [org, team.id, contract]));
    expect((await asAdmin((q) => q("select id from public.subcontractor_agreements where contract_id = $1", [contract]))).rows).toHaveLength(1);
  });
});

describe("project progress records the subcontractor's work", () => {
  it("adds only the missing part, per m², up to the agreement", async () => {
    const { rows: [c] } = await asAdmin((q) => q<{ id: string }>("select contract_id as id from public.subcontractor_agreements where organization_id = $1 limit 1", [org]));
    const stages = await asAdmin(async (q) => {
      await q("delete from public.project_stages where contract_id = $1", [c.id]);
      const a = (await q<{ id: string }>("insert into public.project_stages (organization_id, contract_id, seq, name) values ($1,$2,1,'تجهيز') returning id", [org, c.id])).rows[0].id;
      const b = (await q<{ id: string }>("insert into public.project_stages (organization_id, contract_id, seq, name, is_final) values ($1,$2,2,'تسليم',true) returning id", [org, c.id])).rows[0].id;
      return [a, b];
    });
    const work = async () =>
      (await asAdmin((q) => q<{ q: string }>("select coalesce(sum(w.quantity_m2),0) as q from public.subcontractor_work w join public.subcontractor_agreements a on a.id = w.agreement_id where a.contract_id = $1", [c.id]))).rows[0].q;
    // stage 1 at 50 % → overall 25 % → 165 m² of 660
    await as({ userId: owner }, (q) => q("update public.project_stages set progress = 50 where id = $1", [stages[0]]));
    expect(Number(await work())).toBe(165);
    // the same progress again adds nothing
    await as({ userId: owner }, (q) => q("update public.project_stages set progress = 50, status = 'in_progress' where id = $1", [stages[0]]));
    expect(Number(await work())).toBe(165);
    // both stages done → the whole 660 m², never more
    await asAdmin((q) => q("update public.project_stages set progress = 100, status = 'confirmed' where contract_id = $1", [c.id]));
    expect(Number(await work())).toBe(660);
  });
});

describe("an external team added in Schedule", () => {
  it("becomes a subcontractor (found by name or created) and stays one team", async () => {
    const team = await as({ userId: owner }, async (q) =>
      (await q<{ id: string }>("insert into public.teams (organization_id, name, kind, services, contact_phone) values ($1,'مؤسسة البلاط','external','{interior}','966500000077') returning id", [org])).rows[0].id);
    const { rows: [t] } = await asAdmin((q) => q<{ subcontractor_id: string | null }>("select subcontractor_id from public.teams where id = $1", [team]));
    expect(t.subcontractor_id).not.toBeNull();
    const sub = await asAdmin((q) => q<{ name: string; phone: string; services: string[] }>("select name, phone, services from public.subcontractors where id = $1", [t.subcontractor_id]));
    expect(sub.rows).toEqual([{ name: "مؤسسة البلاط", phone: "966500000077", services: ["interior"] }]);
    expect((await asAdmin((q) => q("select id from public.teams where organization_id = $1 and name like 'مؤسسة البلاط%'", [org]))).rows).toHaveLength(1);
    // an in-house team stays in-house
    await as({ userId: owner }, (q) => q("insert into public.teams (organization_id, name, kind) values ($1,'فريق الدهان','inhouse')", [org]));
    expect((await asAdmin((q) => q("select id from public.subcontractors where organization_id = $1 and name = 'فريق الدهان'", [org]))).rows).toHaveLength(0);
  });
});
