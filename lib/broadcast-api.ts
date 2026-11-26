/**
 * Shared auth for the broadcast API routes: signed-in member of the current
 * workspace (cookie-selected, like the dashboard), owner or admin to send.
 */

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import type { Database } from "@/lib/types/database";

type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

export async function loadBroadcastForUser(
  broadcastId: string,
  opts: { requireSender?: boolean } = {}
): Promise<
  | { ok: true; broadcast: BroadcastRow; userId: string; role: string; service: Awaited<ReturnType<typeof createServiceClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  // RLS limits this to workspaces the user belongs to.
  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", broadcastId)
    .single();
  if (!broadcast) {
    return { ok: false, response: NextResponse.json({ error: "Broadcast not found" }, { status: 404 }) };
  }

  const cookieStore = await cookies();
  const selected = cookieStore.get(WORKSPACE_COOKIE)?.value;
  if (selected && selected !== broadcast.workspace_id) {
    return { ok: false, response: NextResponse.json({ error: "Broadcast not found" }, { status: 404 }) };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("workspace_id", broadcast.workspace_id)
    .single();
  if (!membership) {
    return { ok: false, response: NextResponse.json({ error: "Broadcast not found" }, { status: 404 }) };
  }
  if (opts.requireSender && membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, broadcast, userId: user.id, role: membership.role, service: await createServiceClient() };
}
