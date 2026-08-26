# MCP Server — AI-agent content authoring

Osler ships an MCP (Model Context Protocol) server on the same Cloudflare
Worker that serves the app (`POST /v1/mcp`, Streamable HTTP transport). It lets
administrators connect AI agents (Claude Code, Claude Desktop, Cursor, …) to
author content: parse source material into Osler packs, upload everything in
one batch, run server-side validation, and submit work for review.

## Approval model

Agents are capped at the **authoring** surface no matter who mints the token:

| Agent can | Agent cannot |
|---|---|
| create drafts, write bodies, upload assets | publish / approve |
| validate against the platform schema | reject / schedule |
| read published packs + manifests for reference | delete objects or edit config |
| submit drafts to the review queue | touch users, stats, sessions |

Submitted packs land in `status = "pending"` and must be approved by an admin
(role `admin`) through the web admin panel's review queue before students see
anything.

## Setup

1. Apply the migration: `npm run db:migrate` (in `cloudflare/worker/`).
2. Deploy the worker: `npm run deploy:worker`.
3. In the web admin panel open **Settings → AI Agents**, copy the endpoint URL,
   create a token (optionally with an expiry), and copy it — it is shown once.
4. Connect your client.

### Claude Code

```bash
claude mcp add --transport http osler-admin https://<worker-host>/v1/mcp \
  --header "Authorization: Bearer osler_mcp_..."
```

### Cursor / generic clients

```json
{
  "mcpServers": {
    "osler-admin": {
      "url": "https://<worker-host>/v1/mcp",
      "headers": { "Authorization": "Bearer osler_mcp_..." }
    }
  }
}
```

### Codex (OpenAI)

In Codex: **Settings → Connect to a custom MCP**. Field by field:

| GUI field | What to enter |
|---|---|
| **Name** | Anything, e.g. `osler-demo` (shown in the tools list) |
| **Type** | **Streamable HTTP** (not STDIO — the server is remote) |
| **URL** | `https://<worker-host>/v1/mcp` |
| **Bearer token env var** | The *name* of an environment variable that holds your `osler_mcp_…` token, e.g. `OSLER_MCP_TOKEN` — never paste the token itself here |
| **Headers** | Leave empty (the bearer field supplies auth) |
| **Headers from environment variables** | Leave empty (optional escape hatch for extra headers without hardcoding them) |

Save, then create the variable with the token you copied from
**Settings → AI Agents** and fully restart Codex (env vars are only read at
process start):

```powershell
setx OSLER_MCP_TOKEN "osler_mcp_..."
```

Equivalent `~/.codex/config.toml` if you prefer editing the file directly:

```toml
[mcp_servers.osler-admin]
url = "https://<worker-host>/v1/mcp"
bearer_token_env_var = "OSLER_MCP_TOKEN"
```

## Tools

| Tool | Purpose |
|---|---|
| `list_content_objects` | List your managed objects by status/title |
| `get_content_object` | Fetch one object with its body |
| `create_content_draft` | Create an empty draft (prefer the batch tool) |
| `update_draft_body` | Replace a draft's body (≤1 MB) |
| `upload_asset` | Upload one asset (data URI or text) into a pack |
| `validate_content` | Run the server-side schema validator |
| `submit_for_review` | Draft → pending approval queue |
| `create_content_pack` | **Batch:** draft + body + up to 30 assets + optional validation + optional submit, one call |
| `read_content_file` | Read a student-facing pack/manifest file |
| `list_content_files` | Browse `content-files/` keys |

The server also exposes prompts: `qbank_from_pdf` and `flashcards_from_notes`
(see `cloudflare/worker/src/mcp/instructions.ts`), plus a detailed
`instructions` field on `initialize` describing every engine's JSON shape
(`quiz`, `bank`, `written`, `flashcard`, `osce`, `video`, `library`).

## Example: PDF → QBank pipeline

1. Give the agent the PDF path/URL (or its extracted text).
2. Ask it to use the `qbank_from_pdf` prompt (or just describe the goal).
3. The agent studies an existing pack via `read_content_file`, transforms the
   material offline, calls `validate_content`, then uploads once with
   `create_content_pack(..., submit: true)`.
4. An admin approves the object in **Admin → Review**; only then does it go
   live and appear in manifests.

## Security notes

- Tokens are `osler_mcp_…` opaque strings; only a SHA-256 hash is stored, and
  usage is stamped (`last_used_at`) and audit-logged (`mcp_*` actions chain
  into the tamper-evident audit log).
- Revoke instantly from Settings → AI Agents; expiry is enforced per request.
- Requests share the worker's `admin` rate-limit bucket (600/min/IP) and pass
  through the same origin gate as first-party traffic.
- Free-tier budget: Workers 100k req/day, D1 5M row-reads/day, R2 1M class-A
  ops/month — a bulk import typically costs a handful of requests.
