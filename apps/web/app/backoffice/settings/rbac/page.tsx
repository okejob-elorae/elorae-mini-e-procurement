import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function LegacyRbacRedirectPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Profile Accounts is legacy-ADMIN only; non-admins must not bounce through
  // this redirect into a /backoffice ↔ profile-accounts loop.
  if (session.user.role !== "ADMIN") redirect("/backoffice");
  redirect("/backoffice/profile-accounts?tab=roles");
}
