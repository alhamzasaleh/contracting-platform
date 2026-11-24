import { describe, expect, it, vi } from "vitest";
import { render } from "./helpers/render";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { portalLinkState } from "@/lib/contracts";
import { portalWaKey, quoteDecisionError, quoteOutcome, quoteStageState } from "@/lib/portal-flow";
import { NOTIFICATION_KINDS, whatsappText } from "@/lib/notifications";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { SAMPLE_QUOTE_STAGE } from "@/app/dev/preview/sample-contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** Quote first, then contract (owner, Nov 2026). */

describe("the quote stage on the client page", () => {
  const base = { status: "issued" as const, decision: null, contract: null, validUntil: "2026-11-30", today: "2026-11-24" };
  it("an issued quote is open: accept, ask for changes or decline", () => {
    expect(quoteStageState(base)).toEqual({ state: "open", canAccept: true, canAnswer: true });
  });
  it("after a change request the client may still accept or decline (a new version clears it)", () => {
    expect(quoteStageState({ ...base, decision: "changes_requested" })).toEqual({ state: "changes_requested", canAccept: true, canAnswer: true });
  });
  it("accepted / rejected are final; a quote being revised shows no buttons", () => {
    expect(quoteStageState({ ...base, decision: "accepted" })).toEqual({ state: "accepted", canAccept: false, canAnswer: false });
    expect(quoteStageState({ ...base, status: "rejected", decision: "rejected" })).toEqual({ state: "rejected", canAccept: false, canAnswer: false });
    expect(quoteStageState({ ...base, status: "draft" })).toEqual({ state: "revising", canAccept: false, canAnswer: false });
    expect(quoteStageState({ ...base, status: "pending_approval" }).state).toBe("revising");
  });
  it("an expired quote can't be accepted but the client may still ask for changes", () => {
    expect(quoteStageState({ ...base, validUntil: "2026-11-23" })).toEqual({ state: "expired", canAccept: false, canAnswer: true });
  });
  it("a contract being prepared from it: waiting for the contract", () => {
    expect(quoteStageState({ ...base, decision: "accepted", contract: { status: "draft" } })).toEqual({ state: "contract_draft", canAccept: false, canAnswer: false });
    expect(quoteStageState({ ...base, contract: { status: "draft" } }).state).toBe("contract_draft");
  });
});

describe("the database refusal decides the client's message", () => {
  it("maps each refusal", () => {
    expect(quoteDecisionError({ code: "22023", message: "choose an option" })).toBe("chooseOption");
    expect(quoteDecisionError({ code: "22023", message: "no options on this quote" })).toBe("chooseOption");
    expect(quoteDecisionError({ code: "22023", message: "quote expired" })).toBe("quoteExpired");
    expect(quoteDecisionError({ code: "22023", message: "already decided" })).toBe("alreadyDecided");
    expect(quoteDecisionError({ code: "22023", message: "quote not open" })).toBe("quoteNotOpen");
    expect(quoteDecisionError({ code: "22023", message: "name required" })).toBe("invalid");
    expect(quoteDecisionError({ code: "XX000", message: "boom" })).toBeNull();
    expect(quoteDecisionError(null)).toBeNull();
  });
  it("every client message exists in both languages", () => {
    for (const k of ["errQuoteExpired", "errAlreadyDecided", "errQuoteNotOpen", "errChooseOption"]) {
      expect((ar.portal as Record<string, string>)[k], k).toBeTruthy();
      expect((en.portal as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});

describe("one link, one WhatsApp text per stage", () => {
  it("picks the text by stage and whether a new address is at hand", () => {
    expect(portalWaKey("quote", true)).toBe("quoteLink");
    expect(portalWaKey("quote", false)).toBe("quoteSameLink");
    expect(portalWaKey("contract", true)).toBe("contractLink");
    expect(portalWaKey("contract", false)).toBe("contractSameLink");
    expect(portalWaKey("project", true)).toBe("projectLink");
    expect(portalWaKey("project", false)).toBe("projectSameLink");
  });
  it("the contract page: before acceptance the contract text, after it the project text", () => {
    expect(portalLinkState("sent", null, "2026-11-23")).toEqual({ canIssue: true, message: "contractLink", warrantyEnded: false });
    expect(portalLinkState("draft", null, "2026-11-23").message).toBe("contractLink");
    expect(portalLinkState("accepted", null, "2026-11-23")).toEqual({ canIssue: true, message: "projectLink", warrantyEnded: false });
    expect(portalLinkState("accepted", "2026-11-22", "2026-11-23")).toEqual({ canIssue: false, message: "projectLink", warrantyEnded: true });
  });
  it("the texts exist in both languages; only the ones with an address carry {url}", () => {
    for (const k of ["quoteLink", "quoteSameLink", "contractLink", "contractSameLink", "projectLink", "projectSameLink"] as const) {
      for (const m of [ar, en]) {
        const text = (m.wa as Record<string, string>)[k];
        expect(text, k).toBeTruthy();
        expect(text.includes("{url}"), k).toBe(k.endsWith("Link") && !k.endsWith("SameLink"));
      }
    }
    expect(ar.wa.quoteLink).toBe("مرحباً {name}، هذا عرض السعر من {org}. تقدر تطّلع عليه وتوافق عليه أو تطلب تعديل من هنا: {url}");
    expect(ar.wa.quoteLink).not.toMatch(/العقد/);
  });
});

describe("notifications: the client answered the quote", () => {
  it("three kinds, each with in-app text, a preference label and a WhatsApp line", () => {
    for (const k of ["quote_accepted", "quote_changes_requested", "quote_rejected"] as const) {
      expect(NOTIFICATION_KINDS).toContain(k);
      for (const m of [ar, en]) {
        expect((m.notify as Record<string, string>)[k], k).toBeTruthy();
        expect((m.notify as Record<string, string>)[`k_${k}`], k).toBeTruthy();
      }
    }
    expect(whatsappText("quote_accepted", { number: "Q-2026-001", name: "أبو فهد" })).toContain("Q-2026-001");
    expect(whatsappText("quote_changes_requested", { number: "Q-2026-001", note: "لون آخر" })).toContain("لون آخر");
    expect(whatsappText("quote_rejected", { number: "Q-2026-001", note: null })).toContain("Q-2026-001");
  });
});

describe("past quotes: a declined quote is lost", () => {
  it("rejected by the client (status or decision) without a contract = lost; accepted contract = won", () => {
    const old = "2026-01-01";
    expect(quoteOutcome({ status: "rejected", client_decision: "rejected", valid_until: null, updated_at: "2026-11-20T00:00:00Z" }, null, old)).toBe("lost");
    expect(quoteOutcome({ status: "issued", client_decision: "rejected", valid_until: null, updated_at: "2026-11-20T00:00:00Z" }, null, old)).toBe("lost");
    expect(quoteOutcome({ status: "issued", client_decision: "accepted", valid_until: null, updated_at: "2026-11-20T00:00:00Z" }, null, old)).toBeNull();
    expect(quoteOutcome({ status: "issued", client_decision: null, valid_until: "2025-12-01", updated_at: "2025-11-20T00:00:00Z" }, null, old)).toBe("lost");
    expect(quoteOutcome({ status: "issued", client_decision: null, valid_until: null, updated_at: "2026-11-20T00:00:00Z" }, { status: "accepted" }, old)).toBe("won");
    expect(quoteOutcome({ status: "rejected", client_decision: "rejected", valid_until: null, updated_at: "2026-11-20T00:00:00Z" }, { status: "sent" }, old)).toBeNull();
  });
});

describe("QuoteStageView", () => {
  const view = (data = SAMPLE_QUOTE_STAGE) => render(<QuoteStageView data={data} logoUrl={null} number="Q-2026-007" token="preview" />);
  it("open: three answers (accept with name and option, changes with a note, decline with an optional reason)", () => {
    const html = view();
    expect(html).toContain(ar.portal.quoteAcceptButton);
    expect(html).toContain(ar.portal.quoteChangesButton);
    expect(html).toContain(ar.portal.quoteRejectButton);
    expect(html).toContain(ar.portal.chooseOption);
  });
  it("changes requested: shows the note and keeps the answers", () => {
    const html = view({ ...SAMPLE_QUOTE_STAGE, quote: { ...SAMPLE_QUOTE_STAGE.quote, decision: "changes_requested", decided_at: "2026-11-23T10:00:00Z", decision_note: "نبي لون أفتح" } });
    expect(html).toContain("نبي لون أفتح");
    expect(html).toContain(ar.portal.quoteAcceptButton);
  });
  it("accepted, waiting for the contract: no buttons", () => {
    const html = view({ ...SAMPLE_QUOTE_STAGE, options: [], quote: { ...SAMPLE_QUOTE_STAGE.quote, decision: "accepted", decided_at: "2026-11-23T10:00:00Z", decided_name: "أبو فهد", chosen_version: 2 } });
    expect(html).not.toContain(ar.portal.quoteAcceptButton);
    expect(html).toContain(ar.portal.quoteAcceptedTitle);
  });
  it("rejected: final, the reason is shown, no buttons", () => {
    const html = view({ ...SAMPLE_QUOTE_STAGE, quote: { ...SAMPLE_QUOTE_STAGE.quote, status: "rejected", decision: "rejected", decided_at: "2026-11-23T10:00:00Z", decision_note: "السعر عالي" } });
    expect(html).toContain("السعر عالي");
    expect(html).not.toContain(ar.portal.quoteAcceptButton);
  });
  it("being revised: no document and no buttons", () => {
    const html = view({ ...SAMPLE_QUOTE_STAGE, quote: { ...SAMPLE_QUOTE_STAGE.quote, status: "draft", client_view: null } });
    expect(html).toContain(ar.portal.quoteRevising);
    expect(html).not.toContain(ar.portal.quoteAcceptButton);
  });
});

// --- Review fixes (bug-hunter + integration-reviewer) --------------------------------------------
import { acceptInput, quoteMonthStats, quotesWaiting } from "@/lib/portal-flow";
import { buildFacts } from "@/lib/assistant/context";
import { SAMPLE_FINANCE } from "@/app/dev/preview/sample-finance";
import { PortalView } from "@/components/portal/portal-view";
import { SAMPLE_PORTAL } from "@/app/dev/preview/sample-contracts";
import { QuotesView, QuoteView } from "@/components/quotes/quote-views";
import { QuoteOptionsPanel } from "@/components/quotes/quote-options";
import { SAMPLE_ORG, SAMPLE_QUOTE } from "@/app/dev/preview/sample-quotes";
import { ClientDetailView } from "@/components/clients/clients-view";
import { SAMPLE_CLIENT_DETAIL } from "@/app/dev/preview/sample-clients";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { hrefs } from "./helpers/render";

describe("#1 the client accepts exactly the version on his screen", () => {
  it("always sends the shown version (single quote: the current one; options: the picked one)", () => {
    expect(acceptInput({ name: " أبو فهد ", shown: null, quoteVersion: 3 })).toEqual({ name: "أبو فهد", agree: true, version: 3 });
    expect(acceptInput({ name: "أبو فهد", shown: { version: 2 }, quoteVersion: 1 })).toEqual({ name: "أبو فهد", agree: true, version: 2 });
  });
  it("a changed offer has its own message in both languages", () => {
    expect(quoteDecisionError({ code: "22023", message: "offer changed" })).toBe("quoteChanged");
    expect(ar.portal.errQuoteChanged).toBe("تغيّر العرض — حدّث الصفحة");
    expect(en.portal.errQuoteChanged).toBeTruthy();
  });
});

describe("#14 an accepted quote without a contract after 30 days is lost", () => {
  it("counts like any other issued quote", () => {
    const monthAgo = "2026-10-25";
    expect(quoteOutcome({ status: "issued", client_decision: "accepted", valid_until: "2026-10-01", updated_at: "2026-10-01T00:00:00Z" }, null, monthAgo)).toBe("lost");
    expect(quoteOutcome({ status: "issued", client_decision: "accepted", valid_until: "2026-11-30", updated_at: "2026-11-20T00:00:00Z" }, null, monthAgo)).toBeNull();
  });
});

describe("#11 the contract text points to the earlier link in general words", () => {
  it("no mention of the quote link", () => {
    expect(ar.wa.contractSameLink).toContain("افتح الرابط اللي أرسلناه لك سابقاً");
    expect(ar.wa.contractSameLink).not.toContain("لعرض السعر");
  });
});

describe("#12 home: quotes waiting for you", () => {
  const rows = [
    { number: "Q-2026-001", client: "أ", decision: "accepted" as const, decided_at: "2026-11-20T10:00:00Z", status: "issued" as const, hasContract: false },
    { number: "Q-2026-002", client: "ب", decision: "accepted" as const, decided_at: "2026-11-21T10:00:00Z", status: "issued" as const, hasContract: true },
    { number: "Q-2026-003", client: "ج", decision: "changes_requested" as const, decided_at: "2026-11-19T10:00:00Z", status: "issued" as const, hasContract: false },
    { number: "Q-2026-004", client: "د", decision: "rejected" as const, decided_at: "2026-11-19T10:00:00Z", status: "rejected" as const, hasContract: false },
    { number: "Q-2026-005", client: "هـ", decision: "changes_requested" as const, decided_at: "2026-11-22T10:00:00Z", status: "draft" as const, hasContract: false },
  ];
  it("accepted without a contract → create it; changes requested → revise (oldest first)", () => {
    expect(quotesWaiting(rows)).toEqual([
      { number: "Q-2026-003", client: "ج", kind: "changes", since: "2026-11-19T10:00:00Z", href: "/quotations/Q-2026-003" },
      { number: "Q-2026-001", client: "أ", kind: "contract", since: "2026-11-20T10:00:00Z", href: "/contracts/new?quote=Q-2026-001" },
      { number: "Q-2026-005", client: "هـ", kind: "changes", since: "2026-11-22T10:00:00Z", href: "/quotations/Q-2026-005" },
    ]);
  });
  it("the card shows numbers and links", () => {
    const html = render(<DashboardView data={{ userName: null, setup: [], basePath: "/dev/preview", quotesWaiting: quotesWaiting(rows) }} />);
    expect(html).toContain(ar.dashboard.quotesWaitingTitle);
    expect(hrefs(html)).toContain("/dev/preview/contracts/new?quote=Q-2026-001");
    expect(hrefs(html)).toContain("/dev/preview/quotations/Q-2026-003");
  });
});

describe("#13 assistant: quotes per month", () => {
  it("issued / accepted / changes / declined counted by month with their numbers", () => {
    const stats = quoteMonthStats([
      { number: "Q-2026-001", created_at: "2026-10-03T00:00:00Z", decision: "accepted", decided_at: "2026-11-02T00:00:00Z", status: "issued" },
      { number: "Q-2026-002", created_at: "2026-11-05T00:00:00Z", decision: "rejected", decided_at: "2026-11-06T00:00:00Z", status: "rejected" },
      { number: "Q-2026-003", created_at: "2026-11-07T00:00:00Z", decision: "changes_requested", decided_at: "2026-11-08T00:00:00Z", status: "issued" },
      { number: "Q-2026-004", created_at: "2026-11-09T00:00:00Z", decision: null, decided_at: null, status: "draft" },
    ]);
    expect(stats["2026-10"]).toEqual({ issued: 1, accepted: 0, changesRequested: 0, rejected: 0, numbers: { issued: ["Q-2026-001"], accepted: [], changesRequested: [], rejected: [] } });
    expect(stats["2026-11"]).toMatchObject({ issued: 2, accepted: 1, changesRequested: 1, rejected: 1, numbers: { accepted: ["Q-2026-001"], rejected: ["Q-2026-002"] } });
    const facts = buildFacts(SAMPLE_FINANCE, { company: "ملمس", vatRegistered: false, collected: {}, purchases: {}, maintenance: {}, quotes: stats });
    expect(facts.quotesByMonth["2026-11"].accepted).toBe(1);
  });
});

describe("#10 client-page PDF links use the contract number", () => {
  it("opened from the quote number, the contract PDF still carries C-…", () => {
    const html = render(<PortalView data={SAMPLE_PORTAL} logoUrl={null} number="Q-2026-007" token="preview" />);
    expect(hrefs(html)).toContain(`/p/${SAMPLE_PORTAL.contract.number}/preview/pdf/contract`);
    expect(hrefs(html).some((h) => h.startsWith("/p/Q-2026-007/preview/pdf/contract"))).toBe(false);
  });
});

describe("#9 quote PDF from the client page", () => {
  it("download + print for the option on screen", () => {
    const html = render(<QuoteStageView data={SAMPLE_QUOTE_STAGE} logoUrl={null} number="Q-2026-007" token="preview" />);
    expect(hrefs(html)).toContain(`/p/Q-2026-007/preview/pdf/quote-${SAMPLE_QUOTE_STAGE.options[0].version}`);
  });
  it("no PDF while the quote is being revised", () => {
    const html = render(<QuoteStageView data={{ ...SAMPLE_QUOTE_STAGE, options: [], quote: { ...SAMPLE_QUOTE_STAGE.quote, status: "draft", client_view: null, total: null, version: null } }} logoUrl={null} number="Q-2026-007" token="preview" />);
    expect(hrefs(html).some((h) => h.includes("/pdf/quote"))).toBe(false);
  });
});

describe("#5 the client's answer shows on the quotes list and the client page", () => {
  it("quotes list", () => {
    const html = render(<QuotesView quotes={[{ id: "1", number: "Q-2026-001", client: "أ", clientNumber: "CL-2026-001", service: "interior", status: "issued", version: 1, total: 100, created_at: "2026-11-20T00:00:00Z", clientDecision: "changes_requested" }]} />);
    expect(html).toContain(ar.quotes.decision_changes_requested);
  });
  it("client page", () => {
    const html = render(<ClientDetailView canManage={false} canQuote={false} detail={{ ...SAMPLE_CLIENT_DETAIL, quotes: [{ id: "1", number: "Q-2026-001", service: "interior", status: "issued", version: 1, total: 100, created_at: "2026-11-20T00:00:00Z", clientDecision: "accepted" }] }} />);
    expect(html).toContain(ar.quotes.decision_accepted);
  });
});

describe("#6 / #8 quote page after the client's answer", () => {
  it("options are locked with a reason once the client accepted", () => {
    const detail = { ...SAMPLE_QUOTE, quote: { ...SAMPLE_QUOTE.quote, status: "issued" as const }, options: [{ version: 1, label: "أ" }, { version: 2, label: "ب" }], clientDecision: { decision: "accepted" as const, at: "2026-11-23T10:00:00Z", name: "x", note: null, version: 2, ip: null } };
    const html = render(<QuoteOptionsPanel detail={detail} preview />);
    expect(html).toContain(ar.quotes.optionsClientAccepted);
    expect(html).not.toContain(ar.quotes.optionsSave);
  });
  it("a declined quote can be issued again", () => {
    const detail = { ...SAMPLE_QUOTE, quote: { ...SAMPLE_QUOTE.quote, status: "rejected" as const }, approvals: [] };
    const html = render(<QuoteView detail={detail} org={SAMPLE_ORG} warrantyMonths={6} />);
    expect(html).toContain(ar.quotes.reissue);
  });
});
