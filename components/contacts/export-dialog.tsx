"use client";

import { useState } from "react";
import { Download, X, Instagram, Table2, Target, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import type { ExportFormat, ExportPreset } from "@/lib/contacts-export";

const FORMATS: { id: ExportFormat; icon: typeof Table2 }[] = [
  { id: "full", icon: Table2 },
  { id: "ig_audience", icon: Instagram },
  { id: "meta_customers", icon: Target },
];
const PRESETS: ExportPreset[] = ["all", "instagram", "leads"];

export function ExportDialog({
  open,
  onClose,
  tagName,
  search,
}: {
  open: boolean;
  onClose: () => void;
  /** Tag currently selected in the contacts list, if any. */
  tagName: string | null;
  search: string;
}) {
  const t = useT("contacts.export");
  const [format, setFormat] = useState<ExportFormat>("full");
  const [preset, setPreset] = useState<ExportPreset>("all");
  const [useFilters, setUseFilters] = useState(true);
  const [includeCpf, setIncludeCpf] = useState(false);

  if (!open) return null;

  const hasFilters = !!tagName || !!search.trim();
  const params = new URLSearchParams({ format, preset });
  if (useFilters && tagName) params.set("tag", tagName);
  if (useFilters && search.trim()) params.set("search", search.trim());
  if (format === "full" && includeCpf) params.set("cpf", "1");
  const href = `/api/v1/contacts/export?${params.toString()}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="export-title" className="text-lg font-semibold">
              {t("title")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Who */}
        <fieldset className="mt-5">
          <legend className="text-xs font-medium uppercase text-muted-foreground">{t("who")}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={preset === p}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  preset === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {t(`presets.${p}`)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{t(`presetHints.${preset}`)}</p>
          {hasFilters && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useFilters}
                onChange={(e) => setUseFilters(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              {t("useFilters", {
                filters: [tagName ? `#${tagName}` : "", search.trim() ? `"${search.trim()}"` : ""]
                  .filter(Boolean)
                  .join(" + "),
              })}
            </label>
          )}
        </fieldset>

        {/* Format */}
        <fieldset className="mt-5">
          <legend className="text-xs font-medium uppercase text-muted-foreground">{t("format")}</legend>
          <div className="mt-2 space-y-2">
            {FORMATS.map(({ id, icon: Icon }) => (
              <label
                key={id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  format === id ? "border-primary bg-primary/5" : "border-input hover:bg-accent/50"
                )}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={id}
                  checked={format === id}
                  onChange={() => setFormat(id)}
                  className="sr-only"
                />
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", format === id ? "text-primary" : "text-muted-foreground")} />
                <span>
                  <span className="block text-sm font-medium">{t(`formats.${id}.label`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`formats.${id}.hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {format === "full" && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeCpf}
              onChange={(e) => setIncludeCpf(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            {t("includeCpf")}
          </label>
        )}

        {format !== "full" && (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Info className="h-3.5 w-3.5" />
              {t("howTo")}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              {[1, 2, 3, 4].map((n) => (
                <li key={n}>{t(`steps.${format}.${n}`)}</li>
              ))}
            </ol>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">{t("privacy")}</p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {t("cancel")}
          </button>
          <a
            href={href}
            download
            onClick={() => setTimeout(onClose, 300)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            {t("download")}
          </a>
        </div>
      </div>
    </div>
  );
}
