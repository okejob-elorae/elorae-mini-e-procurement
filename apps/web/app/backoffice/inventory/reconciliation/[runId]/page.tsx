import { ReconciliationRunDetailClient } from "./ReconciliationRunDetailClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <ReconciliationRunDetailClient runId={runId} />;
}
