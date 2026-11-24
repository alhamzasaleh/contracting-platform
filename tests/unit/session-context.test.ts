import { describe, expect, it } from "vitest";
import { parseSessionContext, pickOrganization } from "@/lib/auth/session-context";

describe("pickOrganization", () => {
  const ms = [{ organization_id: "a" }, { organization_id: "b" }];
  it("uses the profile's default organization when he is a member there", () => {
    expect(pickOrganization(ms, "b")).toBe("b");
  });
  it("falls back to the first membership", () => {
    expect(pickOrganization(ms, "zzz")).toBe("a");
    expect(pickOrganization(ms, null)).toBe("a");
  });
  it("no memberships → null", () => {
    expect(pickOrganization([], "a")).toBeNull();
  });
});

describe("parseSessionContext", () => {
  it("reads the function's JSON", () => {
    const p = parseSessionContext({
      profile: { id: "u1", full_name: "S" },
      memberships: [{ organization_id: "o1", role: "owner" }],
      organization: { id: "o1", name: "Co" },
      permissions: ["clients.view", "not.a.permission", 7],
    });
    expect(p?.profile?.id).toBe("u1");
    expect(p?.memberships).toEqual([{ organization_id: "o1", role: "owner" }]);
    expect(p?.organization?.id).toBe("o1");
    // unknown keys are dropped, as with my_permissions
    expect(p?.permissions).toEqual(["clients.view"]);
  });
  it("no organization / no permissions", () => {
    const p = parseSessionContext({ profile: { id: "u1" }, memberships: [], organization: null, permissions: [] });
    expect(p?.organization).toBeNull();
    expect(p?.permissions).toEqual([]);
  });
  it("anything malformed → null (the caller falls back to separate queries)", () => {
    expect(parseSessionContext(null)).toBeNull();
    expect(parseSessionContext("x")).toBeNull();
    expect(parseSessionContext([])).toBeNull();
    expect(parseSessionContext({ profile: {} })).toBeNull();
  });
});
