// Pendaftaran sumber sapuan "dokumen tanpa jurnal" untuk jurnal berulang
// (`RECURRING`). Diimpor oleh `lib/finance/sapuan/semua.ts`.

import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { kunciBulan, STATUS_PERIODE } from "@/lib/finance/periode/periode";
import { bacaIdSumberBerulang, idSumberBerulang, periodeJatuhTempo, SUMBER_BERULANG, tanggalPostingBulan } from "./aturan";
import { catatBerulangTertunda, postingBerulangSatu } from "./writer";

/**
 * Bulan templat AKTIF yang tanggal postingnya di [sejak, sampai] tetapi belum
 * berjurnal `RECURRING`. Bulan yang sudah ditutup tidak termasuk (dilewati
 * dengan catatan, tidak pernah diposting). Templat yang menunggu persetujuan
 * tidak pernah diposting, jadi tidak termasuk.
 */
export async function cariBerulangTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const batas = Math.max(1, Math.floor(opsi.batas));
  const sampaiTeks = formatDateOnlyJakarta(opsi.sampai);
  const sejakTeks = formatDateOnlyJakarta(opsi.sejak);
  const templat = await prisma.recurringJournal.findMany({
    where: { active: true, startDate: { lte: opsi.sampai } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, dayOfMonth: true, startDate: true, endDate: true },
  });
  if (!templat.length) return [];
  const calon: Array<DokumenTanpaJurnal & { periode: string }> = [];
  for (const t of templat) {
    const jadwal = { hari: t.dayOfMonth, mulai: formatDateOnlyJakarta(t.startDate), selesai: t.endDate ? formatDateOnlyJakarta(t.endDate) : null };
    for (const tb of periodeJatuhTempo(jadwal, sampaiTeks)) {
      const tgl = tanggalPostingBulan(tb, t.dayOfMonth);
      if (tgl < sejakTeks) continue;
      calon.push({ id: idSumberBerulang(t.id, kunciBulan(tb)), tanggal: parseDateOnly(tgl) as Date, label: `${t.name} · ${kunciBulan(tb)}`, periode: kunciBulan(tb) });
    }
  }
  if (!calon.length) return [];
  const [ada, tertutup] = await Promise.all([
    prisma.journal.findMany({ where: { sourceType: SUMBER_BERULANG.POSTING, sourceId: { in: calon.map((c) => c.id) } }, select: { sourceId: true } }),
    prisma.accountingPeriod.findMany({ where: { status: STATUS_PERIODE.TERTUTUP }, select: { year: true, month: true } }),
  ]);
  const sudah = new Set(ada.map((j) => j.sourceId));
  const tutup = new Set(tertutup.map((p) => kunciBulan({ tahun: p.year, bulan: p.month })));
  const izinkan = opsi.ids ? new Set(opsi.ids) : null;
  return calon
    .filter((c) => !sudah.has(c.id) && !tutup.has(c.periode) && (!izinkan || izinkan.has(c.id)))
    .sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime())
    .slice(0, batas)
    .map(({ id, tanggal, label }) => ({ id, tanggal, label }));
}

daftarkanSumberSapuan({
  sourceType: SUMBER_BERULANG.POSTING,
  label: "Jurnal berulang",
  cariTanpaJurnal: cariBerulangTanpaJurnal,
  async posting(id, olehUserId) {
    const b = bacaIdSumberBerulang(id);
    if (!b) return { ok: false, code: "NOTHING_TO_POST" };
    const h = await postingBerulangSatu(b.templatId, b.tb, olehUserId);
    if (h.status === "DIPOSTING") {
      await tandaiJurnalTertundaSelesai([dokumenJurnal(SUMBER_BERULANG.POSTING, id)]);
      return { ok: true, journalId: h.journalId, created: true };
    }
    if (h.status === "SUDAH_ADA") return { ok: true, journalId: h.journalId, created: false };
    if (h.status !== "GAGAL") return { ok: false, code: "NOTHING_TO_POST" };
    const t = await prisma.recurringJournal.findUnique({ where: { id: b.templatId }, select: { name: true } });
    await catatBerulangTertunda({ templatId: b.templatId, nama: t?.name ?? b.templatId, periode: b.periode, kodeGalat: h.kodeGalat, pesan: h.pesan });
    throw new Error(`Jurnal berulang ${id} gagal (${h.kodeGalat}${h.pesan ? `: ${h.pesan}` : ""})`);
  },
});
