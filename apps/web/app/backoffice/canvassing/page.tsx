import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listCanvassers } from "@/lib/canvassing/queries";
import { CanvassingListClient } from "./CanvassingListClient";

export const dynamic = "force-dynamic";

export default async function CanvassingPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.CANVASSING_MANAGE)) redirect("/backoffice");

  const canvassers = await listCanvassers();

  return <CanvassingListClient canvassers={canvassers} />;
}
