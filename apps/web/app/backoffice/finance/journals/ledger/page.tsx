import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { AccountType } from "@/lib/constants/enums";
import { BukuBesarIndeksClient } from "./BukuBesarIndeksClient";

export const dynamic = "force-dynamic";

/**
 * Pintu buku besar: pilih akun, lalu buka buku besarnya. Hanya akun yang bisa
 * diposting (daun bagan akun) — akun induk tidak punya baris jurnal sendiri.
 */
export default async function BukuBesarIndeksPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const akun = await prisma.chartAccount.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true, isActive: true, parentId: true },
  });
  const induk = new Set(akun.map((a) => a.parentId).filter((x): x is string => x !== null));

  return (
    <BukuBesarIndeksClient
      akun={akun
        .filter((a) => !induk.has(a.id))
        .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type as AccountType, aktif: a.isActive }))}
    />
  );
}
