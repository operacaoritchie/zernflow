"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageSquare, RefreshCw, User } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/types/database";
import { useT } from "@/lib/i18n/provider";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: Database["public"]["Tables"]["contacts"]["Row"] | null;
};
type Message = Database["public"]["Tables"]["messages"]["Row"];

export function InboxView({
  conversations,
  workspaceId,
}: {
  conversations: Conversation[];
  workspaceId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Conversation | null>(null);
  const t = useT("inbox");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  // On small screens the contact panel is a full-screen overlay, opened on demand
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Imports conversations that already exist in Zernio (e.g. from before the
  // webhook was registered), then refreshes the server-rendered list.
  async function handleSyncConversations() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/v1/channels/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSyncError(data.error || t("syncFailed"));
        return;
      }
      router.refresh();
    } catch {
      setSyncError(t("syncFailedConnection"));
    } finally {
      setSyncing(false);
    }
  }

  // Keep selected conversation in sync when conversation list updates
  const handleSelect = useCallback((c: Conversation) => {
    setSelected(c);
  }, []);

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      setLoadingMessages(true);
      try {
        const res = await fetch(
          `/api/v1/messages?conversationId=${selected!.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setMessages(data ?? []);
        } else {
          console.error("Failed to load messages:", res.status);
          setMessages([]);
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }

      // Mark as read
      if (selected!.unread_count > 0) {
        const supabase = createClient();
        await supabase
          .from("conversations")
          .update({ unread_count: 0 })
          .eq("id", selected!.id);
      }
    }

    loadMessages();
  }, [selected?.id]);

  const hasSelected = selected !== null;

  return (
    <div className="relative flex h-full">
      {/* Left panel: Conversation list (hidden on mobile while a chat is open) */}
      <div
        className={cn(
          "min-w-0 flex-shrink-0 md:block md:w-80",
          hasSelected ? "hidden" : "block w-full"
        )}
      >
        <ConversationList
          conversations={conversations}
          workspaceId={workspaceId}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
        />
      </div>

      {/* Center panel: Message thread (hidden on mobile until a chat is picked) */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col md:flex",
          hasSelected ? "flex" : "hidden"
        )}
      >
        {/* Mobile bar: back to list + contact info */}
        {selected && (
          <div className="flex shrink-0 items-center justify-between border-b border-border px-1 py-1 md:hidden">
            <button
              onClick={() => {
                setSelected(null);
                setMobileInfoOpen(false);
              }}
              className="flex h-10 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("backToList")}
            </button>
            {selected.contact_id && (
              <button
                onClick={() => setMobileInfoOpen(true)}
                className="flex h-10 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("showContactInfo")}
              >
                <User className="h-4 w-4" />
                {t("infoShort")}
              </button>
            )}
          </div>
        )}
        {/* Toggle contact panel button (desktop) */}
        {selected && !showContactPanel && (
          <div className="hidden shrink-0 justify-end border-b border-border px-2 py-1 md:flex">
            <button
              onClick={() => setShowContactPanel(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label={t("showContactInfo")}
            >
              <User className="h-3.5 w-3.5" />
              {t("contactInfo")}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                {t("noConversations")}
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                {t("syncHint")}
              </p>
              <button
                onClick={handleSyncConversations}
                disabled={syncing}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? t("syncing") : t("sync")}
              </button>
              {syncError && (
                <p className="mt-2 text-xs text-destructive">{syncError}</p>
              )}
            </div>
          ) : loadingMessages && selected ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : (
            <MessageThread
              conversation={selected}
              messages={messages}
            />
          )}
        </div>
      </div>

      {/* Right panel: Contact info (full-screen overlay on mobile, side panel on desktop) */}
      {selected?.contact_id && (
        <div
          className={cn(
            "absolute inset-0 z-30 bg-background md:static md:inset-auto md:z-auto",
            mobileInfoOpen ? "block" : "hidden",
            showContactPanel ? "md:block" : "md:hidden"
          )}
        >
          <ContactPanel
            contactId={selected.contact_id}
            conversationId={selected.id}
            workspaceId={workspaceId}
            onClose={() => {
              setMobileInfoOpen(false);
              if (window.matchMedia("(min-width: 768px)").matches) {
                setShowContactPanel(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
