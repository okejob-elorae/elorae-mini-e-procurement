import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVanStock, listVanLoads } from "@/lib/canvassing/queries";
import { VanDetailClient } from "./VanDetailClient";

export const dynamic = "force-dynamic";

const LOAD_HISTORY_LIMIT = 20;

export default async function CanvasserVanPage({ params }: { params: Promise<{ canvasserId: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.CANVASSING_MANAGE)) redirect("/backoffice");

  const { canvasserId } = await params;

  const canvasser = await prisma.user.findUnique({
    where: { id: canvasserId },
    select: { id: true, name: true, email: true },
  });
  if (!canvasser) notFound();

  const [vanStock, loads, items] = await Promise.all([
    getVanStock(canvasserId),
    listVanLoads(canvasserId, LOAD_HISTORY_LIMIT),
    prisma.item.findMany({
      where: { isActive: true, type: "FINISHED_GOOD" },
      select: { id: true, sku: true, nameId: true, variants: true },
      orderBy: { nameId: "asc" },
    }),
  ]);

  return (
    <VanDetailClient
      canvasserId={canvasser.id}
      canvasserName={canvasser.name ?? canvasser.email}
      vanStock={vanStock}
      loads={loads}
      itemOptions={items.map((i) => ({
        id: i.id,
        sku: i.sku,
        nameId: i.nameId,
        variants: i.variants,
      }))}
    />
  );
}
