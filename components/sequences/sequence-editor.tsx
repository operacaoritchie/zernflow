"use client";

import { useState, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  MessageSquare,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { updateSequence, deleteSequence } from "@/lib/actions/sequences";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { SequenceStep } from "@/lib/types/database";
import { useT } from "@/lib/i18n/provider";

interface SequenceEditorProps {
  sequence: {
    id: string;
    name: string;
    description: string | null;
    status: "draft" | "active" | "paused";
    steps: SequenceStep[];
  };
}

const statusConfig = {
  draft: {
    label: "Draft",
    classes: "bg-muted text-muted-foreground",
  },
  active: {
    label: "Active",
    classes:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  paused: {
    label: "Paused",
    classes:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

export function SequenceEditor({ sequence }: SequenceEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const t = useT("sequences");
  const tc = useT("common");
  const [description, setDescription] = useState(sequence.description || "");
  const [steps, setSteps] = useState<SequenceStep[]>(sequence.steps);
  const [status, setStatus] = useState(sequence.status);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasMessageStep = steps.some((s) => s.type === "message");

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const result = await updateSequence(sequence.id, {
      name: name.trim(),
      description: description.trim() || null,
      steps,
      status,
    });

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(tc("saved"));
      setTimeout(() => setSuccess(null), 2000);
    }
    setSaving(false);
  }, [sequence.id, name, description, steps, status]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const result = await deleteSequence(sequence.id);
    if (result.error) {
      setError(result.error);
      setDeleting(false);
    } else {
      router.push("/dashboard/sequences");
    }
  }, [sequence.id, router]);

  const addStep = useCallback(
    (index: number, type: "message" | "delay") => {
      const newStep: SequenceStep =
        type === "message"
          ? { type: "message", content: "" }
          : { type: "delay", delayMinutes: 60 };

      const updated = [...steps];
      updated.splice(index, 0, newStep);
      setSteps(updated);
    },
    [steps]
  );

  const updateStep = useCallback(
    (index: number, data: Partial<SequenceStep>) => {
      const updated = [...steps];
      updated[index] = { ...updated[index], ...data };
      setSteps(updated);
    },
    [steps]
  );

  const removeStep = useCallback(
    (index: number) => {
      setSteps(steps.filter((_, i) => i !== index));
    },
    [steps]
  );

  const toggleStatus = useCallback(() => {
    if (status === "active") {
      setStatus("paused");
    } else {
      if (!hasMessageStep) {
        setError(t("addStepFirst"));
        return;
      }
      setStatus("active");
    }
  }, [status, hasMessageStep]);

  const statusInfo = statusConfig[status];

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard/sequences")}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-2xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0"
                placeholder={t("namePlaceholder")}
              />
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                  statusInfo.classes
                )}
              >
                {t(`status.${status}`)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleStatus}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                status === "active"
                  ? "border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
              )}
            >
              {status === "active" ? t("pause") : t("activate")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? tc("saving") : tc("save")}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              title={t("deleteTitle")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <ConfirmDialog
              open={confirmDelete}
              title={t("deleteTitle")}
              message={t("deleteMessage")}
              confirmLabel={tc("delete")}
              destructive
              onConfirm={() => {
                setConfirmDelete(false);
                handleDelete();
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 sm:px-8 sm:py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Messages */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          {/* Steps */}
          <div>
            <label className="mb-3 block text-sm font-medium">{t("steps")}</label>

            {/* Add button at the top */}
            <AddStepButton onAdd={(type) => addStep(0, type)} />

            {steps.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 sm:p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No steps yet. Click the + button above to add your first step.
                </p>
              </div>
            )}

            {steps.map((step, index) => (
              <div key={index}>
                <StepCard
                  step={step}
                  index={index}
                  onChange={(data) => updateStep(index, data)}
                  onRemove={() => removeStep(index)}
                />
                <AddStepButton onAdd={(type) => addStep(index + 1, type)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  index,
  onChange,
  onRemove,
}: {
  step: SequenceStep;
  index: number;
  onChange: (data: Partial<SequenceStep>) => void;
  onRemove: () => void;
}) {
  const isMessage = step.type === "message";
  const t = useT("sequences");

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-white",
              isMessage ? "bg-blue-500" : "bg-purple-500"
            )}
          >
            {isMessage ? (
              <MessageSquare className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              {isMessage ? t("stepMessage", { n: index + 1 }) : t("stepWait", { n: index + 1 })}
            </p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3">
        {isMessage ? (
          <textarea
            value={step.content || ""}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder={t("messagePlaceholder")}
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        ) : (
          <DelayPicker
            minutes={step.delayMinutes || 60}
            onChange={(delayMinutes) => onChange({ delayMinutes })}
          />
        )}
      </div>
    </div>
  );
}

function DelayPicker({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  // Convert minutes to the best unit
  let value: number;
  let unit: "minutes" | "hours" | "days";

  if (minutes >= 1440 && minutes % 1440 === 0) {
    value = minutes / 1440;
    unit = "days";
  } else if (minutes >= 60 && minutes % 60 === 0) {
    value = minutes / 60;
    unit = "hours";
  } else {
    value = minutes;
    unit = "minutes";
  }

  const [localValue, setLocalValue] = useState(value);
  const t = useT("sequences");
  const tb = useT("builder");
  const [localUnit, setLocalUnit] = useState(unit);

  function handleChange(newValue: number, newUnit: string) {
    const multipliers: Record<string, number> = {
      minutes: 1,
      hours: 60,
      days: 1440,
    };
    const totalMinutes = Math.max(1, newValue) * (multipliers[newUnit] || 1);
    onChange(totalMinutes);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("waitFor")}</span>
      <input
        type="number"
        min={1}
        value={localValue}
        onChange={(e) => {
          const v = parseInt(e.target.value) || 1;
          setLocalValue(v);
          handleChange(v, localUnit);
        }}
        className="w-20 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <select
        value={localUnit}
        onChange={(e) => {
          setLocalUnit(e.target.value as typeof localUnit);
          handleChange(localValue, e.target.value);
        }}
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="minutes">{tb("unitOptions.minutes")}</option>
        <option value="hours">{tb("unitOptions.hours")}</option>
        <option value="days">{tb("unitOptions.days")}</option>
      </select>
    </div>
  );
}

function AddStepButton({
  onAdd,
}: {
  onAdd: (type: "message" | "delay") => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useT("sequences");
  const tc = useT("common");

  return (
    <div className="flex justify-center py-2">
      {open ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onAdd("message");
              setOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            {t("message")}
          </button>
          <button
            onClick={() => {
              onAdd("delay");
              setOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <Clock className="h-3 w-3" />
            {t("wait")}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {tc("cancel")}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
