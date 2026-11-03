import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBelumDitagih } from "@/lib/vendor-billing/belum-ditagih-queries";
import { daftarPermintaanInvoice } from "@/lib/vendor-billing/permintaan-invoice-queries";
import { daftarTidakPerluInvoice } from "@/lib/vendor-billing/tidak-perlu-invoice-queries";
import { BelumDitagihClient } from "./BelumDitagihClient";
import { PermintaanInvoiceClient } from "./PermintaanInvoiceClient";
import { TidakPerluClient } from "./TidakPerluClient";
import { TabBelumDitagih } from "./TabBelumDitagih";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Tagihan pemasok → Invoice belum ditagih (Q18; 2026-10-29 "belum ditagih"; P19; P52): setiap penerimaan
 * yang belum disebut invoice mana pun, permintaan invoice ke pemasok, dan "tidak perlu invoice". Tanpa
 * saringan tanggal. Dibuka `vendor_bills:view`; meminta, meminta ulang, membatalkan, "tidak perlu
 * invoice", dan mencatat invoice butuh `vendor_bills:manage` (izin aksinya).
 */
export default async function BelumDitagihPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Param; pemasok?: Param; jenis?: Param; status?: Param }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.VENDOR_BILLS_VIEW)) redirect("/backoffice");
  const canManage = hasPermission(perms, PERMISSIONS.VENDOR_BILLS_MANAGE);
  const sp = await searchParams;
  const tab = satu(sp.tab) === "permintaan" ? "permintaan" : satu(sp.tab) === "tidak-perlu" ? "tidak-perlu" : "belum";
  const pemasok = satu(sp.pemasok).slice(0, 64) || undefined;
  const jenisMentah = satu(sp.jenis);
  const jenis = jenisMentah === "GRN" || jenisMentah === "WO_STEP" ? jenisMentah : undefined;
  const statusMentah = satu(sp.status);
  const pemasokList = await prisma.supplier.findMany({ select: { id: true, name: true, code: true, phone: true }, orderBy: { name: "asc" } });

  let isi: ReactNode;
  if (tab === "permintaan") {
    const status = statusMentah === "terbuka" || statusMentah === "terlambat" || statusMentah === "selesai" ? statusMentah : undefined;
    const baris = await daftarPermintaanInvoice({ supplierId: pemasok, status });
    isi = <PermintaanInvoiceClient baris={baris} canManage={canManage} status={status ?? null} />;
  } else if (tab === "tidak-perlu") {
    isi = <TidakPerluClient baris={await daftarTidakPerluInvoice({ supplierId: pemasok })} canManage={canManage} />;
  } else {
    const status = statusMentah === "belum" || statusMentah === "diminta" || statusMentah === "terlambat" ? statusMentah : undefined;
    const hasil = await daftarBelumDitagih({ supplierId: pemasok, jenis, status });
    isi = (
      <BelumDitagihClient
        hasil={hasil}
        canManage={canManage}
        telepon={Object.fromEntries(pemasokList.map((p) => [p.id, p.phone]))}
        saring={{ jenis: jenis ?? null, status: status ?? null, pemasok: pemasok ?? null }}
      />
    );
  }

  return (
    <TabBelumDitagih tab={tab} pemasok={pemasok ?? null} pemasokList={pemasokList.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }))}>
      {isi}
    </TabBelumDitagih>
  );
}
