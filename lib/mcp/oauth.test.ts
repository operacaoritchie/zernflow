import { describe, expect, it } from "vitest";
import { bearerToken } from "./auth";
import { authorizationServerUrl, protectedResourceMetadata, wwwAuthenticate } from "./oauth";
import { scopesForRole } from "./scopes";
import { safeNext } from "../safe-next";

describe("oauth helpers", () => {
  it("points the resource at /api/mcp and the issuer at Supabase Auth", () => {
    const m = protectedResourceMetadata("https://app.example.com", "https://abc.supabase.co/");
    expect(m.resource).toBe("https://app.example.com/api/mcp");
    expect(m.authorization_servers).toEqual(["https://abc.supabase.co/auth/v1"]);
    expect(authorizationServerUrl("https://abc.supabase.co")).toBe("https://abc.supabase.co/auth/v1");
  });
  it("advertises the metadata URL on 401", () => {
    expect(wwwAuthenticate("https://app.example.com")).toMatch(
      /resource_metadata="https:\/\/app\.example\.com\/\.well-known\/oauth-protected-resource\/api\/mcp"/
    );
  });
  it("accepts any bearer token", () => {
    expect(bearerToken("Bearer eyJabc.def.ghi")).toBe("eyJabc.def.ghi");
    expect(bearerToken("Basic abc")).toBeNull();
  });
  it("gives owners and admins every scope, others read only", () => {
    expect(scopesForRole("owner")).toEqual(["read", "write", "act"]);
    expect(scopesForRole("admin")).toEqual(["read", "write", "act"]);
    expect(scopesForRole("member")).toEqual(["read"]);
    expect(scopesForRole(null)).toEqual(["read"]);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/oauth/consent?authorization_id=1")).toBe("/oauth/consent?authorization_id=1");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(bad as string | null)).toBe("/dashboard");
    }
  });
});
