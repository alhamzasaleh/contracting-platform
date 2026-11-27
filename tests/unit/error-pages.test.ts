import { describe, expect, it, vi } from "vitest";
import { errorHomeHref, GLOBAL_ERROR_TEXT as TEXT, retryOf } from "@/lib/error-page";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/* Error pages (owner, Nov 2026): Arabic instead of Next's «This page couldn't load». */
describe("error pages", () => {
  it("«الرئيسية» goes home for staff pages, never for a client's or a partner's own page", () => {
    expect(errorHomeHref("/contracts/C-2026-001")).toBe("/");
    expect(errorHomeHref("/")).toBe("/");
    expect(errorHomeHref("/p/C-2026-001/abc")).toBeNull();
    expect(errorHomeHref("/m/MK-2026-001/abc")).toBeNull();
    expect(errorHomeHref("/projects")).toBe("/");
    expect(errorHomeHref("/partners")).toBe("/");
  });
  it("retry prefers Next's retry, then reset", () => {
    const retry = vi.fn();
    const reset = vi.fn();
    retryOf({ retry, reset })();
    expect(retry).toHaveBeenCalled();
    retryOf({ reset })();
    expect(reset).toHaveBeenCalled();
  });
});

describe("the root-layout error page (no messages there)", () => {
  it("its fixed text is the messages' errorPage, both languages", () => {
    expect(TEXT.name).toBe(ar.app.name);
    expect(TEXT.ar).toEqual({ title: ar.errorPage.title, body: ar.errorPage.body, retry: ar.errorPage.retry });
    expect(TEXT.en).toEqual({ title: en.errorPage.title, body: en.errorPage.body, retry: en.errorPage.retry });
  });
});
