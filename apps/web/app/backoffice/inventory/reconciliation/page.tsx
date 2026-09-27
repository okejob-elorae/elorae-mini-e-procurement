import { isJubelioStockPushEnabled, prisma } from "@elorae/db";
import { ReconciliationListClient } from "./ReconciliationListClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const initialPushEnabled = await isJubelioStockPushEnabled(prisma);
  return <ReconciliationListClient initialPushEnabled={initialPushEnabled} />;
}
