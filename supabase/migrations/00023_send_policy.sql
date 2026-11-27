-- 00023 Send policy: rules for broadcasts and sequences (Meta windows, opt-in,
-- opt-out by phone, quiet hours) plus delivery tracking. Safe to re-run.

-- ── Workspace settings ────────────────────────────────────────────────────────
-- require_whatsapp_consent, quiet_hours {start,end,timeZone}, confirm_threshold,
-- bulk_sending_enabled, opt_out_reply. Defaults live in lib/workspace-settings.ts.
alter table public.workspaces
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- ── Contacts: WhatsApp opt-in and opt-out record ──────────────────────────────
alter table public.contacts
  add column if not exists opt_in_whatsapp_at timestamptz,
  add column if not exists opt_in_source text,
  add column if not exists opt_in_text text,
  add column if not exists opt_out_at timestamptz,
  add column if not exists opt_out_reason text;

-- ── Opt-out by phone number ───────────────────────────────────────────────────
-- The same person can be two contacts (Instagram profile + WhatsApp number);
-- a STOP on either blocks the number for every template send.
create table if not exists public.phone_opt_outs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, phone)
);
alter table public.phone_opt_outs enable row level security;
drop policy if exists "Members can read phone opt-outs" on public.phone_opt_outs;
create policy "Members can read phone opt-outs"
  on public.phone_opt_outs for select
  using (public.is_workspace_member(workspace_id));

-- ── Audit of every send decision ──────────────────────────────────────────────
create table if not exists public.send_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,            -- broadcast | sequence | test
  source_id uuid,                  -- broadcast id / enrollment id
  contact_id uuid references public.contacts(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  kind text,                       -- freeform | template
  decision text not null,          -- sent | skipped | failed | waiting
  reason text,
  platform_message_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_send_attempts_workspace on public.send_attempts(workspace_id, created_at desc);
create index if not exists idx_send_attempts_contact on public.send_attempts(contact_id, created_at desc);
alter table public.send_attempts enable row level security;
drop policy if exists "Members can read send attempts" on public.send_attempts;
create policy "Members can read send attempts"
  on public.send_attempts for select
  using (public.is_workspace_member(workspace_id));

-- ── Broadcasts: channel, WhatsApp template, pause ─────────────────────────────
alter table public.broadcasts
  add column if not exists channel_id uuid references public.channels(id) on delete set null,
  add column if not exists template jsonb,
  add column if not exists skipped integer not null default 0,
  add column if not exists read integer not null default 0,
  add column if not exists paused_at timestamptz;

alter table public.broadcasts drop constraint if exists broadcasts_status_check;
alter table public.broadcasts add constraint broadcasts_status_check
  check (status in ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled'));

alter table public.broadcast_recipients
  add column if not exists skip_reason text,
  add column if not exists phone text,
  add column if not exists platform_message_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;
create index if not exists idx_broadcast_recipients_platform_message
  on public.broadcast_recipients(platform_message_id)
  where platform_message_id is not null;
create index if not exists idx_broadcast_recipients_broadcast_status
  on public.broadcast_recipients(broadcast_id, status);

-- Counters recomputed from the recipient rows (no drift from retries).
create or replace function public.refresh_broadcast_counts(b_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.broadcasts b set
    sent      = c.sent,
    delivered = c.delivered,
    read      = c.read,
    failed    = c.failed,
    skipped   = c.skipped
  from (
    select
      count(*) filter (where status in ('sent', 'delivered', 'read')) as sent,
      count(*) filter (where status in ('delivered', 'read'))         as delivered,
      count(*) filter (where status = 'read')                         as read,
      count(*) filter (where status = 'failed')                       as failed,
      count(*) filter (where status = 'skipped')                      as skipped
    from public.broadcast_recipients
    where broadcast_id = b_id
  ) c
  where b.id = b_id;
$$;
revoke all on function public.refresh_broadcast_counts(uuid) from public, anon, authenticated;
grant execute on function public.refresh_broadcast_counts(uuid) to service_role;

-- ── Sequences: exit on reply, pause limit ─────────────────────────────────────
alter table public.sequences
  add column if not exists exit_on_reply boolean not null default false,
  add column if not exists max_pause_days integer not null default 30;

-- status: active | paused_window | completed | cancelled | exited | failed | expired
alter table public.sequence_enrollments
  add column if not exists last_error text,
  add column if not exists exit_reason text,
  add column if not exists paused_since timestamptz,
  add column if not exists step_job_id uuid,
  add column if not exists step_claimed_at timestamptz;
create index if not exists idx_sequence_enrollments_due
  on public.sequence_enrollments(status, next_step_at);
create index if not exists idx_sequence_enrollments_contact
  on public.sequence_enrollments(contact_id, status);
