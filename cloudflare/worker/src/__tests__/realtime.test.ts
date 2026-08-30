import { describe, it, expect } from "vitest";
import { mintRealtimeTicket, verifyRealtimeTicket, REALTIME_TICKET_TTL_MS } from "../realtime-hub";

const SECRETS = { JWT_SECRET: "test-secret" };

describe("realtime tickets", () => {
  it("mints a ticket that verifies back to the same session + user", async () => {
    const { ticket, expiresAt } = await mintRealtimeTicket(SECRETS, "sess-1", "user-1");
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + REALTIME_TICKET_TTL_MS);
    const verified = await verifyRealtimeTicket(SECRETS, ticket);
    expect(verified).toEqual({ userId: "user-1", sessionId: "sess-1" });
  });

  it("rejects a tampered signature", async () => {
    const { ticket } = await mintRealtimeTicket(SECRETS, "sess-1", "user-1");
    const [payload] = ticket.split(".");
    const forged = await mintRealtimeTicket({ JWT_SECRET: "other-secret" }, "sess-1", "user-1");
    expect(await verifyRealtimeTicket(SECRETS, `${payload}.${forged.ticket.split(".")[1]}`)).toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const { ticket } = await mintRealtimeTicket(SECRETS, "sess-1", "user-1", { ttlMs: -1_000 });
    expect(await verifyRealtimeTicket(SECRETS, ticket)).toBeNull();
  });

  it("rejects a session-shaped token without the rt type claim", async () => {
    // Session tokens carry { sub, sid, exp } with no `typ` — they must never
    // be accepted as realtime tickets.
    const payload = btoa(JSON.stringify({ sub: "user-1", sid: "sess-1", exp: Math.floor(Date.now() / 1000) + 3600 }))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const forged = await mintRealtimeTicket(SECRETS, "sess-1", "user-1");
    const signature = forged.ticket.split(".")[1];
    expect(await verifyRealtimeTicket(SECRETS, `${payload}.${signature}`)).toBeNull();
  });

  it("rejects malformed and oversized inputs", async () => {
    expect(await verifyRealtimeTicket(SECRETS, "")).toBeNull();
    expect(await verifyRealtimeTicket(SECRETS, "garbage")).toBeNull();
    expect(await verifyRealtimeTicket(SECRETS, "a.b.c")).toBeNull();
    expect(await verifyRealtimeTicket(SECRETS, `${"x".repeat(2000)}.${"y".repeat(100)}`)).toBeNull();
  });
});
