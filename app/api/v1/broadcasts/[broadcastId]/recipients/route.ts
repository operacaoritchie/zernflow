import { NextRequest, NextResponse } from "next/server";
import { loadBroadcastForUser } from "@/lib/broadcast-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/broadcasts/:broadcastId/recipients?status=&page=
 * Recipients with their status and reason, plus the latest counters.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const auth = await loadBroadcastForUser(broadcastId);
  if (!auth.ok) return auth.response;
  const { service, broadcast } = auth;

  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const size = 50;

  let query = service
    .from("broadcast_recipients")
    .select("id, status, skip_reason, error_message, sent_at, delivered_at, read_at, phone, contacts(display_name)", {
      count: "exact",
    })
    .eq("broadcast_id", broadcastId)
    .order("status", { ascending: true })
    .range((page - 1) * size, page * size - 1);
  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: fresh } = await service.from("broadcasts").select("*").eq("id", broadcast.id).single();

  return NextResponse.json({
    broadcast: fresh ?? broadcast,
    total: count ?? 0,
    page,
    pageSize: size,
    recipients: (data ?? []).map((r) => ({
      id: r.id,
      name: (r.contacts as { display_name: string | null } | null)?.display_name ?? null,
      status: r.status,
      reason: r.skip_reason,
      error: r.error_message,
      sentAt: r.sent_at,
      deliveredAt: r.delivered_at,
      readAt: r.read_at,
    })),
  });
}
