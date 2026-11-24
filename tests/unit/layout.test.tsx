import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InvoicesView } from "@/components/finance/invoices-view";
import { NumberInput } from "@/components/forms/form-kit";
import { Field } from "@/components/ui/field";
import { orderOptions, Segmented } from "@/components/ui/segmented";
import { SAMPLE_INVOICES } from "@/app/dev/preview/sample-invoices";
import { render } from "./helpers/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** labels of the radios in the order they are drawn (DOM order = reading order with dir) */
const radios = (html: string) => [...html.matchAll(/role="radio"[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("filters: «all» comes first, in reading order", () => {
  it("Segmented draws an «all» option first whatever order it is given", () => {
    expect(orderOptions([{ value: "open" }, { value: "paid" }, { value: "all" }]).map((o) => o.value)).toEqual(["all", "open", "paid"]);
    const html = render(<Segmented name="f" value="open" onChange={() => {}} options={[{ value: "open", label: "open" }, { value: "all", label: "all" }]} />);
    expect(radios(html)).toEqual(["all", "open"]);
  });

  it("the invoices filter reads الكل / غير مسددة / متأخرة / مسددة", () => {
    const html = render(<InvoicesView data={SAMPLE_INVOICES} base="/dev/preview" today="2026-11-23" />);
    expect(radios(html)).toEqual(["الكل", "غير مسددة", "متأخرة", "مسددة"]);
  });

  it("no call site lists «all» after other options (keeps the source readable too)", () => {
    for (const f of ["finance/invoices-view.tsx", "finance/reports-view.tsx", "projects/maintenance-view.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src/components", f), "utf8");
      for (const m of src.matchAll(/<Segmented[\s\S]*?options=\{\[([\s\S]*?)\]\}/g)) {
        const values = [...m[1].matchAll(/value: "([^"]+)"/g)].map((x) => x[1]);
        if (values.includes("all")) expect(values[0], f).toBe("all");
      }
    }
  });
});

describe("fields", () => {
  it("a number field leaves room for its unit sized to the unit, not a fixed 3rem", () => {
    const short = render(<NumberInput suffix="m" defaultValue="24" />);
    const long = render(<NumberInput suffix="ر.س" defaultValue="24" />);
    expect(short).toContain("padding-right:calc(1rem + 1ch)");
    expect(long).toContain("padding-right:calc(1rem + 3ch)");
    expect(short).not.toContain("pr-12");
  });

  it("fields mark their label / hint so a `field-row` grid can line them up through a subgrid", () => {
    const html = render(
      <Field id="x" label="a long label" hint="hint">
        <input />
      </Field>,
    );
    expect(html).toMatch(/<div data-field="true" class="grid content-start gap-2"><div data-field-label="true" class="flex min-h-5 items-center/);
    expect(html).toContain('<p data-field-hint="true" id="x-hint"');
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.field-row > \[data-field\] \{[^}]*grid-row: span 3;[^}]*grid-template-rows: subgrid;/);
  });
});

describe("no engine keys shown to the owner", () => {
  it("a priced line's zone reads «رطب» / «ديكوري», not wet / decorative", async () => {
    const { LinesTable } = await import("@/components/pricing/results");
    const line = (zone: string) => ({
      key: `zone_${zone}`, group: "material" as const, label: "دهان", zone, need: 10, needUnit: "L",
      purchase: { packs: [] }, qty: 1, unit: "pack", unitPrice: 100, cost: 100, formula: "", inputs: {},
    });
    const html = render(<LinesTable lines={[line("wet"), line("decorative")] as never} explain={() => []} />);
    expect(html).toContain(">رطب<");
    expect(html).toContain(">ديكوري<");
    expect(html).not.toMatch(/>wet<|>decorative</);
  });
});

describe("dialogs", () => {
  // (Radix portals don't render on the server, so this checks the component's source)
  it("the close button is named in the reader's language when a dialog passes no label", () => {
    const src = readFileSync(join(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");
    expect(src).not.toMatch(/closeLabel = "Close"/);
    expect(src).toContain('aria-label={closeLabel ?? t("close")}');
  });

  it("a long centred dialog scrolls inside an inner box, so the close button stays on screen", () => {
    const src = readFileSync(join(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");
    const content = src.match(/!side &&\s*"([^"]+)"/)![1];
    expect(content).not.toMatch(/overflow-y-auto/);
    expect(src).toMatch(/data-dialog-scroll[^>]*overflow-y-auto/);
  });

  it("Safari date fields fit the 3rem box with its 1px borders", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/line-height: 3rem;/);
  });
});

describe("purchase lines", () => {
  it("the unit field shows the unit in the reader's language under a raw key like pack", () => {
    const src = readFileSync(join(process.cwd(), "src/components/purchases/purchase-views.tsx"), "utf8");
    expect(src).toMatch(/id=\{`pl-u-\$\{ri\}`\}[^>]*hint=\{unitHint\(r\.unit\)\}/);
  });
});
