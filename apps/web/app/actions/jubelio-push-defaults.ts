"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";

export type JubelioPushDefaultsState = {
  id: string;
  sellTaxId: number;
  buyTaxId: number;
  salesAcctId: number;
  cogsAcctId: number;
  invtAcctId: number;
  purchAcctId: number | null;
  uomId: number;
  brandId: string | null;
  brandName: string | null;
  sellThis: boolean;
  buyThis: boolean;
  stockThis: boolean;
  dropshipThis: boolean;
  isActive: boolean;
  sellUnit: string;
  buyUnit: string;
  packageWeight: number;
  storePriorityQtyTreshold: number;
  rop: number;
  useSingleImageSet: boolean;
  useSerialNumber: boolean;
  buyPrice: number;
  updatedAt: string;
  updatedById: string | null;
};

export type JubelioPushDefaultsInput = Omit<
  JubelioPushDefaultsState,
  "id" | "updatedAt" | "updatedById"
>;

function serialize(row: Awaited<ReturnType<typeof prisma.jubelioPushDefaults.findFirst>>): JubelioPushDefaultsState {
  if (!row) throw new Error("JubelioPushDefaults singleton row missing — re-run migrations");
  return {
    ...row,
    buyPrice: Number(row.buyPrice),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getJubelioPushDefaults(): Promise<JubelioPushDefaultsState> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const row = await prisma.jubelioPushDefaults.findFirst();
  return serialize(row);
}

export async function saveJubelioPushDefaults(
  input: JubelioPushDefaultsInput,
): Promise<JubelioPushDefaultsState> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const row = await prisma.jubelioPushDefaults.update({
    where: { id: "singleton" },
    data: {
      ...input,
      updatedById: session.user.id,
    },
  });
  revalidatePath("/backoffice/jubelio/settings");
  return serialize(row);
}
