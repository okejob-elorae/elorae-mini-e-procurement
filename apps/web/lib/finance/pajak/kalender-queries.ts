import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { KUNCI_TANGGAL_MERAH, bacaTanggalMerah } from "@/lib/production/hari-kerja";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaPengaturanPpn } from "./ppn-pengaturan";
import { bacaProfilPajak } from "./profil-pengaturan";
import { akunPeran } from "./akun-peran";
import { beriStatus, cocokSaring, kalenderPajak, kewajibanMasa, type ButirBerstatus, type SaringKalender } from "./kalender";
import { SUMBER_SETORAN_PAJAK, SUMBER_SETORAN_PAJAK_BALIK, geserMasaPajak, masaDariTanggal, rentangMasa } from "./masa";
import { JENIS_REKAP_PPH_FINAL, JENIS_REKAP_PPN, akunPpn, jumlahPpnMasa } from "./masa-queries";
import { jumlahDisetor } from "./setoran-queries";

/**
 * Kalender pajak — KHUSUS SERVER. Aturan jatuh tempo & status di
 * `./kalender.ts`; di sini angkanya: terutang dari buku besar (PPh potong)
 * atau rekap FINAL (PPN, PPh final), disetor dari `TaxPayment`.
 *
 * Satu fungsi (`butirKalenderPajak`) untuk halaman kalender DAN hitungan
 * Beranda, supaya angka barisnya = jumlah baris yang tampil di halaman.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Banyak masa ke belakang yang diperiksa (setoran yang terlambat lama tetap muncul). */
export const MASA_KE_BELAKANG = 12;

const PERAN_POTONGAN: Record<"PPH21" | "PPH23" | "PPH4_2", PostingRole> = {
  PPH21: "PPH21_PAYABLE",
  PPH23: "PPH23_PAYABLE",
  PPH4_2: "PPH4_2_PAYABLE",
};

const keSen = (n: number) => Math.round(Number((n * 100).toFixed(4)));

/** PPh potong terutang per (jenis, masa) dari buku besar: Σ kredit − debit akun hutangnya, tanpa jurnal setoran. */
async function potonganTerutang(client: Klien, masaAwal: string, masaAkhir: string): Promise<Map<string, number>> {
  const peta = await akunPeran(client, Object.values(PERAN_POTONGAN));
  const jenisDari = new Map<string, keyof typeof PERAN_POTONGAN>();
  for (const [jenis, peran] of Object.entries(PERAN_POTONGAN) as [keyof typeof PERAN_POTONGAN, PostingRole][]) {
    const id = peta.get(peran);
    if (id && !jenisDari.has(id)) jenisDari.set(id, jenis);
  }
  const hasil = new Map<string, number>();
  if (jenisDari.size === 0) return hasil;
  const baris = await client.journalLine.findMany({
    where: {
      chartAccountId: { in: [...jenisDari.keys()] },
      journal: {
        ...SARING_JURNAL_BERLAKU,
        date: { gte: rentangMasa(masaAwal).mulai, lt: rentangMasa(masaAkhir).sampai },
        OR: [{ sourceType: null }, { sourceType: { notIn: [SUMBER_SETORAN_PAJAK, SUMBER_SETORAN_PAJAK_BALIK] } }],
      },
    },
    select: { chartAccountId: true, debit: true, credit: true, journal: { select: { date: true } } },
  });
  for (const b of baris) {
    const kunci = `${jenisDari.get(b.chartAccountId)}|${masaDariTanggal(b.journal.date)}`;
    hasil.set(kunci, (hasil.get(kunci) ?? 0) + keSen(Number(b.credit)) - keSen(Number(b.debit)));
  }
  for (const [k, sen] of hasil) hasil.set(k, sen / 100);
  return hasil;
}

export type KalenderPajak = {
  butir: ButirBerstatus[];
  statusPkp: string;
  rezimPph: string;
};

/** Semua butir kalender untuk masa (bulan ini − 12) s.d. bulan ini. */
export async function butirKalenderPajak(opsi: { hariIni?: string } = {}, client: Klien = prisma): Promise<KalenderPajak> {
  const hariIni = opsi.hariIni ?? hariIniWib();
  const masaIni = hariIni.slice(0, 7);
  const masaAwal = geserMasaPajak(masaIni, -MASA_KE_BELAKANG);
  const semuaMasa = Array.from({ length: MASA_KE_BELAKANG + 1 }, (_, i) => geserMasaPajak(masaAwal, i));

  const [ppn, profil, libur, potongan, disetor, rekap] = await Promise.all([
    bacaPengaturanPpn(client),
    bacaProfilPajak(client),
    client.systemSetting.findUnique({ where: { key: KUNCI_TANGGAL_MERAH }, select: { value: true } }),
    potonganTerutang(client, masaAwal, masaIni),
    jumlahDisetor(semuaMasa, client),
    client.taxPeriodRecap.findMany({
      where: { type: { in: [JENIS_REKAP_PPN, JENIS_REKAP_PPH_FINAL] }, period: { in: semuaMasa }, status: "FINAL" },
      select: { type: true, period: true, balance: true },
    }),
  ]);
  const kal = kalenderPajak(bacaTanggalMerah(libur?.value));
  const final = new Map(rekap.map((r) => [`${r.type}|${r.period}`, Math.max(0, Number(r.balance))]));
  // PPN masa yang sudah lewat tetapi rekapnya belum final: perkiraan dari buku besar
  // (keluaran − masukan, tanpa kompensasi) supaya tenggatnya tetap diingatkan.
  const perkiraanPpn = new Map<string, number>();
  if (ppn.statusPkp === "PKP") {
    const akun = await akunPpn(client);
    const belum = semuaMasa.filter((m) => m < masaIni && !final.has(`${JENIS_REKAP_PPN}|${m}`));
    const angka = await Promise.all(belum.map((m) => jumlahPpnMasa(m, akun, client)));
    belum.forEach((m, i) => perkiraanPpn.set(m, Math.max(0, angka[i].keluaran - angka[i].masukan)));
  }

  const butir: ButirBerstatus[] = [];
  for (const masa of semuaMasa) {
    const jenisPotong = (["PPH21", "PPH23", "PPH4_2"] as const).filter(
      (j) => (potongan.get(`${j}|${masa}`) ?? 0) > 0 || (disetor.get(`${j}|${masa}`) ?? 0) > 0,
    );
    const kewajiban = kewajibanMasa(
      masa,
      {
        // PPN hanya untuk masa sejak berlaku (status PKP + berlakuSejak).
        pkp: ppn.statusPkp === "PKP" && (!ppn.berlakuSejak || ppn.berlakuSejak.slice(0, 7) <= masa),
        finalUmkm: profil.rezimPph === "FINAL_UMKM" && (!profil.sejak || profil.sejak.slice(0, 7) <= masa),
        pphNormal: profil.rezimPph === "NORMAL" || profil.rezimPph === "NORMAL_31E",
        potongan: jenisPotong,
      },
      kal,
    );
    for (const k of kewajiban) {
      const kunciSetor = `${k.pajak}|${masa}`;
      const perkiraan = k.pajak === "PPN" && !final.has(`${JENIS_REKAP_PPN}|${masa}`) && perkiraanPpn.has(masa);
      const terutang =
        k.pajak === "PPN"
          ? (final.get(`${JENIS_REKAP_PPN}|${masa}`) ?? perkiraanPpn.get(masa) ?? null)
          : k.pajak === "PPH_FINAL"
            ? (final.get(`${JENIS_REKAP_PPH_FINAL}|${masa}`) ?? null)
            : k.pajak === "PPH21" || k.pajak === "PPH23" || k.pajak === "PPH4_2"
              ? Math.max(0, potongan.get(kunciSetor) ?? 0)
              : null;
      const st = beriStatus(k, { terutang, disetor: disetor.get(kunciSetor) ?? 0 }, hariIni);
      butir.push(perkiraan && k.jenis === "SETOR" ? { ...st, perkiraan: true } : st);
    }
  }
  butir.sort((a, b) => a.jatuhTempo.localeCompare(b.jatuhTempo) || a.kunci.localeCompare(b.kunci));
  return { butir, statusPkp: ppn.statusPkp, rezimPph: profil.rezimPph };
}

/** Hitungan Beranda: butir yang cocok saringan (definisi sama dengan halaman `?saring=`). */
export async function hitungKalenderPajak(saring: Exclude<SaringKalender, "semua">): Promise<number> {
  const { butir } = await butirKalenderPajak();
  return butir.filter((b) => cocokSaring(b, saring)).length;
}
