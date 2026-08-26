-- Support tickets: user-reported problems filed from Settings, QBank question
-- reports and Library article reports. Guests may submit (user_id NULL);
-- admins triage status/reply via /v1/admin/tickets.
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS support_tickets_status_created ON support_tickets(status, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets(user_id, created_at);
