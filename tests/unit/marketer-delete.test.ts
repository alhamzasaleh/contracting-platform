import { describe, expect, it } from "vitest";
import { deleteError, partnerDeleteBlock } from "@/lib/deletion";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/** Deleting a success partner (owner, Nov 2026): only one no quote / contract / reward points at. */
describe("partnerDeleteBlock", () => {
  it("allows an unused partner and blocks one with quotes, contracts or rewards", () => {
    expect(partnerDeleteBlock({ quotes: 0, contracts: 0, rewards: 0 })).toBeNull();
    expect(partnerDeleteBlock({ quotes: 1, contracts: 0, rewards: 0 })).toBe("deletePartnerUsed");
    expect(partnerDeleteBlock({ quotes: 0, contracts: 2, rewards: 0 })).toBe("deletePartnerUsed");
    expect(partnerDeleteBlock({ quotes: 0, contracts: 0, rewards: 1 })).toBe("deletePartnerUsed");
  });
  it("maps the database refusal and has texts in both languages", () => {
    expect(deleteError({ code: "P0001", message: "partner has records" })).toBe("deletePartnerUsed");
    expect(deleteError({ code: "42501", message: "not allowed" })).toBe("noAccess");
    for (const m of [ar, en] as unknown as Record<string, Record<string, string>>[]) {
      expect(m.errors.deletePartnerUsed).toBeTruthy();
      for (const k of ["deletePartner", "partnerTitle", "partnerBody"]) expect(m.deletion[k]).toBeTruthy();
    }
  });
});

describe("a partner deleted while a form was open", () => {
  it("client form: the database refusal reads «the partner was deleted», not «no access»", async () => {
    const { clientDbError } = await import("@/lib/marketers");
    expect(clientDbError({ code: "42501", message: "marketer_id belongs to another organization" })).toBe("partnerGone");
    expect(clientDbError({ code: "23503", message: 'insert or update on table "clients" violates foreign key constraint "clients_marketer_id_fkey"' })).toBe("partnerGone");
    expect(clientDbError({ code: "42501", message: "new row violates row-level security policy" })).toBeNull();
    for (const m of [ar, en] as unknown as Record<string, Record<string, string>>[]) expect(m.errors.partnerGone).toBeTruthy();
  });
});
