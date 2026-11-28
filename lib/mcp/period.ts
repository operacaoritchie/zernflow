/** Brazil has had no daylight saving since 2019, so São Paulo is a fixed UTC-3. */
const BR_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PERIODS = ["today", "yesterday", "last_7_days", "last_30_days"] as const;
export type Period = (typeof PERIODS)[number];

export function isPeriod(v: unknown): v is Period {
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v);
}

/** Start of the Brazilian calendar day that contains `now`, as a UTC instant. */
export function startOfBrazilDay(now: Date): Date {
  const local = new Date(now.getTime() + BR_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - BR_OFFSET_MS);
}

/** [from, to) of a named period in Brazil time. `to` is null when open-ended (up to now). */
export function periodRange(period: Period, now = new Date()): { from: string; to: string | null } {
  const today = startOfBrazilDay(now).getTime();
  switch (period) {
    case "today":
      return { from: new Date(today).toISOString(), to: null };
    case "yesterday":
      return { from: new Date(today - DAY_MS).toISOString(), to: new Date(today).toISOString() };
    case "last_7_days":
      return { from: new Date(today - 6 * DAY_MS).toISOString(), to: null };
    case "last_30_days":
      return { from: new Date(today - 29 * DAY_MS).toISOString(), to: null };
  }
}
