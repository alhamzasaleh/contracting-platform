import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, it } from "vitest";
import { STAFF_DOCS } from "@/lib/pdf-docs";

// Every internal link written in the code (pages, components, actions, emails,
// notifications built by the database) must lead to a page or route that
// exists. Catches renamed/removed pages and typos before the owner does.

const ROOT = join(__dirname, "../..");
const APP = join(ROOT, "src/app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Route patterns from the file system: (groups) dropped, [param] = one segment,
// [...rest] = one or more segments.
const routes = walk(APP)
  .filter((f) => /[\\/](page\.tsx|route\.ts)$/.test(f))
  .map((f) => {
    const segs = relative(APP, f).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
    const re = segs
      .map((s) => (s.startsWith("[...") ? "[^?#]+" : s.startsWith("[") ? "[^/?#]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/");
    return { path: "/" + segs.join("/"), sample: "/" + segs.map((x) => (x.startsWith("[") ? "X" : x)).join("/"), re: new RegExp(`^/${re}/?$`) };
  });

const topLevel = [...new Set(routes.map((r) => r.path.split("/")[1]).filter(Boolean))];

// Files that talk to external APIs with their own paths (not our pages), and
// preview sample data / route lists that are prefixes rather than links.
const SKIP = [/^src[\\/]lib[\\/]qoyod[\\/]/, /^src[\\/]app[\\/]dev[\\/]/, /^src[\\/]proxy\.ts$/];

const sources = [
  ...walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f)),
  ...walk(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")),
].filter((f) => !SKIP.some((s) => s.test(relative(ROOT, f))));

const literal = new RegExp(`(["'\`])(/(?:${topLevel.join("|")})(?:[/?#][^"'\`\\s]*)?)\\1`, "g");

// A link matches when the route accepts it with each `${…}` as one segment, or
// when a placeholder spans several segments (e.g. `/print/${path}`) and the
// link, read as a pattern, covers one of the routes.
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function matches(raw: string): boolean {
  let p = raw.replace(/[?#].*$/, "");
  if (p.length > 1 && p.endsWith("/")) p += "${x}"; // SQL: '/contracts/' || number
  const parts = p.split(/\$\{[^}]*\}/);
  if (routes.some((r) => r.re.test(parts.join("X")))) return true;
  if (parts.length === 1) return false;
  const re = new RegExp(`^${parts.map(esc).join("[^?#]+")}/?$`);
  return routes.some((r) => re.test(r.sample));
}

it("finds the app's routes", () => {
  expect(routes.length).toBeGreaterThan(50);
  expect(topLevel).toEqual(expect.arrayContaining(["contracts", "p", "print", "api"]));
});

it("every internal link points to an existing page or route", () => {
  const broken: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(literal)) {
      if (!matches(m[2])) {
        const line = text.slice(0, m.index).split("\n").length;
        broken.push(`${relative(ROOT, file)}:${line} → ${m[2]}`);
      }
    }
  }
  expect(broken).toEqual([]);
});

it("every staff PDF document has a print page behind it", () => {
  const kinds = STAFF_DOCS.source.match(/\^\(([^)]*)\)/)![1].split("|").concat("payroll");
  const missing = kinds.filter((k) => !routes.some((r) => r.re.test(`/print/${k}/X`)));
  expect(missing).toEqual([]);
  // the subcontractor statement (its own pattern)
  expect(STAFF_DOCS.test("subcontractors/SC-2026-001/statement")).toBe(true);
  expect(routes.some((r) => r.re.test("/print/subcontractors/X/statement"))).toBe(true);
});
