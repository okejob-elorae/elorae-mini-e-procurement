import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { JEJAK } from "@/lib/receivables/jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import type { Platform } from "./aturan";
import { dekripsi, konteksKol, kunciTersedia } from "./data-sensitif";
import { jurnalKolTertunda } from "./jurnal-kol";
import { bacaTarifPajakKreatif } from "./pajak-pengaturan";
import { ringkasPajakKol, type RingkasPajakKol } from "./pajak-kol-queries";
import { bacaTarifInfo, hitungTermin, type JenisPajak, type ModePajak, type TarifInfo, type TarifPajakKreatif } from "./pph";
import { feeDiakui, JALUR_KELUAR, type JenisKerjaSama, type StatusBayar, type Tahap } from "./tahap";
import { selisihHari } from "./tenggat";
import { jatuhTempoTermin, nilaiBasis, type PemicuTermin, type StatusTermin } from "./termin-aturan";
import { UKURAN_HALAMAN_TERMIN, type ChipTermin } from "./termin-param";

/**
 * Kueri termin pembayaran KOL — KHUSUS SERVER. Klien hanya `import type`.
 *
 * Jatuh tempo DIHITUNG saat dibaca dari pemicunya (deal/tayang + hari, atau
 * tanggal tetap), bukan dibaca dari kolom — tanggal tayang bisa terisi sesudah
 * termin dibuat. Termin isi awal yang belum dihitung PPh-nya (tarifInfo
 * kosong) ditampilkan dengan hitungan tarif sekarang, sama dengan yang akan
 * dipakai saat dibayar.
 *
 * Tidak pernah membawa nomor rekening/NIK/NPWP lengkap — hanya nama bank dan
 * empat digit terakhir.
 */

const angka = (v: unknown): number => Number(v ?? 0);
const hari = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);
const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));

export type JatuhTempoTermin = { tanggal: string; lewat: boolean; lewatHari: number };

export type RekeningRingkas = { bank: string | null; last4: string | null; adaAtasNama: boolean };

export type BarisTermin = {
  id: string;
  kolaborasiId: string;
  docNo: string;
  kolId: string;
  kolNama: string;
  handle: string | null;
  platform: Platform | null;
  campaignNama: string | null;
  tahap: Tahap;
  urutan: number;
  jumlahTermin: number;
  label: string;
  pemicu: PemicuTermin;
  hariSesudah: number;
  jenisPajak: JenisPajak;
  grossUp: boolean;
  bruto: number;
  dpp: number;
  pph: number;
  neto: number;
  /** Jumlah dalam basis fee (neto bila gross-up). */
  jumlah: number;
  pasal: "21" | "23" | null;
  tarifInfo: TarifInfo | null;
  /** Dibayar sebelum modul pajak — tanpa PPh, tanpa jurnal. */
  warisan: boolean;
  status: StatusTermin;
  jatuhTempo: JatuhTempoTermin | null;
  dibayarAt: string | null;
  buktiTransferUrl: string | null;
  nomorBuktiPotong: string | null;
  setorAt: string | null;
  catatan: string | null;
  dataPajakLengkap: boolean;
  rekening: RekeningRingkas;
};

const PILIH = {
  id: true,
  urutan: true,
  label: true,
  neto: true,
  bruto: true,
  pph: true,
  dpp: true,
  jenisPajak: true,
  grossUp: true,
  tarifInfo: true,
  pemicu: true,
  hariSesudah: true,
  jatuhTempo: true,
  status: true,
  bayarKe: true,
  dibayarAt: true,
  buktiTransferUrl: true,
  nomorBuktiPotong: true,
  setorAt: true,
  catatan: true,
  collab: {
    select: {
      id: true,
      docNo: true,
      tahap: true,
      dealAt: true,
      liveAt: true,
      modePajak: true,
      campaign: { select: { name: true } },
      _count: { select: { terms: { where: { status: { not: "BATAL" } } } } },
      kol: {
        select: {
          id: true,
          name: true,
          jenisPajak: true,
          adaNpwp: true,
          dataPajakLengkap: true,
          bankNameEnc: true,
          bankLast4: true,
          bankHolderEnc: true,
          accounts: { select: { platform: true, handle: true }, orderBy: { followers: "desc" as const }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.KolPaymentTermSelect;

type Mentah = Prisma.KolPaymentTermGetPayload<{ select: typeof PILIH }>;

function namaBank(kolId: string, enc: string | null): string | null {
  if (!enc || !kunciTersedia()) return null;
  try {
    return dekripsi(enc, konteksKol(kolId, "bankName"));
  } catch {
    return null;
  }
}

function olah(m: Mentah, tarif: TarifPajakKreatif, hariIni: string, bank: Map<string, string | null>): BarisTermin {
  const c = m.collab;
  const status = m.status as StatusTermin;
  let nilai = { bruto: angka(m.bruto), dpp: angka(m.dpp), pph: angka(m.pph), neto: angka(m.neto) };
  let info = bacaTarifInfo(m.tarifInfo);
  const warisan = status === "DIBAYAR" && !m.tarifInfo && m.bayarKe === 0;
  if (!m.tarifInfo && status !== "DIBAYAR") {
    const r = hitungTermin(nilaiBasis({ ...nilai, grossUp: m.grossUp }), m.grossUp ? "GROSS_UP" : "DIPOTONG", { jenis: c.kol.jenisPajak as JenisPajak, adaNpwp: c.kol.adaNpwp }, tarif);
    nilai = { bruto: r.bruto, dpp: r.dpp, pph: r.pph, neto: r.neto };
    info = { pasal: r.pasal, porsiDppPersen: r.porsiDppPersen, lapisan: r.lapisan, tambahanTanpaNpwpPersen: r.tambahanTanpaNpwpPersen, tarifEfektifPersen: r.tarifEfektifPersen, grossUp: r.grossUp };
  }
  const jt =
    status === "BELUM"
      ? jatuhTempoTermin(
          { pemicu: m.pemicu as PemicuTermin, hariSesudah: m.hariSesudah, tanggal: m.pemicu === "TANGGAL" ? hari(m.jatuhTempo) : null },
          { dealHari: hari(c.dealAt), tayangHari: hari(c.liveAt) },
        )
      : null;
  const akun = c.kol.accounts[0];
  return {
    id: m.id,
    kolaborasiId: c.id,
    docNo: c.docNo,
    kolId: c.kol.id,
    kolNama: c.kol.name,
    handle: akun?.handle ?? null,
    platform: (akun?.platform as Platform | undefined) ?? null,
    campaignNama: c.campaign?.name ?? null,
    tahap: c.tahap as Tahap,
    urutan: m.urutan,
    jumlahTermin: c._count.terms,
    label: m.label,
    pemicu: m.pemicu as PemicuTermin,
    hariSesudah: m.hariSesudah,
    jenisPajak: m.jenisPajak as JenisPajak,
    grossUp: m.grossUp,
    ...nilai,
    jumlah: nilaiBasis({ ...nilai, grossUp: m.grossUp }),
    pasal: info?.pasal ?? (m.jenisPajak === "BADAN" ? "23" : m.jenisPajak === "ORANG_PRIBADI" ? "21" : null),
    tarifInfo: info,
    warisan,
    status,
    jatuhTempo: jt ? { tanggal: jt, lewat: jt < hariIni, lewatHari: jt < hariIni ? selisihHari(jt, hariIni) : 0 } : null,
    dibayarAt: hari(m.dibayarAt),
    buktiTransferUrl: m.buktiTransferUrl,
    nomorBuktiPotong: m.nomorBuktiPotong,
    setorAt: hari(m.setorAt),
    catatan: m.catatan,
    dataPajakLengkap: c.kol.dataPajakLengkap,
    rekening: { bank: bank.get(c.kol.id) ?? null, last4: c.kol.bankLast4, adaAtasNama: Boolean(c.kol.bankHolderEnc) },
  };
}

function petaBank(mentah: readonly Mentah[]): Map<string, string | null> {
  const peta = new Map<string, string | null>();
  for (const m of mentah) if (!peta.has(m.collab.kol.id)) peta.set(m.collab.kol.id, namaBank(m.collab.kol.id, m.collab.kol.bankNameEnc));
  return peta;
}

export type SaringanTermin = { cari?: string | null; campaignId?: string | null; kolaborasiId?: string | null };

function whereTermin(s: SaringanTermin): Prisma.KolPaymentTermWhereInput {
  const q = (s.cari ?? "").trim().replace(/^@+/, "");
  return {
    status: { not: "BATAL" },
    collab: {
      fee: { gt: 0 },
      ...(s.campaignId ? { campaignId: s.campaignId } : {}),
      ...(s.kolaborasiId ? { id: s.kolaborasiId } : {}),
      ...(q
        ? {
            OR: [
              { docNo: cariTeks(q) },
              { kol: { name: cariTeks(q) } },
              { kol: { accounts: { some: { handle: cariTeks(q) } } } },
              { campaign: { name: cariTeks(q) } },
            ],
          }
        : {}),
    },
    // Kolaborasi yang keluar jalur tidak lagi ditagih — kecuali yang sudah dibayar (riwayat).
    OR: [{ status: "DIBAYAR" }, { collab: { tahap: { notIn: [...JALUR_KELUAR] } } }],
  };
}

const cocok = (chip: ChipTermin, b: BarisTermin, hariIni: string) =>
  chip === "SEMUA" ||
  (chip === "DIBAYAR" && b.status === "DIBAYAR") ||
  (chip === "BELUM" && b.status === "BELUM") ||
  (chip === "JATUH_TEMPO" && b.status === "BELUM" && b.jatuhTempo !== null && b.jatuhTempo.tanggal <= hariIni);

function urutkan(a: BarisTermin, b: BarisTermin): number {
  const rank = (x: BarisTermin) => (x.status === "BELUM" ? 0 : 1);
  return (
    rank(a) - rank(b) ||
    (a.status === "BELUM"
      ? (a.jatuhTempo?.tanggal ?? "9999").localeCompare(b.jatuhTempo?.tanggal ?? "9999")
      : (b.dibayarAt ?? "").localeCompare(a.dibayarAt ?? "")) ||
    b.docNo.localeCompare(a.docNo) ||
    a.urutan - b.urutan
  );
}

export type RingkasTerminDaftar = {
  jumlah: number;
  /** Σ jumlah termin dalam basis fee = fee yang DISEPAKATI (neto untuk gross-up, bruto untuk dipotong). */
  fee: number;
  /** Σ bruto = biaya bruto fee termasuk PPh gross-up. */
  bruto: number;
  pph: number;
  /** PPh termin dipotong (dipotong dari KOL). */
  pphDipotong: number;
  /** PPh termin gross-up (ditanggung Elorae, menambah biaya). */
  pphDitanggung: number;
  neto: number;
  /** Bruto termin yang SUDAH menjadi beban: kolaborasinya sudah tayang (aturan jurnal `feeDiakui`). */
  bebanDiakui: number;
  belumNeto: number;
  belumJumlah: number;
};

/** Ringkasan termin yang tampil — dipakai kartu Pembayaran; murni, diekspor untuk diuji. */
export function ringkasTermin(baris: readonly Pick<BarisTermin, "jumlah" | "bruto" | "pph" | "neto" | "grossUp" | "status" | "tahap">[]): RingkasTerminDaftar {
  let fee = 0;
  let bruto = 0;
  let pph = 0;
  let pphDipotong = 0;
  let pphDitanggung = 0;
  let neto = 0;
  let bebanDiakui = 0;
  let belumNeto = 0;
  let belumJumlah = 0;
  for (const b of baris) {
    fee += keSen(b.jumlah);
    bruto += keSen(b.bruto);
    pph += keSen(b.pph);
    if (b.grossUp) pphDitanggung += keSen(b.pph);
    else pphDipotong += keSen(b.pph);
    neto += keSen(b.neto);
    if (b.status !== "BATAL" && feeDiakui(b.tahap)) bebanDiakui += keSen(b.bruto);
    if (b.status === "BELUM") {
      belumNeto += keSen(b.neto);
      belumJumlah++;
    }
  }
  return {
    jumlah: baris.length,
    fee: fee / 100,
    bruto: bruto / 100,
    pph: pph / 100,
    pphDipotong: pphDipotong / 100,
    pphDitanggung: pphDitanggung / 100,
    neto: neto / 100,
    bebanDiakui: bebanDiakui / 100,
    belumNeto: belumNeto / 100,
    belumJumlah,
  };
}

/** Semua termin yang cocok saringannya (tanpa halaman), sudah diurut. */
export async function semuaTermin(s: SaringanTermin & { chip?: ChipTermin }, hariIni = hariIniWib()): Promise<BarisTermin[]> {
  const [mentah, tarif] = await Promise.all([
    prisma.kolPaymentTerm.findMany({ where: whereTermin(s), select: PILIH }),
    bacaTarifPajakKreatif(),
  ]);
  const ada = mentah.filter((m) => m.collab?.kol != null);
  const bank = petaBank(ada);
  return ada
    .map((m) => olah(m, tarif, hariIni, bank))
    .filter((b) => cocok(s.chip ?? "SEMUA", b, hariIni))
    .sort(urutkan);
}

export type HasilDaftarTermin = {
  baris: BarisTermin[];
  total: number;
  halaman: number;
  perHalaman: number;
  jumlahPerChip: Record<ChipTermin, number>;
  ringkas: RingkasTerminDaftar;
};

export async function daftarTermin(
  opsi: SaringanTermin & { chip?: ChipTermin; halaman?: number; perHalaman?: number },
  hariIni = hariIniWib(),
): Promise<HasilDaftarTermin> {
  const chip = opsi.chip ?? "BELUM";
  const semua = await semuaTermin({ cari: opsi.cari, campaignId: opsi.campaignId, kolaborasiId: opsi.kolaborasiId, chip: "SEMUA" }, hariIni);
  const jumlahPerChip: Record<ChipTermin, number> = { BELUM: 0, JATUH_TEMPO: 0, DIBAYAR: 0, SEMUA: semua.length };
  for (const b of semua) {
    if (cocok("BELUM", b, hariIni)) jumlahPerChip.BELUM++;
    if (cocok("JATUH_TEMPO", b, hariIni)) jumlahPerChip.JATUH_TEMPO++;
    if (cocok("DIBAYAR", b, hariIni)) jumlahPerChip.DIBAYAR++;
  }
  const tersaring = semua.filter((b) => cocok(chip, b, hariIni));
  const perHalaman = (UKURAN_HALAMAN_TERMIN as readonly number[]).includes(opsi.perHalaman ?? 0) ? opsi.perHalaman! : UKURAN_HALAMAN_TERMIN[0];
  const jumlahHalaman = Math.max(1, Math.ceil(tersaring.length / perHalaman));
  const halaman = Math.min(Math.max(1, Math.trunc(opsi.halaman ?? 1) || 1), jumlahHalaman);
  return {
    baris: tersaring.slice((halaman - 1) * perHalaman, halaman * perHalaman),
    total: tersaring.length,
    halaman,
    perHalaman,
    jumlahPerChip,
    ringkas: ringkasTermin(tersaring),
  };
}

// ───────────────────── Panel pembayaran kolaborasi ─────────────────────

export type RiwayatTermin = { id: string; waktu: string; oleh: string; aksi: string; changes: unknown; reason: string | null; metadata: unknown };

export type PanelTerminData = {
  kolaborasiId: string;
  docNo: string;
  kolId: string;
  kolNama: string;
  tahap: Tahap;
  jenis: JenisKerjaSama;
  fee: number;
  modePajak: ModePajak;
  payStatus: StatusBayar;
  paidAmount: number;
  jurnalOtomatis: boolean;
  dealHari: string | null;
  tayangHari: string | null;
  termin: BarisTermin[];
  total: { bruto: number; pph: number; neto: number; dibayarNeto: number; sisaNeto: number };
  pajakKol: RingkasPajakKol | null;
  tarif: TarifPajakKreatif;
  riwayat: RiwayatTermin[];
  /** Hanya untuk pemegang journals:manage (diisi pemanggil). */
  jurnalTertunda: { kolaborasi: boolean; sampelIds: string[]; sebab: string[] } | null;
};

const AKSI_RIWAYAT = [
  JEJAK.PEMBAYARAN_KOL_DICATAT,
  JEJAK.TERMIN_KOL_DIATUR,
  JEJAK.TERMIN_KOL_DIBAYAR,
  JEJAK.TERMIN_KOL_BAYAR_DIBATALKAN,
  JEJAK.BUKTI_POTONG_KOL_DICATAT,
  JEJAK.SETOR_PPH_KOL_DICATAT,
  JEJAK.MODE_PAJAK_KOL_DIUBAH,
];

export async function dataPanelTermin(
  kolaborasiId: string,
  opsi: { hariIni?: string; denganJurnal?: boolean } = {},
): Promise<PanelTerminData | null> {
  const hariIni = opsi.hariIni ?? hariIniWib();
  const c = await prisma.kolBrief.findUnique({
    where: { id: kolaborasiId },
    select: {
      id: true,
      docNo: true,
      tahap: true,
      jenis: true,
      fee: true,
      modePajak: true,
      payStatus: true,
      paidAmount: true,
      jurnalOtomatis: true,
      dealAt: true,
      liveAt: true,
      kol: { select: { id: true, name: true } },
    },
  });
  if (!c) return null;
  const [mentah, tarif, pajakKol, jejak, tertunda] = await Promise.all([
    prisma.kolPaymentTerm.findMany({ where: { collabId: c.id, status: { not: "BATAL" } }, select: PILIH, orderBy: [{ urutan: "asc" }, { createdAt: "asc" }] }),
    bacaTarifPajakKreatif(),
    ringkasPajakKol(c.kol.id),
    prisma.auditLog.findMany({
      where: { entityType: "KolBrief", entityId: c.id, action: { in: AKSI_RIWAYAT } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, action: true, changes: true, reason: true, metadata: true, user: { select: { name: true, email: true } } },
    }),
    opsi.denganJurnal ? jurnalKolTertunda(c.id) : Promise.resolve(null),
  ]);
  const bank = petaBank(mentah);
  const termin = mentah.map((m) => olah(m, tarif, hariIni, bank));
  const sum = (f: (b: BarisTermin) => number, saring: (b: BarisTermin) => boolean = () => true) =>
    termin.filter(saring).reduce((s, b) => s + keSen(f(b)), 0) / 100;
  return {
    kolaborasiId: c.id,
    docNo: c.docNo,
    kolId: c.kol.id,
    kolNama: c.kol.name,
    tahap: c.tahap as Tahap,
    jenis: c.jenis as JenisKerjaSama,
    fee: angka(c.fee),
    modePajak: c.modePajak as ModePajak,
    payStatus: c.payStatus as StatusBayar,
    paidAmount: angka(c.paidAmount),
    jurnalOtomatis: c.jurnalOtomatis,
    dealHari: hari(c.dealAt),
    tayangHari: hari(c.liveAt),
    termin,
    total: {
      bruto: sum((b) => b.bruto),
      pph: sum((b) => b.pph),
      neto: sum((b) => b.neto),
      dibayarNeto: sum((b) => b.neto, (b) => b.status === "DIBAYAR"),
      sisaNeto: sum((b) => b.neto, (b) => b.status === "BELUM"),
    },
    pajakKol,
    tarif,
    riwayat: jejak.map((j) => ({
      id: j.id,
      waktu: j.createdAt.toISOString(),
      oleh: j.user?.name?.trim() || j.user?.email || "—",
      aksi: j.action,
      changes: j.changes,
      reason: j.reason,
      metadata: j.metadata,
    })),
    jurnalTertunda: tertunda,
  };
}

// ───────────────────── PPh dipotong (Keuangan) ─────────────────────

export type BarisPph = {
  terminId: string;
  kolaborasiId: string;
  docNo: string;
  kolId: string;
  kolNama: string;
  label: string;
  pasal: "21" | "23" | null;
  jenisPajak: JenisPajak;
  /** "NIK ••••1234" / "NPWP ••••5678" / null — TIDAK PERNAH lengkap. */
  identitasTersamar: string | null;
  adaNpwp: boolean;
  bruto: number;
  dpp: number;
  tarifEfektifPersen: number;
  pph: number;
  neto: number;
  grossUp: boolean;
  dibayarAt: string;
  nomorBuktiPotong: string | null;
  buktiPotongAt: string | null;
  setorAt: string | null;
  ntpn: string | null;
};

/** Batas masa (bulan WIB) sebagai rentang Date [awal, akhir). */
export function rentangMasa(masa: string): { awal: Date; akhir: Date } {
  const [t, b] = masa.split("-").map(Number);
  const berikut = b === 12 ? `${t + 1}-01` : `${t}-${String(b + 1).padStart(2, "0")}`;
  return { awal: parseDateOnly(`${masa}-01`)!, akhir: parseDateOnly(`${berikut}-01`)! };
}

/** Termin dibayar ber-PPh dalam satu masa (bulan WIB tanggal bayar). */
export async function daftarPphDipotong(masa: string): Promise<BarisPph[]> {
  const { awal, akhir } = rentangMasa(masa);
  const mentah = await prisma.kolPaymentTerm.findMany({
    where: { status: "DIBAYAR", pph: { gt: 0 }, dibayarAt: { gte: awal, lt: akhir } },
    orderBy: [{ dibayarAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      label: true,
      bruto: true,
      dpp: true,
      pph: true,
      neto: true,
      grossUp: true,
      jenisPajak: true,
      tarifInfo: true,
      dibayarAt: true,
      nomorBuktiPotong: true,
      buktiPotongAt: true,
      setorAt: true,
      ntpn: true,
      collab: { select: { id: true, docNo: true, kol: { select: { id: true, name: true, adaNpwp: true, nikLast4: true, npwpEnc: true } } } },
    },
  });
  const kunci = kunciTersedia();
  return mentah
    .filter((m) => m.collab?.kol)
    .map((m) => {
      const k = m.collab.kol;
      let identitas: string | null = null;
      if (m.jenisPajak === "BADAN" || (k.npwpEnc && !k.nikLast4)) {
        let npwp4: string | null = null;
        if (k.npwpEnc && kunci) {
          try {
            npwp4 = dekripsi(k.npwpEnc, konteksKol(k.id, "npwp")).slice(-4);
          } catch {
            npwp4 = null;
          }
        }
        identitas = k.npwpEnc ? `NPWP ••••${npwp4 ?? "????"}` : null;
      } else if (k.nikLast4) {
        identitas = `NIK ••••${k.nikLast4}`;
      }
      const info = bacaTarifInfo(m.tarifInfo);
      const bruto = angka(m.bruto);
      const pph = angka(m.pph);
      return {
        terminId: m.id,
        kolaborasiId: m.collab.id,
        docNo: m.collab.docNo,
        kolId: k.id,
        kolNama: k.name,
        label: m.label,
        pasal: info?.pasal ?? (m.jenisPajak === "BADAN" ? "23" : "21"),
        jenisPajak: m.jenisPajak as JenisPajak,
        identitasTersamar: identitas,
        adaNpwp: k.adaNpwp,
        bruto,
        dpp: angka(m.dpp),
        tarifEfektifPersen: info?.tarifEfektifPersen ?? (bruto > 0 ? Math.round((pph / bruto) * 10_000) / 100 : 0),
        pph,
        neto: angka(m.neto),
        grossUp: m.grossUp,
        dibayarAt: hari(m.dibayarAt)!,
        nomorBuktiPotong: m.nomorBuktiPotong,
        buktiPotongAt: hari(m.buktiPotongAt),
        setorAt: hari(m.setorAt),
        ntpn: m.ntpn,
      };
    });
}

/** Identitas LENGKAP untuk ekspor keuangan (sesudah PIN) — per KOL, dibuka di server. */
export async function identitasLengkap(kolIds: readonly string[]): Promise<Map<string, { nik: string | null; npwp: string | null }>> {
  const hasil = new Map<string, { nik: string | null; npwp: string | null }>();
  if (kolIds.length === 0) return hasil;
  const kol = await prisma.kol.findMany({ where: { id: { in: [...new Set(kolIds)] } }, select: { id: true, nikEnc: true, npwpEnc: true } });
  for (const k of kol) {
    const buka = (v: string | null, kolom: "nik" | "npwp") => {
      if (!v) return null;
      try {
        return dekripsi(v, konteksKol(k.id, kolom));
      } catch {
        return null;
      }
    };
    hasil.set(k.id, { nik: buka(k.nikEnc, "nik"), npwp: buka(k.npwpEnc, "npwp") });
  }
  return hasil;
}

