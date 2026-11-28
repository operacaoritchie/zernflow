-- 00024 MCP: scoped API keys, audit log and two-step confirmations. Safe to re-run.
-- (Confirm 00024 is the next free number in Supabase before applying.)

-- ── api_keys: scopes, expiry, revocation ──────────────────────────────────────
-- Scopes: read (queries), write (changes data, never talks to a lead),
-- act (publishes, sends). Existing keys (none in use) default to read only.
alter table public.api_keys
  add column if not exists scopes text[] not null default array['read']::text[],
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

alter table public.api_keys drop constraint if exists api_keys_scopes_check;
alter table public.api_keys
  add constraint api_keys_scopes_check
  check (scopes <@ array['read','write','act']::text[] and cardinality(scopes) > 0);

-- Members may list keys, but only the server (service role, after checking
-- owner/admin) creates, edits or revokes them. The old "manage" policy let any
-- member raise a key's scopes straight from the browser.
drop policy if exists "Users can manage api_keys in their workspaces" on public.api_keys;

-- ── MCP audit log ─────────────────────────────────────────────────────────────
create table if not exists public.mcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  tool text not null,
  args_summary jsonb not null default '{}'::jsonb,
  ok boolean not null,
  error text,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_audit_log_workspace
  on public.mcp_audit_log(workspace_id, created_at desc);
create index if not exists idx_mcp_audit_log_key_recent
  on public.mcp_audit_log(api_key_id, created_at desc);

alter table public.mcp_audit_log enable row level security;
drop policy if exists "Members can read MCP audit log" on public.mcp_audit_log;
create policy "Members can read MCP audit log"
  on public.mcp_audit_log for select
  using (public.is_workspace_member(workspace_id));

-- ── Two-step confirmations (used from Phase 3) ────────────────────────────────
create table if not exists public.mcp_confirmations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete cascade,
  tool text not null,
  token_hash text not null unique,
  args_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_confirmations enable row level security;
-- No policies: only the service role (the app server) touches this table.
