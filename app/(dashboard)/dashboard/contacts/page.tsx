import { getWorkspace } from "@/lib/workspace";
import { ContactsView } from "./contacts-view";

const PAGE_SIZE = 20;

/** Characters that would break a PostgREST `or=(...)` filter. */
function cleanSearch(raw: string | undefined): string {
  return (raw ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 100);
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; tag?: string }>;
}) {
  const params = await searchParams;
  const { workspace, role, supabase } = await getWorkspace();

  const search = cleanSearch(params.q);
  const tagId = params.tag && /^[0-9a-f-]{36}$/i.test(params.tag) ? params.tag : null;
  const requestedPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const buildQuery = (page: number) => {
    const from = (page - 1) * PAGE_SIZE;
    let query = supabase
      .from("contacts")
      .select(
        tagId
          ? "*, contact_tags(tag_id, tags(*)), tag_filter:contact_tags!inner(tag_id)"
          : "*, contact_tags(tag_id, tags(*))",
        { count: "exact" }
      )
      .eq("workspace_id", workspace.id)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (tagId) query = query.eq("tag_filter.tag_id", tagId);
    if (search) query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
    return query;
  };

  const [contactsRes, tagsRes, totalRes] = await Promise.all([
    buildQuery(requestedPage),
    supabase.from("tags").select("*").eq("workspace_id", workspace.id).order("name"),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
  ]);

  let res = contactsRes;
  let page = requestedPage;
  const filteredCount = res.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  // A page past the end (e.g. after filtering) falls back to the last one.
  if (page > lastPage) {
    page = lastPage;
    res = await buildQuery(page);
  }

  return (
    <ContactsView
      contacts={(res.data ?? []) as unknown as Parameters<typeof ContactsView>[0]["contacts"]}
      tags={tagsRes.data ?? []}
      workspaceId={workspace.id}
      canExport={role === "owner" || role === "admin"}
      page={page}
      pageSize={PAGE_SIZE}
      filteredCount={filteredCount}
      totalCount={totalRes.count ?? 0}
      initialSearch={search}
      selectedTagId={tagId}
    />
  );
}
