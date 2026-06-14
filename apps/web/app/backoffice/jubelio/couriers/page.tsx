import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listJubelioCouriers } from "@/app/actions/jubelio-couriers";
import { CouriersPageClient } from "./CouriersPageClient";

export const dynamic = "force-dynamic";

export default async function JubelioCouriersPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const couriers = await listJubelioCouriers();
  return <CouriersPageClient initialCouriers={couriers} />;
}
