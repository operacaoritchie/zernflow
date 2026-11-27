/**
 * Outbound sends for broadcasts and sequences, straight against the Zernio
 * REST API so every call carries an Idempotency-Key (a retried job replays
 * the first send instead of messaging the contact twice) and every failure
 * keeps its HTTP status for classifySendError.
 */

import { createHash } from "node:crypto";

const ZERNIO_API = "https://zernio.com/api/v1";

/**
 * Deterministic UUID-shaped key from a seed such as "broadcast:<recipientId>",
 * so every retry of the same send carries the same Idempotency-Key.
 */
export function idempotencyKeyFor(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class ZernioSendError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null for network errors / timeouts */
    public status: number | null
  ) {
    super(message);
    this.name = "ZernioSendError";
  }
}

async function post(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new ZernioSendError(err instanceof Error ? err.message : String(err), null);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const obj = (json ?? {}) as Record<string, unknown>;
    const nested = obj.error as Record<string, unknown> | string | undefined;
    const platformError = obj.platformError as Record<string, unknown> | undefined;
    const parts = [
      typeof nested === "string" ? nested : (nested?.message as string | undefined),
      obj.message as string | undefined,
      obj.code as string | undefined,
      platformError ? `${platformError.code ?? ""} ${platformError.message ?? ""}`.trim() : undefined,
    ].filter((p): p is string => !!p);
    const message = parts.join(" · ") || text.slice(0, 300) || `Zernio API error ${res.status}`;
    throw new ZernioSendError(message.slice(0, 500), res.status);
  }

  const obj = (json ?? {}) as Record<string, unknown>;
  return ((obj.data as Record<string, unknown>) ?? obj) || {};
}

export interface SendResult {
  messageId: string | null;
  conversationId: string | null;
}

/** Free-form text into an existing conversation (inside the 24-hour window). */
export async function sendFreeform(
  apiKey: string,
  input: { accountId: string; conversationId: string; text: string; idempotencyKey: string }
): Promise<SendResult> {
  const data = await post(
    apiKey,
    `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    { accountId: input.accountId, message: input.text },
    input.idempotencyKey
  );
  return {
    messageId: (data.messageId as string) ?? (data.id as string) ?? null,
    conversationId: input.conversationId,
  };
}

/** Approved WhatsApp template to a phone (opens or reuses the conversation). */
export async function sendTemplateMessage(
  apiKey: string,
  input: {
    accountId: string;
    phone: string;
    templateName: string;
    templateLanguage: string;
    templateParams: string[];
    idempotencyKey: string;
  }
): Promise<SendResult> {
  const data = await post(
    apiKey,
    "/inbox/conversations",
    {
      accountId: input.accountId,
      participantId: input.phone,
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      templateParams: input.templateParams,
    },
    input.idempotencyKey
  );
  return {
    messageId: (data.messageId as string) ?? null,
    conversationId: (data.conversationId as string) ?? null,
  };
}
