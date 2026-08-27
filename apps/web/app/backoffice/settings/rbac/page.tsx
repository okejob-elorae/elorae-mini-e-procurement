import { redirect } from "next/navigation";

export default function LegacyRbacRedirectPage() {
  redirect("/backoffice/profile-accounts?tab=roles");
}
