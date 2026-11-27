import { NextResponse } from "next/server";
import { loadBroadcastForUser } from "@/lib/broadcast-api";

export const dynamic = "force-dynamic";

/** Statuses a broadcast can be deleted from. Sending/paused must be cancelled first. */
const DELETABLE_BROADCAST_STATUSES = ["draft", "scheduled", "completed", "cancelled"] as const;

/**
 * DELETE /api/v1/broadcasts/:broadcastId
 *
 * Permanently deletes a broadcast and its recipient rows (cascade). Owner/admin
 * only. A broadcast that is sending or paused returns 409 `cancel_first`.
 * Pending delivery jobs of a scheduled broadcast are removed too (they would
 * no-op anyway once the recipients are gone).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const auth = await loadBroadcastForUser(broadcastId, { requireSender: true });
  if (!auth.ok) return auth.response;
  const { broadcast, service } = auth;

  if (!(DELETABLE_BROADCAST_STATUSES as readonly string[]).includes(broadcast.status)) {
    return NextResponse.json({ error: "cancel_first", status: broadcast.status }, { status: 409 });
  }

  await service
    .from("scheduled_jobs")
    .delete()
    .eq("type", "send_broadcast")
    .eq("status", "pending")
    .eq("payload->>broadcastId", broadcast.id);

  const { error } = await service
    .from("broadcasts")
    .delete()
    .eq("id", broadcast.id)
    .eq("workspace_id", broadcast.workspace_id)
    .in("status", [...DELETABLE_BROADCAST_STATUSES]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
