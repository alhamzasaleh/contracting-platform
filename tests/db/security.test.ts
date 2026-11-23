import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Proves the tenant isolation and permission rules hold at the database
 * level — i.e. even if the app had a bug, the database would refuse.
 */

let ownerA: string;
let ownerB: string;
let viewerA: string;
let supervisorA: string;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  await resetDatabase();
  ownerA = await createUser("966500000001", "Owner A");
  ownerB = await createUser("966500000002", "Owner B");
  viewerA = await createUser("966500000003", "Viewer A");
  supervisorA = await createUser("966500000004", "Supervisor A");
});

afterAll(closePool);

describe("organization bootstrap", () => {
  it("lets the very first user create the organization and become owner", async () => {
    orgA = await as({ userId: ownerA }, async (q) => {
      const r = await q<{ id: string }>("select public.create_organization('Saleh Finishing') as id");
      return r.rows[0].id;
    });
    const m = await asAdmin((q) =>
      q("select role from public.memberships where organization_id = $1 and user_id = $2", [
        orgA,
        ownerA,
      ]),
    );
    expect(m.rows[0].role).toBe("owner");
  });

  it("refuses a second organization while self sign-up is closed", async () => {
    await expectDenied(
      as({ userId: ownerB }, (q) => q("select public.create_organization('Intruder Co')")),
      /sign-up is closed/,
    );
  });

  it("refuses unauthenticated organization creation", async () => {
    await expectDenied(
      as("anon", (q) => q("select public.create_organization('Anon Co')")),
      /permission denied/,
    );
  });

  it("allows a second tenant once self sign-up is on (SaaS mode)", async () => {
    await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
    orgB = await as({ userId: ownerB }, async (q) => {
      const r = await q<{ id: string }>("select public.create_organization('Other Co') as id");
      return r.rows[0].id;
    });
    await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
    expect(orgB).toBeTruthy();
  });

  it("seeds members of org A", async () => {
    await as({ userId: ownerA }, async (q) => {
      await q(
        "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'supervisor')",
        [orgA, viewerA, supervisorA],
      );
    });
  });
});

describe("tenant isolation", () => {
  it("never shows another organization", async () => {
    const rows = await as({ userId: ownerA }, (q) => q("select id from public.organizations"));
    expect(rows.rows.map((r) => r.id)).toEqual([orgA]);
  });

  it("never shows another organization's members", async () => {
    const rows = await as({ userId: ownerA }, (q) =>
      q("select organization_id from public.memberships"),
    );
    expect(new Set(rows.rows.map((r) => r.organization_id))).toEqual(new Set([orgA]));
  });

  it("owner can save every company-settings field (incl. the contract signatory)", async () => {
    const r = await as({ userId: ownerA }, (q) =>
      q("update public.organizations set name = name, legal_name = legal_name, cr_number = cr_number, vat_number = vat_number, phone = phone, email = email, city = city, address = address, signatory_name = 'صالح', signatory_title = 'المالك' where id = $1", [orgA]),
    );
    expect(r.rowCount).toBe(1);
  });

  it("cannot update another organization (silently affects 0 rows)", async () => {
    const r = await as({ userId: ownerA }, (q) =>
      q("update public.organizations set name = 'Hacked' where id = $1", [orgB]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("cannot add itself to another organization", async () => {
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
          orgB,
          ownerA,
        ]),
      ),
      /row-level security|permission denied|only an owner/,
    );
  });

  it("cannot read another organization's audit log", async () => {
    const r = await as({ userId: ownerA }, (q) =>
      q("select count(*)::int as n from public.audit_log where organization_id = $1", [orgB]),
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("cannot read profiles of users outside its organizations", async () => {
    const r = await as({ userId: ownerA }, (q) =>
      q("select id from public.profiles where id = $1", [ownerB]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("gives anonymous callers no table access at all", async () => {
    for (const table of ["organizations", "memberships", "profiles", "audit_log", "member_invitations"]) {
      await expectDenied(as("anon", (q) => q(`select * from public.${table}`)), /permission denied/);
    }
  });
});

describe("roles and permissions", () => {
  it("lets a viewer read the organization but not change settings", async () => {
    const r = await as({ userId: viewerA }, (q) => q("select name from public.organizations"));
    expect(r.rows[0].name).toBe("Saleh Finishing");
    const u = await as({ userId: viewerA }, (q) =>
      q("update public.organizations set name = 'Viewer edit' where id = $1", [orgA]),
    );
    expect(u.rowCount).toBe(0);
  });

  it("hides the audit log from a viewer", async () => {
    const r = await as({ userId: viewerA }, (q) => q("select count(*)::int as n from public.audit_log"));
    expect(r.rows[0].n).toBe(0);
  });

  it("returns the right permission list per role", async () => {
    const owner = await as({ userId: ownerA }, (q) =>
      q<{ p: string[] }>("select public.my_permissions($1) as p", [orgA]),
    );
    expect(owner.rows[0].p).toContain("settings.manage");
    const viewer = await as({ userId: viewerA }, (q) =>
      q<{ p: string[] }>("select public.my_permissions($1) as p", [orgA]),
    );
    expect(viewer.rows[0].p).toEqual(["clients.view", "projects.view", "quotes.view", "schedule.view"]);
  });

  it("applies grant/deny overrides", async () => {
    await as({ userId: ownerA }, (q) =>
      q(
        `update public.memberships set permission_overrides = '{"grant":["reports.view"],"deny":["schedule.view"]}'
         where organization_id = $1 and user_id = $2`,
        [orgA, viewerA],
      ),
    );
    const viewer = await as({ userId: viewerA }, (q) =>
      q<{ p: string[] }>("select public.my_permissions($1) as p", [orgA]),
    );
    expect(viewer.rows[0].p).toContain("reports.view");
    expect(viewer.rows[0].p).not.toContain("schedule.view");
  });

  it("stops a viewer from changing its own role", async () => {
    const r = await as({ userId: viewerA }, (q) =>
      q("update public.memberships set role = 'owner' where user_id = $1", [viewerA]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("stops a supervisor with members.manage from escalating", async () => {
    // Give the supervisor members.manage, then try to escalate.
    await as({ userId: ownerA }, (q) =>
      q(
        `update public.memberships set permission_overrides = '{"grant":["members.manage"],"deny":[]}'
         where organization_id = $1 and user_id = $2`,
        [orgA, supervisorA],
      ),
    );
    await expectDenied(
      as({ userId: supervisorA }, (q) =>
        q("update public.memberships set role = 'owner' where organization_id = $1 and user_id = $2", [
          orgA,
          supervisorA,
        ]),
      ),
      /only an owner/,
    );
    await expectDenied(
      as({ userId: supervisorA }, (q) =>
        q(
          `update public.memberships set permission_overrides = '{"grant":["settings.manage"],"deny":[]}'
           where organization_id = $1 and user_id = $2`,
          [orgA, viewerA],
        ),
      ),
      /cannot grant permissions you do not hold/,
    );
    await expectDenied(
      as({ userId: supervisorA }, (q) =>
        q("update public.memberships set status = 'suspended' where organization_id = $1 and user_id = $2", [
          orgA,
          ownerA,
        ]),
      ),
      /only an owner/,
    );
  });

  it("never lets an organization lose its last owner", async () => {
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("update public.memberships set role = 'viewer' where organization_id = $1 and user_id = $2", [
          orgA,
          ownerA,
        ]),
      ),
      /at least one active owner/,
    );
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("delete from public.memberships where organization_id = $1 and user_id = $2", [orgA, ownerA]),
      ),
      /at least one active owner/,
    );
  });

  it("suspended members lose all access", async () => {
    await as({ userId: ownerA }, (q) =>
      q("update public.memberships set status = 'suspended' where organization_id = $1 and user_id = $2", [
        orgA,
        viewerA,
      ]),
    );
    const r = await as({ userId: viewerA }, (q) => q("select id from public.organizations"));
    expect(r.rowCount).toBe(0);
    await as({ userId: ownerA }, (q) =>
      q("update public.memberships set status = 'active' where organization_id = $1 and user_id = $2", [
        orgA,
        viewerA,
      ]),
    );
  });
});

describe("temporary delegation", () => {
  it("passes a permission for a time window only", async () => {
    await as({ userId: ownerA }, (q) =>
      q(
        `insert into public.permission_delegations (organization_id, from_user_id, to_user_id, permissions, ends_at)
         values ($1, $2, $3, '{audit.view}', now() + interval '1 day')`,
        [orgA, ownerA, viewerA],
      ),
    );
    const during = await as({ userId: viewerA }, (q) =>
      q<{ p: string[] }>("select public.my_permissions($1) as p", [orgA]),
    );
    expect(during.rows[0].p).toContain("audit.view");
    const audit = await as({ userId: viewerA }, (q) => q("select count(*)::int as n from public.audit_log"));
    expect(audit.rows[0].n).toBeGreaterThan(0);

    await asAdmin((q) =>
      q("update public.permission_delegations set starts_at = now() - interval '3 days', ends_at = now() - interval '1 day'"),
    );
    const after = await as({ userId: viewerA }, (q) =>
      q<{ p: string[] }>("select public.my_permissions($1) as p", [orgA]),
    );
    expect(after.rows[0].p).not.toContain("audit.view");
  });

  it("refuses delegating a permission you do not hold", async () => {
    await expectDenied(
      as({ userId: viewerA }, (q) =>
        q(
          `insert into public.permission_delegations (organization_id, from_user_id, to_user_id, permissions, ends_at)
           values ($1, $2, $3, '{settings.manage}', now() + interval '1 day')`,
          [orgA, viewerA, supervisorA],
        ),
      ),
      /row-level security/,
    );
  });
});

describe("invitations and phone login allow-list", () => {
  it("only allows OTP for known phones, invited phones, or bootstrap", async () => {
    const check = (phone: string) =>
      as("service_role", (q) =>
        q<{ ok: boolean }>("select public.auth_phone_allowed($1) as ok", [phone]),
      ).then((r) => r.rows[0].ok);

    expect(await check("+966 50 000 0001")).toBe(true);
    expect(await check("966599999999")).toBe(false);

    await as({ userId: ownerA }, (q) =>
      q("insert into public.member_invitations (organization_id, phone, role) values ($1, '+966 59 999 9999', 'supervisor')", [
        orgA,
      ]),
    );
    expect(await check("966599999999")).toBe(true);
  });

  it("is not callable by signed-in users (prevents phone enumeration)", async () => {
    await expectDenied(
      as({ userId: viewerA }, (q) => q("select public.auth_phone_allowed('966599999999')")),
      /permission denied/,
    );
  });

  it("turns the invitation into a membership on first login", async () => {
    const invited = await createUser("966599999999");
    const n = await as({ userId: invited }, (q) =>
      q<{ n: number }>("select public.accept_pending_invitations() as n"),
    );
    expect(n.rows[0].n).toBe(1);
    const r = await as({ userId: invited }, (q) =>
      q("select role from public.memberships where user_id = $1", [invited]),
    );
    expect(r.rows[0].role).toBe("supervisor");
  });

  it("does not let a supervisor invite finance members", async () => {
    await expectDenied(
      as({ userId: supervisorA }, (q) =>
        q("insert into public.member_invitations (organization_id, phone, role) values ($1, '966588888888', 'finance')", [
          orgA,
        ]),
      ),
      /only an owner/,
    );
  });
});

describe("profiles", () => {
  it("lets users edit their own preferences only", async () => {
    await as({ userId: viewerA }, (q) =>
      q("update public.profiles set locale = 'en', numerals = 'arab' where id = $1", [viewerA]),
    );
    const r = await as({ userId: viewerA }, (q) =>
      q("update public.profiles set full_name = 'x' where id = $1", [ownerA]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("does not let users change their verified phone directly", async () => {
    await expectDenied(
      as({ userId: viewerA }, (q) =>
        q("update public.profiles set phone = '966511111111' where id = $1", [viewerA]),
      ),
      /permission denied/,
    );
  });
});

describe("audit log", () => {
  it("records who changed what, with before and after", async () => {
    await as({ userId: ownerA }, (q) =>
      q("update public.organizations set vat_number = '310000000000003' where id = $1", [orgA]),
    );
    const r = await asAdmin((q) =>
      q(
        `select actor_id, action, before ->> 'vat_number' as old_vat, after ->> 'vat_number' as new_vat
         from public.audit_log where table_name = 'organizations' and record_id = $1
         order by id desc limit 1`,
        [orgA],
      ),
    );
    expect(r.rows[0]).toMatchObject({ actor_id: ownerA, action: "update", old_vat: null, new_vat: "310000000000003" });
  });

  it("is append-only for users", async () => {
    await expectDenied(as({ userId: ownerA }, (q) => q("delete from public.audit_log")), /permission denied/);
    await expectDenied(
      as({ userId: ownerA }, (q) => q("update public.audit_log set action = 'x'")),
      /permission denied/,
    );
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("insert into public.audit_log (organization_id, action, table_name) values ($1, 'fake', 'x')", [orgA]),
      ),
      /permission denied/,
    );
  });

  it("rejects invalid company identifiers", async () => {
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("update public.organizations set vat_number = '123' where id = $1", [orgA]),
      ),
      /check constraint/,
    );
  });
});

describe("storage", () => {
  it("lets settings managers upload only into their own organization's folder", async () => {
    await as({ userId: ownerA }, (q) =>
      q("insert into storage.objects (bucket_id, name) values ('org-assets', $1)", [`${orgA}/logo.png`]),
    );
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('org-assets', $1)", [`${orgB}/logo.png`]),
      ),
      /row-level security/,
    );
    await expectDenied(
      as({ userId: ownerA }, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('org-assets', 'not-a-uuid/logo.png')"),
      ),
      /row-level security/,
    );
    await expectDenied(
      as({ userId: viewerA }, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('org-assets', $1)", [`${orgA}/v.png`]),
      ),
      /row-level security/,
    );
  });

  it("hides other organizations' files", async () => {
    await asAdmin((q) =>
      q("insert into storage.objects (bucket_id, name) values ('org-assets', $1)", [`${orgB}/secret.png`]),
    );
    const r = await as({ userId: ownerA }, (q) => q("select name from storage.objects"));
    expect(r.rows.map((x) => x.name)).toEqual([`${orgA}/logo.png`]);
  });
});

describe("rate limiting", () => {
  it("is callable only by the server (service role)", async () => {
    await expectDenied(
      as({ userId: ownerA }, (q) => q("select public.check_rate_limit('x', 1, 60)")),
      /permission denied/,
    );
  });

  it("allows up to the limit, then refuses", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await as("service_role", (q) =>
        q<{ ok: boolean }>("select public.check_rate_limit('otp:966500000009', 3, 600) as ok"),
      );
      results.push(r.rows[0].ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });
});
