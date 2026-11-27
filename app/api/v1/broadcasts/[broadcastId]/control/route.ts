import { NextRequest, NextResponse } from "next/server";
import { loadBroadcastForUser } from "@/lib/broadcast-api";
import { refreshBroadcastCounts, settleBroadcastIfDone } from "@/lib/broadcasts";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/broadcasts/:broadcastId/control
 * Body: { action: "pause" | "resume" | "cancel" }
 *
 * pause  — sending → paused (delivery jobs wait)
 * resume — paused → sending
 * cancel — scheduled/sending/paused → cancelled; pending recipients become
 *          skipped ("cancelled") as their jobs run. Owner/admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const auth = await loadBroadcastForUser(broadcastId, { requireSender: true });
  if (!auth.ok) return auth.response;
  const { broadcast, service } = auth;

  let action = "";
  try {
    action = String((await request.json()).action ?? "");
  } catch {
    action = "";
  }

  const transitions: Record<string, { from: string[]; to: "paused" | "sending" | "cancelled" }> = {
    pause: { from: ["sending"], to: "paused" },
    resume: { from: ["paused"], to: "sending" },
    cancel: { from: ["scheduled", "sending", "paused"], to: "cancelled" },
  };
  const t = transitions[action];
  if (!t) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  if (!t.from.includes(broadcast.status)) {
    return NextResponse.json({ error: "invalid_state", status: broadcast.status }, { status: 409 });
  }

  const { data, error } = await service
    .from("broadcasts")
    .update({
      status: t.to,
      paused_at: t.to === "paused" ? new Date().toISOString() : null,
    })
    .eq("id", broadcast.id)
    .in("status", t.from as Array<"scheduled" | "sending" | "paused">)
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "conflict" }, { status: 409 });

  if (t.to === "cancelled") {
    // Close the recipients that never went out right away.
    await service
      .from("broadcast_recipients")
      .update({ status: "skipped", skip_reason: "cancelled" })
      .eq("broadcast_id", broadcast.id)
      .eq("status", "pending");
    await refreshBroadcastCounts(service, broadcast.id);
  } else if (t.to === "sending") {
    await settleBroadcastIfDone(service, broadcast.id);
  }

  const { data: fresh } = await service.from("broadcasts").select("*").eq("id", broadcast.id).single();
  return NextResponse.json(fresh ?? data);
}
