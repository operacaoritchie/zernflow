-- 00026 Security hardening (audit of 2026-11-28). Safe to re-run.

-- 1. A Zernio account can be active in only one workspace. Without this, any
--    signed-in user could register a channel with someone else's account id in
--    their own workspace; the webhook's single-row channel lookup then failed
--    and inbound automations stopped.
create unique index if not exists channels_late_account_id_active_key
  on public.channels (late_account_id) where is_active;

-- 2. This SELECT policy joined contact_custom_fields to itself, so every read
--    as a signed-in user failed with "infinite recursion detected in policy".
--    "Users can manage contact custom fields" (FOR ALL) already covers reads.
drop policy if exists "Users can view contact custom fields" on public.contact_custom_fields;

-- 3. Only owners and admins may update a workspace row (API key, webhook
--    secret, sending rules). Plain members could do it through the Data API.
drop policy if exists "Users can update their workspaces" on public.workspaces;
drop policy if exists "Admins can update their workspaces" on public.workspaces;
create policy "Admins can update their workspaces" on public.workspaces
  for update to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')))
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')));

-- 4. Invites: only the workspace owner may change one (accepting goes through
--    the service role). The old policy also let the invited e-mail rewrite the
--    row, including workspace_id and role, and was only held back by a
--    permission error on auth.users.
drop policy if exists workspace_invites_update on public.workspace_invites;
create policy workspace_invites_update on public.workspace_invites
  for update to authenticated
  using (workspace_id in (
    select wm.workspace_id from public.workspace_members wm
    where wm.user_id = (select auth.uid()) and wm.role = 'owner'))
  with check (workspace_id in (
    select wm.workspace_id from public.workspace_members wm
    where wm.user_id = (select auth.uid()) and wm.role = 'owner'));

alter table public.workspace_invites
  drop constraint if exists workspace_invites_role_check,
  add constraint workspace_invites_role_check check (role in ('member', 'admin'));

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check,
  add constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'));
