import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAdmin, closePool, resetDatabase } from "./db";

/**
 * Whole-database security invariants (§7). A new migration that forgets RLS,
 * search_path, or opens a function to anonymous callers fails here.
 */
beforeAll(resetDatabase);
afterAll(closePool);

const rows = (sql: string) => asAdmin((q) => q<{ name: string }>(sql)).then((r) => r.rows.map((x) => x.name).sort());

// SECURITY DEFINER functions signed-in users may call — each checks permissions itself.
// Adding one here means you reviewed its checks.
const AUTHENTICATED_DEFINER = [
  "accept_pending_invitations", "approve_payroll_run", "can_create_organization", "claim_push_subscription", "contract_warranties", "create_organization", "create_payroll_run",
  "delete_client", "delete_marketer", "delete_quote", "delete_survey",
  "issue_marketer_link", "issue_portal_link", "issue_quote", "issue_quote_link", "marketer_choices", "log_event", "mark_payroll_paid", "move_stock", "my_permissions", "project_labour_costs", "project_site_list", "qoyod_backfill", "quote_version_quantities", "qoyod_retry", "qoyod_set_key", "qoyod_wake_waiting",
  "record_addendum_payment", "record_client_payment", "record_commission_payment", "revoke_marketer_links", "record_purchase_payment", "request_contract_payment", "requestable_payments", "save_contract_schedule",
  "link_member_employee", "member_employee_links", "schedule_roster", "staff_employee_names", "unlink_employee_account", "seed_employee_cost_items", "seed_pricing_engine", "seed_starter_catalogue", "submit_addendum", "submit_purchase", "team_cost_month",
];

// private SECURITY DEFINER helpers (not trigger functions) signed-in users can execute — RLS
// policies and invoker triggers call them as the user. Each answers only about the caller's own
// organizations (membership filter, or auth.uid()-based). Adding one here means you checked that.
const AUTHENTICATED_PRIVATE_DEFINER = [
  "agreement_contract", "can_access_contract", "contract_site", "has_permission", "is_member", "is_owner", "member_permissions",
  "purchase_contract", "quote_has_open_approvals", "quote_status", "quote_version_total", "shares_organization",
];

describe("security invariants", () => {
  it("every public table has row level security", async () => {
    expect(await rows("select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity")).toEqual([]);
  });

  it("anonymous callers have no table privileges", async () => {
    expect(await rows("select distinct table_name as name from information_schema.role_table_grants where grantee = 'anon' and table_schema in ('public','private')")).toEqual([]);
  });

  it("no public function is callable by anonymous callers", async () => {
    expect(await rows("select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')")).toEqual([]);
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    expect(
      await rows(
        "select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public','private') and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')",
      ),
    ).toEqual([]);
  });

  it("signed-in users can call only the reviewed SECURITY DEFINER functions", async () => {
    expect(await rows("select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')")).toEqual(
      [...AUTHENTICATED_DEFINER].sort(),
    );
  });

  it("signed-in users can call only the reviewed private SECURITY DEFINER helpers", async () => {
    expect(
      await rows(
        "select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.prosecdef and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')",
      ),
    ).toEqual([...AUTHENTICATED_PRIVATE_DEFINER].sort());
  });

  it("the private schema is not reachable by signed-in users", async () => {
    expect(await rows("select distinct table_name as name from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'private'")).toEqual([]);
  });
});
