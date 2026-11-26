-- 00021 Lock down SECURITY DEFINER functions (Supabase security advisor).
--
-- Every function in public was executable by anon/authenticated through
-- /rest/v1/rpc/*. The counters below are only called by the app's server with
-- the service role (webhook, cron jobs, /r/[slug] page), so anyone could
-- otherwise inflate unread counts, broadcast stats or ref-link clicks.
--
-- is_workspace_member stays callable: the RLS policies of almost every table
-- call it as the signed-in user, and it only answers whether the caller
-- belongs to a workspace.
--
-- Safe to re-run.

-- Counters: server (service role) only.
REVOKE ALL ON FUNCTION public.increment_unread(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_broadcast_sent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_broadcast_failed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_ref_link_clicks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_ref_link_conversions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_unread(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_sent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_failed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_ref_link_clicks(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_ref_link_conversions(uuid) TO service_role;

-- Trigger functions run from their triggers; nobody needs to call them over RPC.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;

-- Event trigger function created by Supabase (ensure_rls); only exists on hosted
-- projects, so guard it.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Pin search_path so a caller cannot shadow the tables these functions use.
ALTER FUNCTION public.increment_unread(uuid, text) SET search_path = public;
ALTER FUNCTION public.increment_broadcast_sent(uuid) SET search_path = public;
ALTER FUNCTION public.increment_broadcast_failed(uuid) SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.is_workspace_member(uuid) SET search_path = public;
