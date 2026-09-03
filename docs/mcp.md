# MCP Server — AI-agent content authoring

Osler ships an MCP (Model Context Protocol) server on the same Cloudflare
Worker that serves the app (`POST /v1/mcp`, Streamable HTTP transport). It lets
administrators connect AI agents (Claude Code, Claude Desktop, Cursor, …) to
author content: parse source material into Osler packs, upload everything in
one batch, run server-side validation, and submit work for review.

## Approval model

By default, tokens are minted with **content_admin** scope, which is capped
at the authoring surface:

| content_admin token can | content_admin token cannot |
|---|---|
| create drafts, write bodies, upload assets | publish / approve |
| validate against the platform schema | reject / schedule |
| read published packs + manifests for reference | delete objects or edit config |
| submit drafts to the review queue | touch users, stats, sessions |

Submitted packs land in `status = "pending"` and must be approved by an admin
(role `admin`) through the web admin panel's review queue before students see
anything — **for a content_admin-scoped token**.

A site admin can also mint an **admin**-scoped token from the same panel.
That's a materially different trust level: `publish_content`,
`approve_content`, `reject_content`, `unpublish_content`,
`delete_content_object`, `update_published_content`, and `update_config` are
all real MCP tools, gated only on the token's scope, not on any
human-in-the-loop step — an agent holding an admin-scoped token can approve
and publish its own submissions, delete content, and rewrite the site config
autonomously. Only mint admin scope for an agent you'd trust with direct
production write access; use the default content_admin scope for anything
you want a human to review first.

## Setup

1. Apply the migration: `npm run db:migrate` (in `cloudflare/worker/`).
2. Deploy the worker: `npm run deploy:worker`.
3. Connect your client (OAuth below — recommended — or a manual token from **Settings → AI Agents**).

### Claude (web & desktop) — OAuth, no token copying

1. In Claude: **Settings → Connectors → Add custom connector** (desktop:
   **Settings → Connectors → Browse connectors → Add custom connector**).
2. Paste the MCP endpoint URL: `https://<worker-host>/v1/mcp`.
3. A browser window opens asking you to sign in to your Osler admin site and
   approve the client. Approve — you're connected.

Under the hood the client discovers the OAuth metadata automatically
(`/.well-known/oauth-authorization-server`), registers itself (dynamic
client registration, PKCE S256), and exchanges the authorization code for a
token whose scope you pick on the consent page: **Content authoring**
(`content_admin`, the default — capped at the authoring surface above) or
**Full admin** (`admin` — the unrestricted tier, gated behind the same
admin-only tools as a manual admin token). Only an approver with role
`admin` is offered the full-admin option, and the worker enforces that
server-side: a `content_admin` approver can only ever grant
`content_admin`, so privilege can never escalate through OAuth. That token
is an ordinary row in **Settings → AI Agents** — visible, renameable by
re-minting, and revocable like any manual token; audit actions
`mcp_oauth_authorize` / `mcp_oauth_token_grant` record who approved what
(including the granted scope).

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

Cursor and other OAuth-aware clients can also just take the URL — leave the
headers empty and complete the browser sign-in when prompted.

### Manual token (any client)

Mint a token in **Settings → AI Agents** (optionally with an expiry), then:

#### Claude Code

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
| `parse_pdf` | Extract page-by-page text from a PDF supplied inline (base64, ≤20 MB) |
| `parse_qbank_pdf` | Parse an exam PDF into a draft `{ questions }` — options, inline/tabular answer keys, explanations |
| `parse_written_pdf` | Parse a written-exam PDF into a draft `{ prompts }` — marks, model answers, marking schemes |
| `submit_for_review` | Draft → pending approval queue |
| `create_content_pack` | **Batch:** draft + body + up to 30 assets + optional validation + optional submit, one call |
| `read_content_file` | Read a student-facing pack/manifest file |
| `list_content_files` | Browse `content-files/` keys |

The server also exposes **prompts** — these surface in the client's slash
(`/`) menu (Claude, Cursor, Codex, …) as ready-made workflows:

| Prompt | Purpose |
|---|---|
| `qbank_from_pdf` | Parse a PDF/notes into a best-of-five QBank pack |
| `flashcards_from_notes` | Turn notes into a basic + cloze flashcard deck |
| `osce_station_from_case` | Author a full OSCE station with scored rubric |
| `written_set_from_topic` | Written prompts with model answers + rubrics |
| `article_with_sidecar` | Library article with sidecar metadata |
| `content_quality_review` | Audit an existing pack and apply safe fixes |
| `translate_pack` | Translate a pack (schema/ids/images preserved) |

The `instructions` field on `initialize` describes every engine's JSON shape
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
  usage is stamped (`last_used_at`, reliably — the write is registered with
  `ExecutionContext.waitUntil` so it survives the response being returned)
  and audit-logged (`mcp_*` actions chain into the tamper-evident audit log).
- Revoke instantly from Settings → AI Agents; expiry is enforced per request.
- **OAuth flow**: authorization codes are single-use, 10-minute TTL, SHA-256
  hashed, and bound to client_id + redirect_uri + PKCE (S256 only — `plain`
  is refused). Registered redirect URIs must be `https://`, loopback
  `http://localhost[:port]`, or a custom app scheme, and never carry a
  fragment. The granted scope is approver-chosen (`content_admin` default,
  `admin` only grantable by `admin` approvers — enforced at both authorize
  and token time, including a demotion re-check), and exchanged tokens land
  in the same revocable token list.
- Non-POST requests are rejected before any token lookup, so scans/bots
  hitting this public path don't cost a D1 round-trip.
- Rate limiting is layered: requests first pass through the worker's shared
  `admin` bucket (600/min/IP) — the same gate first-party admin-panel traffic
  uses — and, once authenticated, each token additionally has its own
  240/min budget. The per-token layer exists because the per-IP bucket alone
  means every token that happens to call out from the same egress IP (a
  hosted agent platform, a shared office NAT) draws from one shared pool —
  without it, a single busy agent could both exhaust its own budget and
  crowd out unrelated tokens or the human admin panel on that IP.
- A single JSON-RPC batch request is capped at 25 entries — without a cap,
  one HTTP request (which only counts once against the rate limit) could
  carry an unbounded number of `tools/call` entries, each doing real D1/R2
  work, turning the batch array into a rate-limit bypass.
- The request body is capped at 30 MB, enforced while the body is streamed
  in rather than by trusting the `Content-Length` header, which a request
  using chunked transfer-encoding can omit or misstate.
- Free-tier budget: Workers 100k req/day, D1 5M row-reads/day, R2 1M class-A
  ops/month — a bulk import typically costs a handful of requests.
