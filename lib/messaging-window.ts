/**
 * Meta's messaging windows on Instagram and Facebook, shared by the flow
 * engine (server) and the inbox (browser).
 */

/** Meta's standard messaging window for automated messages. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Replies typed by a person (HUMAN_AGENT tag) are allowed this long. */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const WINDOWED_PLATFORMS = new Set(["instagram", "facebook"]);

/** Whether an automated message may go out now, given when the contact last
 *  wrote. Unknown (null) is allowed: conversations from before the column
 *  existed have no value, and Meta still has the final say. */
export function insideMessagingWindow(
  platform: string | null | undefined,
  lastInboundAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (!platform || !WINDOWED_PLATFORMS.has(platform)) return true;
  if (!lastInboundAt) return true;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t <= MESSAGING_WINDOW_MS;
}

export type WindowState =
  | { kind: "none" }
  | { kind: "open"; msLeft: number }
  | { kind: "human"; msLeft: number }
  | { kind: "closed" };

/** Where a conversation stands for a reply sent now. */
export function messagingWindowState(
  platform: string | null | undefined,
  lastInboundAt: string | null | undefined,
  now = Date.now()
): WindowState {
  if (!platform || !WINDOWED_PLATFORMS.has(platform) || !lastInboundAt) return { kind: "none" };
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return { kind: "none" };
  const since = now - t;
  if (since <= MESSAGING_WINDOW_MS) return { kind: "open", msLeft: MESSAGING_WINDOW_MS - since };
  if (since <= HUMAN_AGENT_WINDOW_MS) return { kind: "human", msLeft: HUMAN_AGENT_WINDOW_MS - since };
  return { kind: "closed" };
}
