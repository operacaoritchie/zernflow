"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";

interface EnrollSequencePanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

interface SequenceOption {
  id: string;
  name: string;
  status: string;
}

export function EnrollSequencePanel({ data, onChange }: EnrollSequencePanelProps) {
  const [sequences, setSequences] = useState<SequenceOption[]>([]);
  const t = useT("builder");
  const tc = useT("common");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("sequences")
        .select("id, name, status")
        .order("name", { ascending: true });

      setSequences(rows ?? []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-medium text-foreground">
          {t("nodeTypes.enrollSequence")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("enroll.description")}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold text-muted-foreground">
          {t("enroll.sequence")}
        </label>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("enroll.loading")}
          </div>
        ) : sequences.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("enroll.empty")}
          </p>
        ) : (
          <select
            value={(data.sequenceId as string) || ""}
            onChange={(e) => onChange({ ...data, sequenceId: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("enroll.select")}</option>
            {sequences.map((seq) => (
              <option key={seq.id} value={seq.id}>
                {seq.name} ({tc(seq.status)})
              </option>
            ))}
          </select>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("enroll.hint")}
        </p>
      </div>
    </div>
  );
}
