import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TampilanClient } from "./TampilanClient";

export const dynamic = "force-dynamic";

export default async function PwaTampilan() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return <TampilanClient />;
}
