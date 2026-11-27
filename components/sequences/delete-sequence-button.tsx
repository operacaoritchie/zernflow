"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteSequence } from "@/lib/actions/sequences";
import { useT } from "@/lib/i18n/provider";

/** Trash button for a sequence card in the list (sits on top of the card link). */
export function DeleteSequenceButton({ sequenceId, name }: { sequenceId: string; name: string }) {
  const t = useT("sequences");
  const tc = useT("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={pending}
        aria-label={`${t("deleteTitle")}: ${name}`}
        title={t("deleteTitle")}
        className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={open}
        title={t("deleteTitle")}
        message={t("deleteMessage")}
        confirmLabel={tc("delete")}
        destructive
        onConfirm={() => {
          setOpen(false);
          setError(null);
          startTransition(async () => {
            const res = await deleteSequence(sequenceId);
            if (res && "error" in res && res.error) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
