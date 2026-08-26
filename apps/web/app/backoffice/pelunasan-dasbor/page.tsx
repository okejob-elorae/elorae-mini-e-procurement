import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { muatDasbor } from "@/lib/receivables/dashboard-queries";
import { DasborClient } from "./DasborClient";

export const dynamic = "force-dynamic";

export default async function DasborPelunasanPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return <DasborClient data={await muatDasbor()} />;
}
