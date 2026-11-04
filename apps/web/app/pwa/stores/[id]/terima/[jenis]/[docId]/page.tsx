import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { jumlahSpgToko, keadaanKiriman, muatKiriman } from "@/lib/spg/kiriman";
import { getActiveVisit } from "@/lib/stores/queries";
import {
  FormTerimaPemegang,
  TolakTerimaPemegang,
  type AlasanTolakHalaman,
  type JenisTerimaPemegang,
} from "./FormTerimaPemegang";

export const dynamic = "force-dynamic";

const JENIS: readonly JenisTerimaPemegang[] = ["KONSI_TRANSFER", "PUTUS_DELIVERY"];

/**
 * Formulir salesman pemegang menerima satu kiriman gudang di toko yang SPG-nya sudah berhenti
 * (P45/P45a). Halaman membaca dokumennya lewat `muatKiriman` dan MENOLAK dengan penjelasan —
 * urutannya sama dengan penulisnya (`terimaKirimanPemegang`): bukan pemegang, belum check-in di
 * toko ini, toko masih punya SPG, lalu keadaan dokumennya. Penulisnya tetap penjaga terakhir.
 * SPG dikembalikan ke layar Terima kirimannya sendiri.
 */
export default async function TerimaKirimanPemegangPage({
  params,
}: {
  params: Promise<{ id: string; jenis: string; docId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa/spg/terima");

  const { id, jenis, docId } = await params;
  const sumber = (JENIS as readonly string[]).includes(jenis) ? (jenis as JenisTerimaPemegang) : null;
  if (!sumber) notFound();

  const store = await prisma.store.findUnique({ where: { id }, select: { id: true, salesmanId: true } });
  if (!store) notFound();

  const tolak = (alasan: AlasanTolakHalaman) => <TolakTerimaPemegang storeId={store.id} alasan={alasan} />;
  if (store.salesmanId !== session.user.id) return tolak("BUKAN_PEMEGANG");

  const [aktif, spg, sudah, keadaan, kiriman] = await Promise.all([
    getActiveVisit(session.user.id),
    jumlahSpgToko(prisma, store.id),
    prisma.storeReceipt.findFirst({ where: { storeId: store.id, sourceType: sumber, sourceId: docId }, select: { id: true } }),
    keadaanKiriman(prisma, store.id, sumber, docId),
    muatKiriman(prisma, store.id, sumber, docId),
  ]);
  if (!aktif || aktif.storeId !== store.id) return tolak("TANPA_KUNJUNGAN");
  if (spg > 0) return tolak("TOKO_PUNYA_SPG");
  if (sudah) return tolak("SUDAH_DITERIMA");
  if (keadaan === "DIBATALKAN") return tolak("KIRIMAN_DIBATALKAN");
  if (!kiriman || kiriman.lines.length === 0) return tolak("KIRIMAN_TIDAK_DITEMUKAN");
  if (keadaan === "BELUM_BERANGKAT" || !kiriman.diserahkan) return tolak("BELUM_DISERAHKAN");

  return (
    <FormTerimaPemegang
      storeId={store.id}
      kiriman={{
        sourceType: sumber,
        sourceId: kiriman.sourceId,
        docNo: kiriman.docNo,
        tanggalLabel: formatDisplayDate(kiriman.tanggal),
        pesananNo: kiriman.pesananNo ?? null,
        lines: kiriman.lines.map((l) => ({ lineId: l.lineId, productName: l.productName, variantSku: l.variantSku, qty: l.qty })),
      }}
    />
  );
}
