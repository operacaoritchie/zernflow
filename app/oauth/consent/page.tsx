import { ConsentView } from "./consent-view";

export const dynamic = "force-dynamic";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id } = await searchParams;
  return <ConsentView authorizationId={authorization_id ?? null} />;
}
