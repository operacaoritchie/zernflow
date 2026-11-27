import { getWorkspace } from "@/lib/workspace";
import { notFound } from "next/navigation";
import { SequenceEditor } from "@/components/sequences/sequence-editor";
import { EnrollmentList } from "@/components/sequences/enrollment-list";
import type { SequenceStep } from "@/lib/types/database";
import { getT } from "@/lib/i18n/server";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ sequenceId: string }>;
}) {
  const { sequenceId } = await params;
  const tc = await getT("common");
  const { workspace, supabase } = await getWorkspace();

  const { data: sequence } = await supabase
    .from("sequences")
    .select("*")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!sequence) {
    notFound();
  }

  const { data: enrollments } = await supabase
    .from("sequence_enrollments")
    .select("*, contacts(display_name, email)")
    .eq("sequence_id", sequenceId)
    .order("enrolled_at", { ascending: false });

  return (
    <div className="flex h-full flex-col">
      <SequenceEditor
        sequence={{
          id: sequence.id,
          name: sequence.name,
          description: sequence.description,
          status: sequence.status as "draft" | "active" | "paused",
          steps: (sequence.steps as unknown as SequenceStep[]) || [],
          exitOnReply: sequence.exit_on_reply,
        }}
      />
      <div className="border-t border-border">
        <EnrollmentList
          sequenceId={sequence.id}
          sequenceActive={sequence.status === "active"}
          enrollments={
            (enrollments ?? []).map((e) => ({
              id: e.id,
              contactName:
                (e.contacts as { display_name: string | null; email: string | null } | null)
                  ?.display_name ||
                (e.contacts as { display_name: string | null; email: string | null } | null)
                  ?.email ||
                tc("unknown"),
              currentStepIndex: e.current_step_index,
              status: e.status,
              enrolledAt: e.enrolled_at,
              reason: e.exit_reason ?? e.last_error ?? null,
              nextStepAt: e.next_step_at,
            }))
          }
        />
      </div>
    </div>
  );
}
