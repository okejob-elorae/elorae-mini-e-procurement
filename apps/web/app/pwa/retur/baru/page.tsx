import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { tokoUntukRetur } from "@/lib/receivables/return-queries";
import { ReturBaruClient } from "./ReturBaruClient";

export const dynamic = "force-dynamic";

export default async function ReturBaruPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <ReturBaruClient toko={await tokoUntukRetur()} />;
}
