import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { settle } from "@/lib/client/action";

/*
 * Owner report (Nov 2026): adding someone to the team on his phone showed the full-page
 * «صار خلل أثناء فتح الصفحة». Root cause: the form helpers awaited the server action inside
 * an async transition without catching, so any failed call (connection drop, server error,
 * an app update between opening the page and pressing Save) was thrown to the page's error
 * boundary — the page was replaced and what he typed was lost, instead of a message.
 */
describe("settle(): a failed server action call becomes a result, never a thrown error", () => {
  it("passes a result through", async () => {
    expect(await settle(async () => ({ ok: true as const }))).toEqual({ ok: true });
    expect(await settle(async () => ({ ok: false as const, error: "duplicate" }))).toEqual({ ok: false, error: "duplicate" });
  });

  it("a lost connection or a server error → «connection»", async () => {
    expect(await settle(() => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ ok: false, error: "connection" });
    expect(await settle(() => Promise.reject(new Error("An unexpected response was received from the server.")))).toEqual({ ok: false, error: "connection" });
    expect(
      await settle(() => {
        throw new Error("sync");
      }),
    ).toEqual({ ok: false, error: "connection" });
  });

  it("the app was updated since the page opened (unknown action) → «appUpdated»", async () => {
    expect(await settle(() => Promise.reject(new UnrecognizedActionError("Server Action \"x\" was not found on the server.")))).toEqual({ ok: false, error: "appUpdated" });
  });

  it("a redirect from the action (e.g. signed out → /login) is still thrown, so Next navigates", async () => {
    let redirectError: unknown;
    try {
      redirect("/login");
    } catch (e) {
      redirectError = e;
    }
    await expect(settle(() => Promise.reject(redirectError))).rejects.toBe(redirectError);
  });

  it("both languages explain the two failures", () => {
    for (const m of [ar, en] as { errors: Record<string, string> }[]) {
      expect(m.errors.connection).toBeTruthy();
      expect(m.errors.appUpdated).toBeTruthy();
    }
  });
});

/** Every `start…(async () => { … })` in the UI awaits its calls through settle(), a .catch() or a try/catch. */
describe("no server action call can reach the error page", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(join(process.cwd(), "src"));

  it("each async transition guards its awaits", () => {
    const bad: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b[sS]tart[A-Za-z]*\(async \(\) => \{/g)) {
        // the transition body: up to the matching closing brace
        let depth = 0;
        let end = m.index! + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === "{") depth++;
          else if (src[end] === "}" && --depth === 0) break;
        }
        const body = src.slice(m.index!, end);
        const awaits = [...body.matchAll(/await\s+([^;]+)/g)].map((a) => a[1]);
        // guarded: through settle(), or a promise with its own .catch()
        const unguarded = awaits.filter((a) => !/^settle\(/.test(a) && !/\.catch\(/.test(a));
        if (unguarded.length && !/\btry \{/.test(body)) bad.push(`${file.replace(process.cwd() + "/", "")}:${src.slice(0, m.index).split("\n").length} → ${unguarded[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* Review: every error settle() can return must reach the user as a translated sentence. */
describe("failure texts", () => {
  it("each failure has a message in both languages; the client page is never told to reload", async () => {
    const { CALL_FAILURES, failureKey } = await import("@/lib/client/failure-text");
    const get = (m: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);
    for (const e of CALL_FAILURES) {
      for (const clientPage of [false, true]) {
        const key = failureKey(e, { clientPage });
        expect(key, e).toBeTruthy();
        expect(typeof get(ar, key!)).toBe("string");
        expect(typeof get(en, key!)).toBe("string");
        if (clientPage) expect(key).not.toBe("errors.appUpdated");
      }
    }
    expect(failureKey("duplicate")).toBeNull();
  });

  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const all: string[] = [];
  const walkAll = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkAll(p);
      else if (/\.tsx?$/.test(p)) all.push(p.replace(process.cwd() + "/", ""));
    }
  };
  walkAll(join(process.cwd(), "src"));

  it("every screen that calls settle() turns its failures into text (useFailureText), and reads the result", () => {
    const bad: string[] = [];
    for (const f of all) {
      const src = read(f);
      if (!/\bsettle\(/.test(src) || f === "src/lib/client/action.ts") continue;
      // useActionRunner's errorText() already starts with the failure text
      if (!/useFailureText\(/.test(src) && !/useActionRunner\(/.test(src)) bad.push(`${f}: no useFailureText`);
      if (/^\s*await settle\(/m.test(src)) bad.push(`${f}: a settle() result is ignored`);
      if (f.startsWith("src/components/portal/") && !/useFailureText\(\{ clientPage: true \}\)/.test(src)) bad.push(`${f}: client page without clientPage`);
    }
    expect(bad).toEqual([]);
  });

  it("in client components every awaited / .then server action call goes through settle() or a try", () => {
    const bad: string[] = [];
    for (const f of all) {
      const src = read(f);
      if (!/^\s*["']use client["']/.test(src)) continue;
      // server actions: imported from an …actions module, `actions.x`, or a prop typed as returning ActionResult
      const names = new Set<string>(["actions"]);
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*actions[^"']*["']/g))
        for (const x of m[1].split(",")) {
          const n = x.trim().replace(/^type\s+.*/, "").split(/\s+as\s+/).pop();
          if (n) names.add(n);
        }
      for (const m of src.matchAll(/(\w+)\??:\s*(?:\([^()]*\)|\w+)\s*=>\s*Promise<ActionResult/g)) names.add(m[1]);
      for (const m of src.matchAll(/(\w+)\??:\s*Actions\["\w+"\]/g)) names.add(m[1]);
      // try blocks
      const tries: [number, number][] = [];
      for (const m of src.matchAll(/\btry \{/g)) {
        let depth = 0;
        let i = m.index! + m[0].length - 1;
        for (; i < src.length; i++) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}" && --depth === 0) break;
        }
        tries.push([m.index!, i]);
      }
      const inTry = (i: number) => tries.some(([a, b]) => i > a && i < b);
      for (const m of src.matchAll(/(?:await|void)\s+([A-Za-z_$][\w$]*)[\w$.?!]*\(/g)) {
        if (names.has(m[1]) && !inTry(m.index!)) bad.push(`${f}:${src.slice(0, m.index).split("\n").length} ${m[0].split(/\s/)[0]} ${m[1]}`);
      }
      for (const m of src.matchAll(/([A-Za-z_$][\w$]*)[\w$.?!]*\([^()]*\)\s*\.then\(/g)) {
        if (names.has(m[1]) && !/\.catch\(/.test(src.slice(m.index!, m.index! + 600))) bad.push(`${f}:${src.slice(0, m.index).split("\n").length} ${m[1]}().then`);
      }
    }
    expect(bad).toEqual([]);
  });
});
