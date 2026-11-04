import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarSelisihHarga } from "@/lib/vendor-billing/koreksi-utang-queries";
import { konteksKoreksi, peranKoreksiBelumDipetakan } from "@/lib/vendor-billing/koreksi-utang-konteks";
import { SelisihHargaClient } from "./SelisihHargaClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Tagihan pemasok → Selisih harga invoice (keputusan pemilik 2026-11-02, P27, P49, P50, P53): invoice yang
 * harganya berbeda dari utang tercatat penerimaannya, menunggu keputusan atau sudah diputuskan. Dibuka
 * `vendor_bills:view`; memutuskan butuh `vendor_bills:decide_price` (izin aksinya).
 */
export default async function SelisihHargaPage({ searchParams }: { searchParams: Promise<{ status?: Param; pemasok?: Param }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.VENDOR_BILLS_VIEW)) redirect("/backoffice");
  const sp = await searchParams;
  const status = satu(sp.status) === "DIPUTUSKAN" ? "DIPUTUSKAN" : "MENUNGGU";
  const pemasok = satu(sp.pemasok).slice(0, 64) || undefined;
  const canDecide = hasPermission(perms, PERMISSIONS.VENDOR_BILLS_DECIDE_PRICE);
  const baris = await daftarSelisihHarga({ status, supplierId: pemasok });
  const [konteks, peranBelumDipetakan] = await Promise.all([
    konteksKoreksi(baris),
    canDecide && status === "MENUNGGU" && baris.length > 0 ? peranKoreksiBelumDipetakan() : Promise.resolve([] as string[]),
  ]);
  return <SelisihHargaClient status={status} baris={baris} konteks={Object.fromEntries(konteks)} canDecide={canDecide} peranBelumDipetakan={peranBelumDipetakan} />;
}
