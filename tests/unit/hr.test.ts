import { describe, expect, it } from "vitest";
import { advancesTooHigh, expiringDocuments, netPay, payrollCsv } from "@/lib/hr";

describe("hr", () => {
  it("lists expiring and expired documents, soonest first", () => {
    const docs = expiringDocuments(
      [
        { id: "a", full_name: "أحمد", status: "active", id_expiry: "2026-11-28", passport_expiry: "2027-06-01", insurance_expiry: "2026-11-01" },
        { id: "b", full_name: "سالم", status: "final_exit", id_expiry: "2026-11-25", passport_expiry: null, insurance_expiry: null },
        { id: "c", full_name: "رامي", status: "active", id_expiry: "2027-01-10", passport_expiry: null, insurance_expiry: null },
      ],
      "2026-11-23",
    );
    expect(docs.map((d) => [d.name, d.kind, d.level])).toEqual([
      ["أحمد", "insurance", "expired"],
      ["أحمد", "id", "7"],
      ["رامي", "id", "60"],
    ]);
  });

  it("net pay and bank file", () => {
    expect(netPay({ basic: 3000, housing: 750, transport: 300, other: 0, overtime: 200, deductions: 50, advances: 500 })).toBe(3700);
    const csv = payrollCsv([{ full_name: 'أحمد "أبو علي"', iban: "SA0380000000608010167519", net: 3700 }], "2026-11");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"أحمد ""أبو علي""","SA0380000000608010167519",3700.00,"2026-11"');
  });

  it("recognises the database refusing advances above the open ones", () => {
    expect(advancesTooHigh({ message: "the advances on a line exceed the employee's open advances" })).toBe(true);
    expect(advancesTooHigh({ message: "not allowed" })).toBe(false);
    expect(advancesTooHigh(null)).toBe(false);
  });
});
