import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/**
 * Text the owner or a client reads comes from messages/ar.json + en.json, never from a literal in a
 * component: an Arabic word stays Arabic in the English app (and a Latin unit in the Arabic one).
 */
const ROOTS = ["src/components", "src/app"];
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return p.includes(join("dev", "preview")) ? [] : walk(p);
    // global-error.tsx renders without the messages (the root layout failed): its fixed text lives in
    // src/lib/error-page.ts
    return /\.tsx$/.test(f) && f !== "global-error.tsx" ? [p] : [];
  });
const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

/** allowed: Arabic-digit conversion tables, the language's own name in the language switch, the "?" initial */
const ALLOWED = [/\[٠-٩\]/, /"٠١٢٣٤٥٦٧٨٩"/, /label: "العربية"/, /\?\? "؟"/];

describe("no one-language text in components", () => {
  it("no Arabic literals outside messages (placeholders, units, commas, sample words)", () => {
    const found: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "").replace(/\{?\/\*.*?\*\/\}?/g, "");
          const t = code.trim();
          if (t.startsWith("*") || t.startsWith("//")) return;
          if (!/[؀-ۿ]/.test(code)) return;
          if (ALLOWED.some((a) => a.test(code))) return;
          found.push(`${f.replace(process.cwd() + "/", "")}:${i + 1}: ${t.slice(0, 100)}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("unit suffixes are unit keys that NumberInput translates (م² / m²), or %", () => {
    const ar = JSON.parse(readFileSync(join(process.cwd(), "messages/ar.json"), "utf8")) as { engine: Record<string, string> };
    const keys = new Set(Object.keys(ar.engine).filter((k) => k.startsWith("unit_")).map((k) => k.slice(5)));
    const ok = (u: string) => u === "%" || u === "m²" || keys.has(u);
    const found: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/suffix="([^"]*)"|suffix=\{"([^"]*)"\}|\b(?:tot|qty)\([^()]*,\s*"([^"]*)"\)/g)) {
            const u = m[1] ?? m[2] ?? m[3];
            if (!ok(u)) found.push(`${f.replace(process.cwd() + "/", "")}:${i + 1}: ${u}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});

describe("NumberInput shows unit keys in the reader's language", () => {
  it("m² reads «م²» in Arabic", async () => {
    const { NumberInput } = await import("@/components/forms/form-kit");
    const { render } = await import("./helpers/render");
    const html = render(<NumberInput suffix="m²" defaultValue="24" />);
    expect(html).toContain(">م²<");
    expect(render(<NumberInput suffix="m" defaultValue="3" />)).toContain(">م<");
  });
});

describe("unit hints under free-text unit fields", () => {
  it("a unit key gets its translation underneath; a typed unit gets none", async () => {
    const { useUnitHint } = await import("@/components/forms/form-kit");
    const { render } = await import("./helpers/render");
    function Probe({ u }: { u: string }) {
      return <span>[{useUnitHint()(u) ?? "none"}]</span>;
    }
    expect(render(<Probe u="pcs" />)).toContain("[قطعة]");
    expect(render(<Probe u="pack" />)).toContain("[عبوة]");
    expect(render(<Probe u="كرتون" />)).toContain("[none]");
  });
});
