import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "./helpers/render";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { clientDeleteBlock, deleteError, quoteDeleteBlock, surveyDeleteBlock } from "@/lib/deletion";
import { ClientDetailView } from "@/components/clients/clients-view";
import { SurveyView } from "@/components/clients/survey-view";
import { QuoteView } from "@/components/quotes/quote-views";
import { SAMPLE_CLIENT_DETAIL, SAMPLE_SURVEY } from "@/app/dev/preview/sample-clients";
import { SAMPLE_ORG, SAMPLE_QUOTE } from "@/app/dev/preview/sample-quotes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** Deleting clients, surveys and quotes — the owner only (owner, Nov 2026). */

describe("the rules (same as public.delete_*)", () => {
  it("a quote with any contract or accepted by the client stays; a declined one can go", () => {
    expect(quoteDeleteBlock({ hasContract: true })).toBe("deleteQuoteContract");
    expect(quoteDeleteBlock({ hasContract: false, clientDecision: "accepted" })).toBe("deleteQuoteAccepted");
    expect(quoteDeleteBlock({ hasContract: false, clientDecision: "rejected" })).toBeNull();
    expect(quoteDeleteBlock({ hasContract: false, clientDecision: "changes_requested" })).toBeNull();
    expect(quoteDeleteBlock({ hasContract: false })).toBeNull();
  });
  it("a survey with a quote on it stays", () => {
    expect(surveyDeleteBlock({ quotes: 1 })).toBe("deleteSurveyQuotes");
    expect(surveyDeleteBlock({ quotes: 0 })).toBeNull();
  });
  it("a client with any contract, or a quote he accepted, stays", () => {
    expect(clientDeleteBlock({ contracts: 1, quotes: [] })).toBe("deleteClientContracts");
    expect(clientDeleteBlock({ contracts: 0, quotes: [{ hasContract: true }] })).toBe("deleteClientContracts");
    expect(clientDeleteBlock({ contracts: 0, quotes: [{ clientDecision: "accepted" }, {}] })).toBe("deleteClientAccepted");
    expect(clientDeleteBlock({ contracts: 0, quotes: [{ clientDecision: "rejected" }, {}] })).toBeNull();
  });
  it("maps each database refusal to its message", () => {
    expect(deleteError({ code: "P0001", message: "quote has a contract" })).toBe("deleteQuoteContract");
    expect(deleteError({ code: "P0001", message: "quote accepted by the client" })).toBe("deleteQuoteAccepted");
    expect(deleteError({ code: "P0001", message: "survey has quotes" })).toBe("deleteSurveyQuotes");
    expect(deleteError({ code: "P0001", message: "client has contracts" })).toBe("deleteClientContracts");
    expect(deleteError({ code: "P0001", message: "client has an accepted quote" })).toBe("deleteClientAccepted");
    expect(deleteError({ code: "42501", message: "not allowed" })).toBe("noAccess");
    expect(deleteError({ code: "XX000", message: "boom" })).toBe("error");
  });
  it("every refusal has a message in both languages", () => {
    for (const k of ["deleteQuoteContract", "deleteQuoteAccepted", "deleteSurveyQuotes", "deleteClientContracts", "deleteClientAccepted"]) {
      expect((ar.errors as Record<string, string>)[k]).toBeTruthy();
      expect((en.errors as Record<string, string>)[k]).toBeTruthy();
    }
  });
});

describe("the button shows for the owner only", () => {
  const surveyOnly = { ...SAMPLE_CLIENT_DETAIL, contracts: [], quotes: [], surveys: [{ ...SAMPLE_CLIENT_DETAIL.surveys[0], quotes: 0 }] };

  it("client page: hidden without canDelete (even with clients.manage)", () => {
    const html = render(<ClientDetailView detail={surveyOnly} canManage canQuote />);
    expect(html).not.toContain(ar.deletion.deleteClient);
    expect(html).not.toContain(ar.deletion.deleteSurvey);
  });

  it("client page (owner): delete client + each survey; disabled with the reason when he has contracts", () => {
    const free = render(<ClientDetailView detail={{ ...surveyOnly, canDelete: true, contractCount: 0 }} canManage canQuote />);
    expect(free).toContain(ar.deletion.deleteClient);
    expect(free).toContain(`aria-label="${ar.deletion.deleteSurvey}"`);
    expect(free).not.toContain(ar.errors.deleteClientContracts);
    const held = render(<ClientDetailView detail={{ ...surveyOnly, canDelete: true, contractCount: 1 }} canManage canQuote />);
    expect(held).toContain(ar.errors.deleteClientContracts);
    expect(held).toMatch(/<button[^>]*disabled=""[^>]*>.*?حذف العميل/);
  });

  it("survey page: owner only; disabled while a quote is built on it", () => {
    expect(render(<SurveyView detail={SAMPLE_SURVEY} canManage canQuote />)).not.toContain(ar.deletion.deleteSurvey);
    expect(render(<SurveyView detail={{ ...SAMPLE_SURVEY, canDelete: true, quotes: 0 }} canManage canQuote />)).toContain(ar.deletion.deleteSurvey);
    expect(render(<SurveyView detail={{ ...SAMPLE_SURVEY, canDelete: true, quotes: 1 }} canManage canQuote />)).toContain(ar.errors.deleteSurveyQuotes);
  });

  it("quote page: owner only; disabled with a contract or the client's acceptance", () => {
    const base = { ...SAMPLE_QUOTE, contract: null, clientDecision: null };
    expect(render(<QuoteView detail={base} org={SAMPLE_ORG} warrantyMonths={6} />)).not.toContain(ar.deletion.deleteQuote);
    const free = render(<QuoteView detail={{ ...base, canDelete: true, anyContract: false }} org={SAMPLE_ORG} warrantyMonths={6} />);
    expect(free).toContain(ar.deletion.deleteQuote);
    expect(free).not.toContain(ar.errors.deleteQuoteContract);
    // a cancelled contract counts too (anyContract)
    expect(render(<QuoteView detail={{ ...base, canDelete: true, anyContract: true }} org={SAMPLE_ORG} warrantyMonths={6} />)).toContain(ar.errors.deleteQuoteContract);
    const accepted = { ...base, canDelete: true, anyContract: false, clientDecision: { decision: "accepted" as const, at: "2026-11-23T18:40:00Z", name: "x", note: null, version: 1, ip: null } };
    expect(render(<QuoteView detail={accepted} org={SAMPLE_ORG} warrantyMonths={6} />)).toContain(ar.errors.deleteQuoteAccepted);
  });
});

describe("server actions", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("check the owner role before calling the database, and call only the delete functions", () => {
    const clients = src("src/app/(app)/clients/actions.ts");
    const quotes = src("src/app/(app)/quotations/actions.ts");
    expect(clients).toMatch(/async function ownerDelete[\s\S]*?session\.role !== "owner"[\s\S]*?rpc\("delete_client"/);
    expect(quotes).toMatch(/export async function deleteQuote[\s\S]*?session\.role !== "owner"[\s\S]*?rpc\("delete_quote"/);
    // the app never deletes these rows directly
    for (const s of [clients, quotes]) expect(s).not.toMatch(/from\("(clients|surveys|quotes)"\)\s*\.delete\(/);
  });
  it("pages pass the delete actions only when the loader says the viewer is the owner", () => {
    expect(src("src/app/(app)/clients/[number]/page.tsx")).toMatch(/onDelete=\{detail\.canDelete \? deleteClient : undefined\}/);
    expect(src("src/app/(app)/quotations/[number]/page.tsx")).toMatch(/detail\.canDelete \? \{ deleteQuote \}/);
    expect(src("src/app/(app)/clients/[number]/surveys/[survey]/page.tsx")).toMatch(/detail\.canDelete \? \{ deleteSurvey \}/);
    for (const f of ["src/lib/data/clients.ts", "src/lib/data/quotes.ts"]) expect(src(f)).toMatch(/session\.role === "owner"/);
  });
});
