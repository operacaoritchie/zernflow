"use client";

import { useCallback } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";

interface Condition {
  field: string;
  operator: string;
  value: string;
}

interface ConditionPanelData {
  conditions?: Condition[];
  logic?: "and" | "or";
  [key: string]: unknown;
}

interface ConditionPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const fieldOptions = [
  { value: "tag" },
  { value: "custom_field" },
  { value: "platform" },
  { value: "variable" },
  { value: "is_subscribed" },
  { value: "last_interaction" },
];

const operatorOptions = [
  { value: "equals" },
  { value: "not_equals" },
  { value: "contains" },
  { value: "exists" },
  { value: "gt" },
  { value: "lt" },
  { value: "is_phone" },
];

export function ConditionPanel({ data: rawData, onChange }: ConditionPanelProps) {
  const data = rawData as ConditionPanelData;
  const t = useT("builder");
  const conditions = data.conditions || [];
  const logic = data.logic || "and";

  const addCondition = useCallback(() => {
    onChange({
      ...data,
      conditions: [...conditions, { field: "tag", operator: "equals", value: "" }],
    });
  }, [data, conditions, onChange]);

  const updateCondition = useCallback(
    (index: number, updated: Condition) => {
      const updated_conditions = [...conditions];
      updated_conditions[index] = updated;
      onChange({ ...data, conditions: updated_conditions });
    },
    [data, conditions, onChange]
  );

  const removeCondition = useCallback(
    (index: number) => {
      onChange({ ...data, conditions: conditions.filter((_, i) => i !== index) });
    },
    [data, conditions, onChange]
  );

  const toggleLogic = useCallback(() => {
    onChange({ ...data, logic: logic === "and" ? "or" : "and" });
  }, [data, logic, onChange]);

  return (
    <div className="space-y-4">
      {/* Logic Toggle */}
      {conditions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("condition.match")}</span>
          <button
            type="button"
            onClick={toggleLogic}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              logic === "and"
                ? "bg-amber-100 text-amber-700"
                : "bg-blue-100 text-blue-700"
            )}
          >
            {logic === "and" ? t("condition.all") : t("condition.any")}
          </button>
          <span className="text-xs text-muted-foreground">{t("condition.conditionsWord")}</span>
        </div>
      )}

      {/* Conditions List */}
      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div key={index}>
            {index > 0 && (
              <div className="my-2 flex items-center justify-center">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                    logic === "and"
                      ? "bg-amber-100 text-amber-600"
                      : "bg-blue-100 text-blue-600"
                  )}
                >
                  {t(`logic.${logic}`)}
                </span>
              </div>
            )}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("condition.numbered", { n: index + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => removeCondition(index)}
                  className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {/* Field */}
              <div className="space-y-2">
                <select
                  value={condition.field}
                  onChange={(e) =>
                    updateCondition(index, { ...condition, field: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {fieldOptions.map((f) => (
                    <option key={f.value} value={f.value}>
                      {t(`fields.${f.value}`)}
                    </option>
                  ))}
                </select>

                {/* Operator */}
                <select
                  value={condition.operator}
                  onChange={(e) =>
                    updateCondition(index, { ...condition, operator: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {operatorOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(`operatorOptions.${o.value}`)}
                    </option>
                  ))}
                </select>

                {/* Value (hidden for operators that take none) */}
                {condition.operator !== "exists" && condition.operator !== "is_phone" && (
                  <input
                    type="text"
                    value={condition.value}
                    onChange={(e) =>
                      updateCondition(index, { ...condition, value: e.target.value })
                    }
                    placeholder={t("condition.valuePlaceholder")}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Condition */}
      <button
        type="button"
        onClick={addCondition}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-amber-400 hover:text-amber-500"
      >
        <Plus className="h-4 w-4" />
        {t("condition.add")}
      </button>

      {conditions.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {t("condition.hint")}
        </p>
      )}
    </div>
  );
}
