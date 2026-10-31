import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { formatDisplayDateTime } from "@/lib/date-only";
import { pesananSayaById, salinanDariDetail } from "@/lib/field-sales/pwa-queries";
import { alamatUbahPesanan } from "@/lib/field-sales/ganti-pesanan";
import { kirimanPesananSaya } from "@/lib/field-sales/delivery/bukti-terima-queries";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { DetailPesananClient } from "./DetailPesananClient";

export const dynamic = "force-dynamic";

export default async function DetailPesananSayaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const { id } = await params;
  // Disaring ke pemiliknya di kueri: pesanan orang lain sama dengan tidak ada.
  const d = await pesananSayaById(id, session.user.id);
  if (!d) notFound();
  // Bukti terima per pengiriman (hanya PUTUS yang punya pengiriman).
  const kiriman = d.orderType === "PUTUS" ? await kirimanPesananSaya(d.id, session.user.id) : [];
  // Salinan WA untuk toko — tidak untuk pesanan yang ditolak/dibatalkan (null).
  const salinanWa = await salinanDariDetail(d, session.user.id);
  const menunggu = d.status === "PENDING_APPROVAL";
  // Hasil hitung SPG di toko per kiriman — potong saja, tanpa rupiah (juga untuk KONSI).
  const terimaToko = (sourceType: "PUTUS_DELIVERY" | "KONSI_ORDER", sourceId: string) => {
    const r = d.penerimaanToko.find((x) => x.sourceType === sourceType && x.sourceId === sourceId);
    return r
      ? { dikirim: r.dikirim, diterima: r.diterima, kurang: r.kurang, rusak: r.rusak, dihitung: formatDisplayDateTime(r.diterimaPada) }
      : null;
  };

  /*
   * Semua tanggal diformat DI SERVER — format tanggal di klien bisa berbeda
   * antara Node dan Safari, dan React menganggapnya hydration error. Tanggal
   * mentah tidak dikirim ke klien sama sekali — kecuali batas awal isian jam
   * bukti terima (ISO), yang hanya dipakai sebagai batas `min`, tidak ditampilkan.
   */
  return (
    <DetailPesananClient
      pesanan={{
        id: d.id,
        orderNo: d.orderNo,
        storeId: d.storeId,
        storeName: d.storeName,
        orderType: d.orderType,
        status: d.status,
        keadaan: d.keadaan,
        dibuat: formatDisplayDateTime(d.createdAt),
        note: d.note,
        rejectReason: d.rejectReason,
        closeReason: d.closeReason,
        subtotal: d.subtotal,
        potonganBaris: d.potonganBaris,
        orderDiscountAmount: d.orderDiscountAmount,
        appliedOrderPromoName: d.appliedOrderPromoName,
        total: d.total,
        jumlahPcs: d.jumlahPcs,
        kreditDitahan: d.kreditDitahan,
        remoteChannel: d.remoteChannel,
        kreditCatatan: d.kreditCatatan,
        baris: d.baris,
        linimasa: d.linimasa.map((l) => ({ ...l, waktu: formatDisplayDateTime(l.waktu) })),
        dibatalkan: d.dibatalkan,
        menggantikan: d.menggantikan,
        digantiDengan: d.digantiDengan,
      }}
      // Pesanan yang masih menunggu boleh diubah/dibatalkan pemiliknya (kueri sudah menyaring ke pemilik).
      alamatUbah={menunggu ? alamatUbahPesanan(d.storeId, d.id) : null}
      bisaBatal={menunggu}
      salinanWa={salinanWa ? { tautan: salinanWa.tautan, adaNomor: salinanWa.adaNomor } : null}
      kiriman={kiriman.map((k) => ({
        id: k.id,
        docNo: k.docNo,
        dikirim: formatDisplayDateTime(k.deliveredAt),
        pcs: k.pcs,
        batasAwalIso: k.batasAwal.toISOString(),
        keadaan: k.keadaan,
        receivedByName: k.receivedByName,
        diterima: k.receivedAt ? formatDisplayDateTime(k.receivedAt) : null,
        podPhotoUrl: k.podPhotoUrl,
        terimaToko: terimaToko("PUTUS_DELIVERY", k.id),
      }))}
      terimaTokoKonsi={d.orderType === "KONSI" ? terimaToko("KONSI_ORDER", d.id) : null}
    />
  );
}
