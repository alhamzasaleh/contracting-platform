import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssistantSkeleton, DetailPageSkeleton, ListPageSkeleton, ReportsSkeleton, ScheduleSkeleton, SectionContentSkeleton, SettingsSkeleton } from "@/components/shell/page-skeletons";
import { once, rows } from "@/lib/data/query";
import { render } from "./helpers/render";

/** A lazy thenable like a Supabase query builder: every .then() sends the request again. */
function fakeQuery<T>(result: T) {
  let sent = 0;
  const q = {
    then<R1 = T, R2 = never>(ok?: ((v: T) => R1 | PromiseLike<R1>) | null, bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      sent += 1;
      return Promise.resolve(result).then(ok, bad);
    },
  };
  return { q, sent: () => sent };
}

describe("query helpers", () => {
  it("a builder shared by several chained queries is sent each time; once() sends it once", async () => {
    const raw = fakeQuery({ data: [1, 2] });
    await raw.q;
    await raw.q.then((r) => r.data);
    expect(raw.sent()).toBe(2);

    const f = fakeQuery({ data: [1, 2] });
    const p = once(f.q);
    const [a, b, c] = await Promise.all([p, p.then((r) => r.data.length), p.then((r) => r.data[0])]);
    expect(a).toEqual({ data: [1, 2] });
    expect([b, c]).toEqual([2, 1]);
    expect(f.sent()).toBe(1);
  });

  it("rows() returns the rows, or [] when the database returned none", async () => {
    expect(await rows(Promise.resolve({ data: [{ id: "x" }] }))).toEqual([{ id: "x" }]);
    expect(await rows(Promise.resolve({ data: null }))).toEqual([]);
  });
});

describe("loading skeletons", () => {
  it("render as busy frames with no text", () => {
    for (const node of [
      <ListPageSkeleton key="1" />, <ListPageSkeleton key="2" kpis={4} actions={false} />, <SectionContentSkeleton key="3" />, <DetailPageSkeleton key="4" />,
      <ReportsSkeleton key="5" />, <ScheduleSkeleton key="6" />, <AssistantSkeleton key="7" />, <SettingsSkeleton key="8" />,
    ]) {
      const html = render(node);
      expect(html).toContain('aria-busy="true"');
      expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
    }
  });

  it("every main section shows its own loading frame", () => {
    const root = join(process.cwd(), "src/app/(app)");
    const sections = ["clients", "quotations", "contracts", "projects", "purchases", "invoices", "reports", "schedule", "maintenance", "team", "catalogue", "settings", "assistant"];
    for (const s of sections) expect(statSync(join(root, s, "loading.tsx")).isFile(), s).toBe(true);
    // document pages get a document-shaped frame, not the list's
    for (const d of ["clients/[number]", "quotations/[number]", "contracts/[number]", "projects/[number]", "invoices/[number]"]) {
      expect(readFileSync(join(root, d, "loading.tsx"), "utf8")).toContain("DetailPageSkeleton");
    }
    // and nothing turns link prefetching off
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
    for (const f of walk(join(process.cwd(), "src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/prefetch=\{false\}/);
  });
});
