-- 00025 MCP over OAuth: calls made with a signed-in user (no API key) are
-- logged and rate-limited by user. Safe to re-run.
alter table public.mcp_audit_log
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_mcp_audit_log_user_recent
  on public.mcp_audit_log(user_id, created_at desc);
