import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { BroadcastLaunchError, launchBroadcast } from "@/lib/broadcasts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Cron job: launches scheduled broadcasts that are due (status 'scheduled',
 * scheduled_for <= now). Same launch as "send now": recipients are checked by
 * the send policy and one delivery job per eligible recipient is queued.
 *
 * Auth: CRON_SECRET via query param or Authorization header.
 * GET /api/cron/broadcasts?key=CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret =
    request.nextUrl.searchParams.get("key") ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const { data: broadcasts, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(5);

  if (error) {
    console.error("Failed to fetch scheduled broadcasts:", error);
    return NextResponse.json({ error: "Failed to fetch broadcasts" }, { status: 500 });
  }
  if (!broadcasts || broadcasts.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let failed = 0;
  for (const broadcast of broadcasts) {
    try {
      // Confirmation was given when it was scheduled; no confirmCount here.
      await launchBroadcast(supabase, broadcast, { fromStatuses: ["scheduled"] });
      processed++;
    } catch (err) {
      failed++;
      const code = err instanceof BroadcastLaunchError ? err.code : "error";
      if (code === "already_started") continue;
      console.error(`Scheduled broadcast ${broadcast.id} could not launch (${code}):`, err);
      // Nothing to send (or misconfigured): close it instead of retrying every minute.
      await supabase
        .from("broadcasts")
        .update({ status: "cancelled" })
        .eq("id", broadcast.id)
        .eq("status", "scheduled");
    }
  }

  return NextResponse.json({ processed, failed });
}
