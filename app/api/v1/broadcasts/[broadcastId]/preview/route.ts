import { NextResponse } from "next/server";
import { buildAudience, checkBroadcastSetup } from "@/lib/broadcasts";
import { loadBroadcastForUser } from "@/lib/broadcast-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/v1/broadcasts/:broadcastId/preview
 *
 * Dry run of the send policy over the broadcast's audience: who would get it
 * right now and who is left out, by reason. Writes nothing, sends nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const auth = await loadBroadcastForUser(broadcastId);
  if (!auth.ok) return auth.response;
  const { broadcast, service } = auth;

  const setup = await checkBroadcastSetup(service, broadcast);
  if ("problem" in setup) {
    return NextResponse.json({ problem: setup.problem, eligible: 0, total: 0, skippedByReason: {} });
  }

  const audience = await buildAudience(service, broadcast, setup.channel, setup.settings);
  return NextResponse.json({
    problem: null,
    channel: { id: setup.channel.id, platform: setup.channel.platform },
    kind: audience.kind,
    total: audience.total,
    eligible: audience.eligible.length,
    skipped: audience.skipped.length,
    skippedByReason: audience.skippedByReason,
    confirmThreshold: setup.settings.confirmThreshold,
    quietHours: setup.settings.quietHours,
    sample: audience.eligible.slice(0, 10).map((e) => e.name ?? "—"),
  });
}
