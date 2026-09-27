import { isJubelioStockPushEnabled, prisma } from "@elorae/db";
import { ReconciliationRunDetailClient } from "./ReconciliationRunDetailClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const initialPushEnabled = await isJubelioStockPushEnabled(prisma);
  return <ReconciliationRunDetailClient runId={runId} initialPushEnabled={initialPushEnabled} />;
}
