-- 00020: typed custom fields (phone, cpf) with default fields per workspace,
-- and the contact's last inbound message time for Meta's 24-hour window.
-- Safe to run more than once.

-- ── Field types ─────────────────────────────────────────────────────────────
ALTER TABLE public.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_type_check;
ALTER TABLE public.custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_type_check
  CHECK (type IN ('text', 'number', 'boolean', 'date', 'url', 'email', 'phone', 'cpf'));

-- ── Default fields: Telefone, E-mail, CPF ───────────────────────────────────
-- Every workspace gets them, so a flow can save a phone, e-mail or CPF with
-- validation without anyone creating the field first. Existing slugs win.
CREATE OR REPLACE FUNCTION public.create_default_custom_fields(ws_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.custom_field_definitions (workspace_id, name, slug, type)
  VALUES
    (ws_id, 'Telefone', 'telefone', 'phone'),
    (ws_id, 'E-mail',   'email',    'email'),
    (ws_id, 'CPF',      'cpf',      'cpf')
  ON CONFLICT (workspace_id, slug) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.create_default_custom_fields(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.workspaces_default_custom_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_default_custom_fields(NEW.id);
  RETURN NEW;
END;
$$;

-- Fired by the trigger only; not callable through the API.
REVOKE ALL ON FUNCTION public.workspaces_default_custom_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_default_custom_fields ON public.workspaces;
CREATE TRIGGER trg_workspaces_default_custom_fields
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_default_custom_fields();

SELECT public.create_default_custom_fields(id) FROM public.workspaces;

-- ── Messaging window ────────────────────────────────────────────────────────
-- When the contact last sent a message in this conversation. Instagram and
-- Facebook only allow automated messages within 24 hours of it, and replies
-- typed by a person (HUMAN_AGENT tag) within 7 days.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
