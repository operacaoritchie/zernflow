/** Pure helpers for sequence steps (safe for the browser and the server). */

import type { SequenceStep } from "@/lib/types/database";

/** When the step at `index` should run, counted from `now`. */
export function nextStepAt(steps: SequenceStep[], index: number, now = Date.now()): string {
  const step = steps[index];
  if (step?.type === "delay" && step.delayMinutes && step.delayMinutes > 0) {
    return new Date(now + step.delayMinutes * 60 * 1000).toISOString();
  }
  return new Date(now).toISOString();
}

/** Problems that keep a sequence from being activated. Empty = ok. */
export function validateSteps(steps: SequenceStep[]): string[] {
  const problems: string[] = [];
  if (!steps.some((s) => s.type === "message" || s.type === "template")) problems.push("no_message_step");
  steps.forEach((s, i) => {
    if (s.type === "message" && !(s.content ?? "").trim()) problems.push(`empty_message:${i + 1}`);
    if (s.type === "delay" && !(Number(s.delayMinutes) > 0)) problems.push(`invalid_delay:${i + 1}`);
    if (s.type === "template" && (!s.channelId || !s.templateName || !s.templateLanguage)) {
      problems.push(`template_not_set:${i + 1}`);
    }
  });
  return problems;
}

/**
 * Text steps on Instagram/Facebook that come after a wait longer than 24h:
 * they only go out if the contact writes again first. Returns step numbers.
 */
export function stepsAfterLongWait(steps: SequenceStep[]): number[] {
  const out: number[] = [];
  let waited = 0;
  steps.forEach((s, i) => {
    if (s.type === "delay") waited += Number(s.delayMinutes) || 0;
    else if (s.type === "message") {
      if (waited > 24 * 60) out.push(i + 1);
      waited = 0;
    } else waited = 0;
  });
  return out;
}
