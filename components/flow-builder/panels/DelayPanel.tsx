"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { useT, useFormatter } from "@/lib/i18n/provider";

type DelayUnit = "seconds" | "minutes" | "hours" | "days";
type DelayMode = "duration" | "until";

interface DelayPanelData {
  duration?: number;
  unit?: DelayUnit;
  waitUntil?: string;
  [key: string]: unknown;
}

interface DelayPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const unitOptions: Array<{ value: DelayUnit }> = [
  { value: "seconds" },
  { value: "minutes" },
  { value: "hours" },
  { value: "days" },
];

const presets: Array<{ key: string; duration: number; unit: DelayUnit }> = [
  { key: "30s", duration: 30, unit: "seconds" },
  { key: "5m", duration: 5, unit: "minutes" },
  { key: "1h", duration: 1, unit: "hours" },
  { key: "1d", duration: 1, unit: "days" },
  { key: "3d", duration: 3, unit: "days" },
  { key: "7d", duration: 7, unit: "days" },
];

export function DelayPanel({ data: rawData, onChange }: DelayPanelProps) {
  const data = rawData as DelayPanelData;
  const t = useT("builder");
  const format = useFormatter();
  const duration = data.duration || 0;
  const unit = data.unit || "minutes";
  const [mode, setMode] = useState<DelayMode>(data.waitUntil ? "until" : "duration");

  const handleModeChange = useCallback(
    (newMode: DelayMode) => {
      setMode(newMode);
      if (newMode === "duration") {
        onChange({ duration: data.duration || 5, unit: data.unit || "minutes", waitUntil: undefined });
      } else {
        onChange({ ...data, waitUntil: data.waitUntil || "" });
      }
    },
    [data, onChange]
  );

  const applyPreset = useCallback(
    (preset: { duration: number; unit: DelayUnit }) => {
      setMode("duration");
      onChange({ duration: preset.duration, unit: preset.unit, waitUntil: undefined });
    },
    [onChange]
  );

  return (
    <div className="space-y-5">
      {/* Mode Toggle */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          {t("delay.type")}
        </label>
        <div className="flex rounded-lg border border-border bg-muted p-1">
          <button
            type="button"
            onClick={() => handleModeChange("duration")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "duration"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("delay.forDuration")}
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("until")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "until"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("delay.until")}
          </button>
        </div>
      </div>

      {mode === "duration" ? (
        <>
          {/* Duration Input */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">
              {t("delay.duration")}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={duration}
                onChange={(e) =>
                  onChange({ ...data, duration: Math.max(0, parseInt(e.target.value) || 0), waitUntil: undefined })
                }
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <select
                value={unit}
                onChange={(e) =>
                  onChange({ ...data, unit: e.target.value as DelayUnit, waitUntil: undefined })
                }
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                {unitOptions.map((u) => (
                  <option key={u.value} value={u.value}>
                    {t(`unitOptions.${u.value}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Presets */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">
              {t("delay.quickPresets")}
            </label>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => {
                const isActive = duration === preset.duration && unit === preset.unit;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-purple-500 text-white"
                        : "border border-border bg-card text-muted-foreground hover:border-purple-300 hover:text-purple-600"
                    )}
                  >
                    {t(`delay.presets.${preset.key}`)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Wait Until */
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            {t("delay.untilDateTime")}
          </label>
          <input
            type="datetime-local"
            value={data.waitUntil || ""}
            onChange={(e) => onChange({ ...data, waitUntil: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("delay.untilHint")}
          </p>
        </div>
      )}

      {/* Summary */}
      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="text-xs font-medium text-muted-foreground">{t("preview")}</p>
        <p className="mt-1 text-sm text-foreground">
          {mode === "duration"
            ? duration > 0
              ? t("delay.summaryDuration", { duration, unit: t(`units.${unit}`) })
              : t("delay.noDelay")
            : data.waitUntil
              ? t("delay.summaryUntil", { date: format.dateTime(data.waitUntil) })
              : t("delay.noDate")}
        </p>
      </div>
    </div>
  );
}
