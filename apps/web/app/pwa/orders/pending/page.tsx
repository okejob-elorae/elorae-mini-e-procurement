import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PendingOrdersClient } from "./PendingOrdersClient";

export const dynamic = "force-dynamic";

export default async function PwaPendingOrders() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return <PendingOrdersClient />;
}
