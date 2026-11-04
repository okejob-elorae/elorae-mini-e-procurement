import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { notaUntukKembali } from "@/lib/spg/retur-pembeli";
import { KembaliClient } from "./KembaliClient";

export const dynamic = "force-dynamic";

/** Pembeli mengembalikan barang dari satu nota SPG. Hanya nota SPG itu sendiri, di tokonya. */
export default async function SpgKembaliPage({ params }: { params: Promise<{ saleId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) redirect("/pwa");
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) redirect("/pwa");

  const { saleId } = await params;
  const nota = await notaUntukKembali(saleId, session.user.id, storeId);
  if (!nota) notFound();

  return <KembaliClient nota={nota} storeId={storeId} />;
}
