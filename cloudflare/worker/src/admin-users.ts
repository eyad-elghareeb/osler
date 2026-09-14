// Pure query builder for GET /v1/admin/users: attribute filters + sort.
// Dependency-free (no env, no I/O) so it stays unit-testable — the route
// handler in index.ts only parses params and binds the result.

function escapeLike(value: string): string {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/** Raw (unvalidated) list params straight from the URL query string. */
export interface AdminUsersListParams {
  q?: string | null;
  role?: string | null;
  hasPassword?: string | null;
  hasGoogle?: string | null;
  hasEmail?: string | null;
  hasKey?: string | null;
  verified?: string | null;
  sort?: string | null;
}

export interface AdminUsersListQuery {
  /** "" when unfiltered, otherwise "WHERE …" (no trailing space). */
  where: string;
  binds: unknown[];
  /** Allowlisted ORDER BY fragment — never interpolated user input. */
  orderBy: string;
}

const VALID_ROLES = new Set(["student", "content_admin", "admin"]);

const SORT_ORDER: Record<string, string> = {
  newest: "created_at DESC",
  oldest: "created_at ASC",
  username: "username COLLATE NOCASE ASC",
  name: "display_name COLLATE NOCASE ASC",
  updated: "updated_at DESC",
};

const GOOGLE_EXISTS =
  "EXISTS (SELECT 1 FROM auth_identities WHERE auth_identities.user_id = users.id AND provider = 'google')";
const GOOGLE_NOT_EXISTS =
  "NOT EXISTS (SELECT 1 FROM auth_identities WHERE auth_identities.user_id = users.id AND provider = 'google')";

export function buildAdminUsersListQuery(params: AdminUsersListParams): AdminUsersListQuery {
  const conds: string[] = [];
  const binds: unknown[] = [];

  const q = (params.q ?? "").trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    conds.push("(username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    binds.push(like, like, like);
  }

  const role = (params.role ?? "").trim();
  if (VALID_ROLES.has(role)) {
    conds.push("role = ?");
    binds.push(role);
  }

  if (params.hasPassword === "1") conds.push("has_password = 1");
  else if (params.hasPassword === "0") conds.push("(has_password = 0 OR has_password IS NULL)");

  if (params.hasGoogle === "1") conds.push(GOOGLE_EXISTS);
  else if (params.hasGoogle === "0") conds.push(GOOGLE_NOT_EXISTS);

  if (params.hasEmail === "1") conds.push("(email IS NOT NULL AND email != '')");
  else if (params.hasEmail === "0") conds.push("(email IS NULL OR email = '')");

  if (params.hasKey === "1") conds.push("gemini_api_key IS NOT NULL");
  else if (params.hasKey === "0") conds.push("gemini_api_key IS NULL");

  if (params.verified === "1") conds.push("(email_verified_at IS NOT NULL AND email_verified_at > 0)");
  else if (params.verified === "0") conds.push("(email_verified_at IS NULL OR email_verified_at = 0)");

  const sort = (params.sort ?? "newest").trim();
  return {
    where: conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "",
    binds,
    orderBy: SORT_ORDER[sort] ?? SORT_ORDER.newest,
  };
}
