import { describe, it, expect } from "vitest";
import { buildAdminUsersListQuery } from "../admin-users";

describe("buildAdminUsersListQuery", () => {
  it("returns no filter and newest-first by default", () => {
    const r = buildAdminUsersListQuery({});
    expect(r.where).toBe("");
    expect(r.binds).toEqual([]);
    expect(r.orderBy).toBe("created_at DESC");
  });

  it("builds the text search with escaped LIKE wildcards", () => {
    const r = buildAdminUsersListQuery({ q: "100%_x\\y" });
    expect(r.where).toContain("username LIKE ?");
    expect(r.binds).toEqual(["%100\\%\\_x\\\\y%", "%100\\%\\_x\\\\y%", "%100\\%\\_x\\\\y%"]);
  });

  it("accepts known roles and ignores unknown ones", () => {
    expect(buildAdminUsersListQuery({ role: "admin" }).where).toBe("WHERE role = ?");
    expect(buildAdminUsersListQuery({ role: "admin" }).binds).toEqual(["admin"]);
    expect(buildAdminUsersListQuery({ role: "superadmin" }).where).toBe("");
    expect(buildAdminUsersListQuery({ role: "superadmin" }).binds).toEqual([]);
  });

  it("maps tri-state flags to the right predicates", () => {
    expect(buildAdminUsersListQuery({ hasPassword: "1" }).where).toContain("has_password = 1");
    expect(buildAdminUsersListQuery({ hasPassword: "0" }).where).toContain("has_password = 0");
    expect(buildAdminUsersListQuery({ hasGoogle: "1" }).where).toContain("EXISTS (SELECT 1 FROM auth_identities");
    expect(buildAdminUsersListQuery({ hasGoogle: "0" }).where).toContain("NOT EXISTS (SELECT 1 FROM auth_identities");
    expect(buildAdminUsersListQuery({ hasEmail: "1" }).where).toContain("email IS NOT NULL");
    expect(buildAdminUsersListQuery({ hasEmail: "0" }).where).toContain("email IS NULL");
    expect(buildAdminUsersListQuery({ hasKey: "1" }).where).toContain("gemini_api_key IS NOT NULL");
    expect(buildAdminUsersListQuery({ hasKey: "0" }).where).toContain("gemini_api_key IS NULL");
    expect(buildAdminUsersListQuery({ verified: "1" }).where).toContain("email_verified_at IS NOT NULL");
    expect(buildAdminUsersListQuery({ verified: "0" }).where).toContain("email_verified_at IS NULL");
  });

  it("ignores garbage flag values", () => {
    const r = buildAdminUsersListQuery({ hasPassword: "yes", verified: "2" });
    expect(r.where).toBe("");
  });

  it("combines search, filters, and sort in one WHERE", () => {
    const r = buildAdminUsersListQuery({ q: "eyad", role: "student", verified: "1", sort: "username" });
    expect(r.where).toBe(
      "WHERE (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') AND role = ? AND (email_verified_at IS NOT NULL AND email_verified_at > 0)",
    );
    expect(r.binds).toEqual(["%eyad%", "%eyad%", "%eyad%", "student"]);
    expect(r.orderBy).toBe("username COLLATE NOCASE ASC");
  });

  it("allowlist sort with fallback to newest", () => {
    expect(buildAdminUsersListQuery({ sort: "oldest" }).orderBy).toBe("created_at ASC");
    expect(buildAdminUsersListQuery({ sort: "name" }).orderBy).toBe("display_name COLLATE NOCASE ASC");
    expect(buildAdminUsersListQuery({ sort: "updated" }).orderBy).toBe("updated_at DESC");
    expect(buildAdminUsersListQuery({ sort: "created_at; DROP TABLE users" }).orderBy).toBe("created_at DESC");
  });
});
