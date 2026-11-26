-- Live comment trigger: comments made during an Instagram Live arrive on the
-- same comment.received webhook with comment.isLive = true, and run flows whose
-- trigger is `live_comment` (never `comment_keyword`).
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers
  ADD CONSTRAINT triggers_type_check
  CHECK (type IN ('keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'live_comment'));
