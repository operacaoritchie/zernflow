import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Cron routes are called with `Authorization: Bearer <CRON_SECRET>`.
 *
 * The secret is only read from the header: a secret in the query string ends
 * up in access logs and browser history. The comparison is constant-time.
 * With no CRON_SECRET configured every call is refused.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)\s*$/.exec(header) : null;
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
