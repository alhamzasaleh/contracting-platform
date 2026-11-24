import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PORTAL_TOKEN_BYTES, TOKEN_RE, hashPortalToken, newPortalToken } from "@/lib/portal-token";

describe("client-page token (short WhatsApp link)", () => {
  it("is 12 random bytes = 16 base64url characters", () => {
    expect(PORTAL_TOKEN_BYTES).toBe(12);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newPortalToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(TOKEN_RE.test(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it("stores only the SHA-256 of the token", () => {
    const t = newPortalToken();
    expect(hashPortalToken(t)).toBe(createHash("sha256").update(t, "utf8").digest("hex"));
    expect(hashPortalToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts 16..100 base64url characters, so the older 43-character links keep working", () => {
    expect(TOKEN_RE.test("a".repeat(16))).toBe(true);
    expect(TOKEN_RE.test(randomBytes(32).toString("base64url"))).toBe(true);
    expect(TOKEN_RE.test("Ab0_-".repeat(20))).toBe(true);
  });

  it("refuses 15 characters or fewer, more than 100, and characters outside base64url", () => {
    expect(TOKEN_RE.test("a".repeat(15))).toBe(false);
    expect(TOKEN_RE.test("short")).toBe(false);
    expect(TOKEN_RE.test("")).toBe(false);
    expect(TOKEN_RE.test("a".repeat(101))).toBe(false);
    for (const bad of ["abcdefghijklmno+", "abcdefghijklmno/", "abcdefghijklmno=", "abcdefghijklmno.", "abcdefgh ijklmnop", "abcdefghijklmnoé", "abcdefghijklmnop\n"]) {
      expect(TOKEN_RE.test(bad)).toBe(false);
    }
  });
});
