import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssistantSkeleton, DetailPageSkeleton, DocumentPageSkeleton, HomeSkeleton, ListPageSkeleton, PurchaseViewSkeleton, ReportsSkeleton, ScheduleSkeleton, SectionContentSkeleton, SectionDocumentSkeleton, SettingsListSkeleton, SettingsSkeleton, SurveySkeleton } from "@/components/shell/page-skeletons";
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
      <SectionDocumentSkeleton key="9" />, <SettingsListSkeleton key="10" />, <DocumentPageSkeleton key="11" />, <HomeSkeleton key="12" />,
      <PurchaseViewSkeleton key="13" />, <SurveySkeleton key="14" />, <DetailPageSkeleton key="15" columns="quote" />, <DetailPageSkeleton key="16" columns="halves" />,
      <DetailPageSkeleton key="17" columns="pricing" />,
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
    // every loading frame has the shape of its page (columns and breakpoints included)
    const frames: Record<string, string> = {
      "": "<HomeSkeleton />",
      "clients/[number]": '<DetailPageSkeleton columns="halves" />',
      "clients/[number]/surveys/[survey]": "<SurveySkeleton />",
      "quotations/[number]": '<DetailPageSkeleton columns="quote" />',
      "quotations/new": '<DetailPageSkeleton columns="pricing" />',
      "contracts/[number]": "<DocumentPageSkeleton />",
      "contracts/new": "<DetailPageSkeleton />",
      "projects/[number]": "<DetailPageSkeleton />",
      "invoices/[number]": "<DocumentPageSkeleton />",
      // a document inside a section that already draws its header and tabs (purchases)
      "purchases/[number]": "<PurchaseViewSkeleton />",
      "purchases/[number]/edit": "<SectionDocumentSkeleton />",
      "purchases/new": "<SectionDocumentSkeleton />",
      // list pages inside the settings frame get a list, not the form cards
      "settings/members": "<SettingsListSkeleton />",
      "settings/audit": "<SettingsListSkeleton />",
      schedule: "<ScheduleSkeleton />",
    };
    for (const [d, frame] of Object.entries(frames)) expect(readFileSync(join(root, d, "loading.tsx"), "utf8"), d).toContain(frame);
    // and nothing turns link prefetching off
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
    for (const f of walk(join(process.cwd(), "src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/prefetch=\{false\}/);
  });

  it("frames follow their pages' breakpoints", () => {
    // home: 4 KPI cards from xl, at least min-h-28, two columns from xl
    const home = render(<HomeSkeleton />);
    expect(home).toContain("xl:grid-cols-4");
    expect(home).toContain("min-h-28");
    expect(home).toContain("xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]");
    // contract / project editor: side panel from 1150px; quote: 360px from xl; client: two equal columns from lg
    expect(render(<DetailPageSkeleton />)).toContain("min-[1150px]:grid-cols-[minmax(0,1fr)_340px]");
    expect(render(<DetailPageSkeleton columns="quote" />)).toContain("xl:grid-cols-[minmax(0,1fr)_360px]");
    expect(render(<DetailPageSkeleton columns="halves" />)).toContain("lg:grid-cols-2");
    expect(render(<DetailPageSkeleton columns="pricing" />)).toContain("xl:grid-cols-[minmax(0,460px)_1fr]");
    // a contract / invoice is one column
    expect(render(<DocumentPageSkeleton />)).not.toMatch(/grid-cols-\[/);
    // purchase: photo panel from 1150px
    expect(render(<PurchaseViewSkeleton />)).toContain("min-[1150px]:grid-cols-[minmax(0,1fr)_320px]");
    // schedule: names column 112px on phones
    expect(render(<ScheduleSkeleton />)).toContain("grid-cols-[112px_1fr]");
  });
});
