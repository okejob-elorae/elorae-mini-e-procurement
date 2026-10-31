import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import {
  getNotaTokoArchive,
  getReturPemasokArchive,
  getWorkOrderArchive,
} from "@/lib/archive/queries";
import { ArchiveTabs } from "./ArchiveTabs";

export const dynamic = "force-dynamic";

/*
 * Copy lives in the client component, not here: this app translates through a
 * client LocaleProvider and has no next-intl server config, so getTranslations
 * throws at render. The server half stays purely about data.
 */
export default async function ArchivePage() {
  const session = await auth();
  if (!session) redirect("/login");

  /*
   * Rute ini tidak dipetakan di ROUTE_PERMISSIONS, jadi halamannya memagari
   * dirinya sendiri. Sebelumnya cukup sudah masuk: salesman dan SPG membuka
   * nota tagihan setiap toko lewat alamat yang diketik.
   *
   * - Pembelian (`purchase_orders:view`, izin menu sampingnya): ketiga arsip,
   *   seperti sebelumnya.
   * - Pembaca piutang: hanya "Nota toko" — itu bagian piutangnya. Retur pemasok
   *   dan SPK bukan urusannya, dan tidak dibaca sama sekali.
   */
  const izin = session.user.permissions ?? [];
  const pembelian = hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW);
  if (!pembelian && !bolehMembacaPiutang(izin)) redirect("/backoffice");

  const [nota, retur, wo] = await Promise.all([
    getNotaTokoArchive(),
    pembelian ? getReturPemasokArchive() : Promise.resolve(null),
    pembelian ? getWorkOrderArchive() : Promise.resolve(null),
  ]);

  return <ArchiveTabs nota={nota} retur={retur} workOrder={wo} />;
}
