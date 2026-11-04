import { prisma } from "@elorae/db";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import { bebanTokoDiNota } from "./return-writer";

/**
 * Kabar ke salesman pemegang toko bahwa selisih retur ditanggung TOKO (P84, keputusan 1
 * 2026-10-29: "sales dikabari untuk menagih kekurangannya"), berubah karena barang susulan, atau
 * dialihkan dari toko. Yang masih harus ditagih dibaca dari BKM yang memotong nota itu
 * (`bebanTokoDiNota`). Saat diputuskan, toko yang BELUM memotong nota returnya tetap dikabarkan —
 * tanpa angka tagihan, karena belum ada yang tertahan: bagian selisihnya baru tidak dikreditkan
 * begitu nota itu dipotong di BKM, dan saat itulah sales menagihnya (`kabarBebanTokoDariKlaim`).
 *
 * Dipanggil SESUDAH transaksinya selesai dan tidak pernah melempar. Dilewati bila toko tanpa
 * pemegang atau pemegangnya sendiri yang bertindak.
 */
export async function kabarBebanTokoRetur(
  storeReturnId: string,
  pelakuId: string,
  jenis: "DITANGGUNG" | "BERUBAH" | "DILEPAS",
  tertahanSebelum = 0,
): Promise<void> {
  try {
    const nota = await prisma.storeReturn.findUnique({
      where: { id: storeReturnId },
      select: {
        noNrt: true,
        storeId: true,
        store: { select: { name: true, salesmanId: true } },
        charges: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, amount: true } },
      },
    });
    const pemegang = nota?.store.salesmanId ?? null;
    if (!nota || !pemegang || pemegang === pelakuId) return;
    const data = { chargeId: nota.charges[0]?.id ?? "", returnId: storeReturnId, storeId: nota.storeId };
    if (jenis === "DILEPAS") {
      if (!(tertahanSebelum > 0)) return;
      await kabariPengguna(pemegang, {
        jenis: JENIS_KABAR.RETUR_DITANGGUNG_TOKO,
        judul: `Selisih retur ${nota.noNrt} tidak lagi ditanggung ${nota.store.name}`,
        isi: "Tidak perlu ditagih lagi ke toko.",
        data,
      });
      return;
    }
    const beban = await bebanTokoDiNota(prisma, storeReturnId);
    if (!(beban.tertahan > 0)) {
      // Toko belum mengambil potongan selisih ini: tidak ada angka untuk ditagih sekarang.
      if (jenis !== "DITANGGUNG") return;
      const selisih = Number(nota.charges[0]?.amount ?? 0);
      if (!(selisih > 0)) return;
      await kabariPengguna(pemegang, {
        jenis: JENIS_KABAR.RETUR_DITANGGUNG_TOKO,
        judul: `Selisih retur ${nota.noNrt} ditanggung ${nota.store.name}`,
        isi:
          `Selisih ${formatIDR(selisih)}. Toko belum memotong nota retur ini di pembayarannya; kalau nanti ` +
          "dipotong, bagian selisihnya tidak dikurangkan dari tagihannya — tagih saat itu.",
        data,
      });
      return;
    }
    if (jenis === "DITANGGUNG" && !(beban.tampil > 0)) return;
    await kabariPengguna(pemegang, {
      jenis: JENIS_KABAR.RETUR_DITANGGUNG_TOKO,
      judul: `Selisih retur ${nota.noNrt} ditanggung ${nota.store.name}`,
      isi:
        beban.tampil > 0
          ? `${formatIDR(beban.tampil)} tidak dikurangkan dari tagihannya; tagih saat berkunjung.`
          : "Barang susulannya sudah dihitung — tidak ada lagi yang perlu ditagih ke toko.",
      data,
    });
  } catch (err) {
    console.error("[kabar] beban toko retur gagal", storeReturnId, err);
  }
}

/**
 * "Kalau nanti dipotong … tagih saat itu" (kabar saat diputuskan, di atas): BKM yang memotong nota
 * retur yang selisihnya sudah DITETAPKAN ditanggung TOKO — dicatat atau diverifikasi — mengabari
 * pemegang tokonya, satu kabar per nota retur. Tidak pernah melempar.
 */
export async function kabarBebanTokoDariKlaim(paymentClaimId: string, pelakuId: string): Promise<void> {
  try {
    const potongan = await prisma.paymentClaimDeduction.findMany({
      where: {
        paymentClaimId,
        storeReturnId: { not: null },
        storeReturn: { charges: { some: { status: "DITETAPKAN", bearer: "TOKO" } } },
      },
      select: { storeReturnId: true },
    });
    const nota = [...new Set(potongan.flatMap((p) => (p.storeReturnId ? [p.storeReturnId] : [])))];
    for (const id of nota) await kabarBebanTokoRetur(id, pelakuId, "DITANGGUNG");
  } catch (err) {
    console.error("[kabar] beban toko dari BKM gagal", paymentClaimId, err);
  }
}
