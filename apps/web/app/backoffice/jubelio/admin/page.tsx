import { isJubelioStockPushEnabled, prisma } from "@elorae/db";
import { JubelioAdminClient } from "./JubelioAdminClient";

export default async function JubelioAdminPage() {
  const initialPushEnabled = await isJubelioStockPushEnabled(prisma);
  return <JubelioAdminClient initialPushEnabled={initialPushEnabled} />;
}
