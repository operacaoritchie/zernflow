-- 00022 Export log: who exported which contact list, when, and how many rows.
-- Written by the server (service role) from /api/v1/contacts/export; workspace
-- members can read their workspace's log. Safe to re-run.

create table if not exists public.export_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  format text not null,
  preset text not null,
  filters jsonb not null default '{}'::jsonb,
  row_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_export_logs_workspace
  on public.export_logs(workspace_id, created_at desc);

alter table public.export_logs enable row level security;

drop policy if exists "Members can read export logs" on public.export_logs;
create policy "Members can read export logs"
  on public.export_logs for select
  using (public.is_workspace_member(workspace_id));
