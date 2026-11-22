/**
 * Database test harness: a fresh Postgres database with a Supabase shim and
 * all migrations applied. Each helper runs inside a transaction that is
 * rolled back, so tests never leak state into one another.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(__dirname, "../..");
export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
export const TEST_DB = process.env.TEST_DATABASE_NAME ?? "contracting_test";

export function testDbUrl() {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

export async function resetDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: testDbUrl() });
  await db.connect();
  await db.query(readFileSync(path.join(ROOT, "supabase/tests/shim/supabase-shim.sql"), "utf8"));
  if (process.env.TEST_DEFAULT_GRANTS !== "off") {
    // Mimic Supabase's default "grant API access to new tables automatically".
    await db.query(`
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    `);
  }
  const dir = path.join(ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(path.join(dir, file), "utf8"));
  }
  await db.end();
}

let pool: pg.Pool | undefined;
export function getPool() {
  pool ??= new pg.Pool({ connectionString: testDbUrl(), max: 30 });
  return pool;
}
export async function closePool() {
  await pool?.end();
  pool = undefined;
}

export type Q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<pg.QueryResult<T>>;

/** Run `fn` as superuser inside a transaction that is committed. */
export async function asAdmin<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client.query.bind(client) as Q);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

type Who = { userId: string } | "anon" | "service_role";

/** Run `fn` with the privileges of an API caller. Commits unless `rollback`. */
export async function as<T>(
  who: Who,
  fn: (q: Q) => Promise<T>,
  opts: { rollback?: boolean } = {},
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    if (who === "anon") {
      await client.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      await client.query("set local role anon");
    } else if (who === "service_role") {
      await client.query(
        "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)",
      );
      await client.query("set local role service_role");
    } else {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: who.userId, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
    }
    const result = await fn(client.query.bind(client) as Q);
    await client.query(opts.rollback ? "rollback" : "commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function createUser(phone: string, fullName?: string): Promise<string> {
  return asAdmin(async (q) => {
    const r = await q<{ id: string }>(
      "insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id",
      [phone, JSON.stringify(fullName ? { full_name: fullName } : {})],
    );
    return r.rows[0].id;
  });
}

/** Expect a promise to fail with a Postgres error whose message matches. */
export async function expectDenied(p: Promise<unknown>, match: RegExp = /./) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!match.test(msg)) throw new Error(`Denied with unexpected message: ${msg}`);
    return msg;
  }
  throw new Error("Expected the database to deny this operation, but it succeeded");
}
