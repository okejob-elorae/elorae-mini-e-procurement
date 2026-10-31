import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { logout } from "../actions";
import { LainnyaClient } from "./LainnyaClient";

export const dynamic = "force-dynamic";

export default async function LainnyaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <LainnyaClient nama={session.user.name ?? session.user.email ?? ""} onLogout={logout} />;
}
