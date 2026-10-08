// Pendaftaran sumber sapuan "dokumen tanpa jurnal" untuk penyusutan aset
// tetap (`DEPRECIATION`). Diimpor oleh `lib/finance/sapuan/semua.ts`.

import { prisma } from "@elorae/db";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { bulanWib, deretBulan, kunciBulan, STATUS_PERIODE } from "@/lib/finance/periode/periode";
import { bacaIdSumberPenyusutan, idSumberPenyusutan, STATUS_ASET, SUMBER_ASET } from "./aturan";
import { bulanDisusutkan, catatPenyusutanTertunda, PILIH_ASET_SUSUT, postingPenyusutanSatu, tanggalPenyusutan } from "./penyusutan";

/**
 * Bulan aset yang SEHARUSNYA sudah disusutkan tetapi belum punya baris
 * penyusutan: tanggal penyusutannya (hari terakhir bulan) di [sejak, sampai],
 * dalam masa manfaat, sebelum bulan pelepasan, dan bulannya TIDAK ditutup
 * (bulan tertutup tidak bisa diposting — jumlahnya disusulkan bulan terbuka
 * berikutnya, jadi bukan "terlewat"). Dokumen = `<aset>/<YYYY-MM>`.
 */
export async function cariPenyusutanTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const batas = Math.max(1, Math.floor(opsi.batas));
  if (opsi.sampai.getTime() < opsi.sejak.getTime()) return [];
  const bulan = deretBulan(bulanWib(opsi.sejak), bulanWib(opsi.sampai)).filter((tb) => {
    const t = tanggalPenyusutan(tb).getTime();
    return t >= opsi.sejak.getTime() && t <= opsi.sampai.getTime();
  });
  if (!bulan.length) return [];
  const periode = bulan.map(kunciBulan);
  const aset = await prisma.fixedAsset.findMany({
    where: {
      status: { in: [STATUS_ASET.AKTIF, STATUS_ASET.DILEPAS] },
      usefulLifeMonths: { gt: 0 },
      depreciationStartDate: { lte: opsi.sampai },
    },
    orderBy: { code: "asc" },
    select: { ...PILIH_ASET_SUSUT, depreciations: { where: { period: { in: periode } }, select: { period: true } } },
  });
  if (!aset.length) return [];
  const tertutup = new Set(
    (
      await prisma.accountingPeriod.findMany({
        where: { status: STATUS_PERIODE.TERTUTUP, year: { gte: bulan[0].tahun, lte: bulan[bulan.length - 1].tahun } },
        select: { year: true, month: true },
      })
    ).map((p) => kunciBulan({ tahun: p.year, bulan: p.month })),
  );
  const hasil: DokumenTanpaJurnal[] = [];
  for (const tb of bulan) {
    const p = kunciBulan(tb);
    if (tertutup.has(p)) continue;
    for (const a of aset) {
      if (a.depreciations.some((d) => d.period === p)) continue;
      if (!bulanDisusutkan(a, tb)) continue;
      hasil.push({ id: idSumberPenyusutan(a.id, p), tanggal: tanggalPenyusutan(tb), label: `${a.code} · ${p}` });
      if (hasil.length >= batas) return hasil;
    }
  }
  return hasil;
}

daftarkanSumberSapuan({
  sourceType: SUMBER_ASET.PENYUSUTAN,
  label: "Penyusutan aset tetap",
  cariTanpaJurnal: cariPenyusutanTanpaJurnal,
  async posting(id, olehUserId) {
    const b = bacaIdSumberPenyusutan(id);
    if (!b) return { ok: false, code: "NOTHING_TO_POST" };
    const h = await postingPenyusutanSatu(b.asetId, b.tb, olehUserId);
    if (h.status === "DIPOSTING") {
      await tandaiJurnalTertundaSelesai([dokumenJurnal(SUMBER_ASET.PENYUSUTAN, id)]);
      return { ok: true, journalId: h.journalId, created: true };
    }
    if (h.status === "SUDAH_ADA" && h.journalId) return { ok: true, journalId: h.journalId, created: false };
    if (h.status === "NOL") await tandaiJurnalTertundaSelesai([dokumenJurnal(SUMBER_ASET.PENYUSUTAN, id)]);
    if (h.status !== "GAGAL") return { ok: false, code: "NOTHING_TO_POST" };
    const a = await prisma.fixedAsset.findUnique({ where: { id: b.asetId }, select: { code: true, name: true } });
    await catatPenyusutanTertunda({ asetId: b.asetId, kode: a?.code ?? b.asetId, nama: a?.name, periode: b.periode, kodeGalat: h.kodeGalat, ...(h.peran ? { peran: h.peran } : {}) });
    if (h.kodeGalat === "UNMAPPED_ROLE") return { ok: false, code: "UNMAPPED_ROLE", ...(h.peran ? { role: h.peran } : {}) };
    throw new Error(`Penyusutan ${id} gagal (${h.kodeGalat}${h.pesan ? `: ${h.pesan}` : ""})`);
  },
});
