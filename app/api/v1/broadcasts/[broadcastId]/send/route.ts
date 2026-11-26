import { NextRequest, NextResponse } from "next/server";
import { BroadcastLaunchError, launchBroadcast, checkBroadcastSetup, buildAudience } from "@/lib/broadcasts";
import { loadBroadcastForUser } from "@/lib/broadcast-api";
import type { Json } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/broadcasts/:broadcastId/send
 * Body: { confirmCount?: number, scheduleAt?: ISO string }
 *
 * Sends now (or schedules) to the recipients the send policy allows. Above
 * the workspace's confirmation threshold, confirmCount must equal the number
 * of eligible recipients (typed by the user after seeing the preview).
 * Owner/admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const auth = await loadBroadcastForUser(broadcastId, { requireSender: true });
  if (!auth.ok) return auth.response;
  const { broadcast, service } = auth;

  if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
    return NextResponse.json({ error: "already_started", status: broadcast.status }, { status: 409 });
  }

  let body: { confirmCount?: number | null; scheduleAt?: string | null } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const confirmCount = typeof body.confirmCount === "number" ? body.confirmCount : null;

  // Schedule: validate now (setup + confirmation), launch later from the cron.
  if (body.scheduleAt) {
    const when = new Date(body.scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    }
    const setup = await checkBroadcastSetup(service, broadcast);
    if ("problem" in setup) return NextResponse.json({ error: setup.problem }, { status: 400 });
    const audience = await buildAudience(service, broadcast, setup.channel, setup.settings);
    if (audience.eligible.length === 0) {
      return NextResponse.json({ error: "no_eligible", skippedByReason: audience.skippedByReason }, { status: 400 });
    }
    if (audience.eligible.length > setup.settings.confirmThreshold && confirmCount !== audience.eligible.length) {
      return NextResponse.json(
        { error: "confirmation_required", eligible: audience.eligible.length },
        { status: 400 }
      );
    }
    const { error } = await service
      .from("broadcasts")
      .update({ status: "scheduled", scheduled_for: when.toISOString() })
      .eq("id", broadcast.id)
      .in("status", ["draft", "scheduled"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "scheduled", scheduledFor: when.toISOString(), eligible: audience.eligible.length });
  }

  try {
    const result = await launchBroadcast(service, broadcast, { confirmCount });
    return NextResponse.json({
      broadcastId,
      status: "sending",
      totalRecipients: result.eligible,
      skipped: result.skipped,
      startsAt: result.startsAt,
    });
  } catch (err) {
    if (err instanceof BroadcastLaunchError) {
      const status = err.code === "already_started" ? 409 : 400;
      return NextResponse.json({ error: err.code, ...(err.extra as Record<string, Json>) }, { status });
    }
    console.error(`Broadcast ${broadcastId} launch failed:`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "launch_failed" }, { status: 500 });
  }
}
