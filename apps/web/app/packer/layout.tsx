import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { packerAccessGuard } from "@/lib/packer/guard";

export const metadata = {
  title: "Record Packer — Elorae",
};

export default async function PackerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/packer");
  const outcome = packerAccessGuard(session.user.permissions);
  if (outcome === "redirect-backoffice") redirect("/backoffice");
  return <>{children}</>;
}
