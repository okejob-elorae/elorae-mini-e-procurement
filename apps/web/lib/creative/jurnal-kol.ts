import { JournalError, postJournal, prisma, type AdminNotification, type Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { dokumenJurnal, tandaiJurnalTertundaSelesai, type SumberNotifikasiJurnal } from "@/lib/finance/jurnal-tertunda";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import {
  bacaKeadaanBuku,
  barisPembayaran,
  barisPengakuan,
  barisSampel,
  idBayar,
  idFee,
  pasalDariJenis,
  selisihPengakuan,
  SUMBER_KOL,
  type BarisJurnalKol,
} from "./jurnal-kol-aturan";
import { feeDiakui, type Tahap } from "./tahap";

/**
 * Penulis jurnal Ruang KOL — KHUSUS SERVER. Aturannya di `jurnal-kol-aturan.ts`.
 *
 * Dipanggil SESUDAH commit oleh penulis yang mengubah fakta uang KOL
 * (termin dibayar/dibatalkan, termin diatur, fee/tahap berubah, sampel
 * berangkat), lewat pembungkus `...Aman` yang tidak pernah melempar: masalah
 * keuangan (peran belum dipetakan) tidak boleh menggagalkan pembayaran atau
 * pengiriman. Kegagalan menjadi notifikasi `JOURNAL_PENDING` yang bisa
 * diposting ulang dari panel pembayaran kolaborasi; keberhasilan penuh
 * menandai notifikasinya selesai.
 *
 * `sinkronJurnalKolaborasi` bersifat MENYELARASKAN, bukan mencatat peristiwa:
 * ia membaca keadaan sekarang (termin + tahap) dan jurnal yang sudah ada, lalu
 * memposting yang kurang. Dijalankan dua kali tidak menggandakan apa pun.
 *
 * Kolaborasi `jurnalOtomatis = false` (riwayatnya sudah bergerak di luar buku
 * sebelum modul ini) tidak pernah dijurnal otomatis. Tidak ada gerbang tanggal
 * mulai buku besar — sama seperti jurnal penerimaan barang dan kanvas, jurnal
 * ini dipicu peristiwa, bukan disapu dari riwayat.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type KodeGagalJurnal = "UNMAPPED_ROLE" | "UNBALANCED" | "NON_POSTABLE_ACCOUNT" | "ERROR";
export type GagalJurnal = { sumber: string; kode: KodeGagalJurnal; peran: string | null; detail?: string };
export type HasilSinkron = { ok: boolean; dilewati?: "TANPA_JURNAL_OTOMATIS" | "TIDAK_DITEMUKAN"; diposting: number; gagal: GagalJurnal[] };

const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));
const angka = (v: unknown): number => Number(v ?? 0);

function gagalDari(sumber: string, r: GenerateAutoJournalResult): GagalJurnal | null {
  if (r.ok || r.code === "NOTHING_TO_POST") return null;
  return { sumber, kode: r.code as KodeGagalJurnal, peran: "role" in r ? (r.role ?? null) : null };
}

function gagalDariGalat(sumber: string, e: unknown): GagalJurnal {
  if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { sumber, kode: "NON_POSTABLE_ACCOUNT", peran: null };
  if (e instanceof JournalError && e.code === "UNBALANCED") return { sumber, kode: "UNBALANCED", peran: null };
  return { sumber, kode: "ERROR", peran: null, detail: e instanceof Error ? e.message : "unknown" };
}

async function posting(
  client: Klien,
  sourceType: string,
  sourceId: string,
  baris: BarisJurnalKol[],
  meta: { date: Date; description: string; postedById: string },
): Promise<{ dibuat: boolean; gagal: GagalJurnal | null }> {
  if (baris.length === 0) return { dibuat: false, gagal: null };
  try {
    const r = await generateAutoJournal(client, sourceType, sourceId, baris, meta);
    return { dibuat: r.ok && r.created, gagal: gagalDari(`${sourceType}:${sourceId}`, r) };
  } catch (e) {
    return { dibuat: false, gagal: gagalDariGalat(`${sourceType}:${sourceId}`, e) };
  }
}

/** Semua jurnal KOL (fee, bayar, balik) milik satu kolaborasi, dengan baris bermemo. */
async function jurnalKolaborasi(client: Klien, kolaborasiId: string) {
  return client.journal.findMany({
    where: {
      sourceType: { in: [SUMBER_KOL.FEE, SUMBER_KOL.BAYAR, SUMBER_KOL.BALIK] },
      sourceId: { startsWith: `${kolaborasiId}#` },
    },
    select: { id: true, sourceType: true, sourceId: true, date: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
  });
}

/**
 * Selaraskan buku besar satu kolaborasi dengan keadaannya sekarang:
 * 1. pembayaran termin yang belum berjurnal (instans `bayarKe` terakhir yang
 *    masih DIBAYAR);
 * 2. pembalik untuk setiap instans pembayaran yang sudah dibatalkan;
 * 3. selisih pengakuan fee + reklasifikasi uang muka (`KOL_FEE #n`).
 */
export async function sinkronJurnalKolaborasi(kolaborasiId: string, postedById: string, client: Klien = prisma): Promise<HasilSinkron> {
  const c = await client.kolBrief.findUnique({
    where: { id: kolaborasiId },
    select: {
      id: true,
      docNo: true,
      tahap: true,
      liveAt: true,
      jurnalOtomatis: true,
      kol: { select: { name: true } },
      terms: {
        select: { id: true, label: true, status: true, bruto: true, pph: true, neto: true, jenisPajak: true, bayarKe: true, dibayarAt: true },
      },
    },
  });
  if (!c) return { ok: true, dilewati: "TIDAK_DITEMUKAN", diposting: 0, gagal: [] };
  if (!c.jurnalOtomatis) return { ok: true, dilewati: "TANPA_JURNAL_OTOMATIS", diposting: 0, gagal: [] };

  const diakui = feeDiakui(c.tahap as Tahap);
  const gagal: GagalJurnal[] = [];
  let diposting = 0;
  const label = `${c.docNo} — ${c.kol.name}`;

  let jurnal = await jurnalKolaborasi(client, c.id);
  const ada = new Set(jurnal.map((j) => `${j.sourceType}|${j.sourceId}`));

  for (const t of c.terms) {
    // 1. Instans pembayaran yang masih berlaku.
    if (t.status === "DIBAYAR" && t.bayarKe > 0) {
      const id = idBayar(c.id, t.id, t.bayarKe);
      if (!ada.has(`${SUMBER_KOL.BAYAR}|${id}`)) {
        const baris = barisPembayaran(
          { bruto: angka(t.bruto), pph: angka(t.pph), neto: angka(t.neto), pasal: pasalDariJenis(t.jenisPajak) },
          diakui,
        );
        const r = await posting(client, SUMBER_KOL.BAYAR, id, baris, {
          date: t.dibayarAt ?? new Date(),
          description: `Pembayaran KOL ${label} — ${t.label}`,
          postedById,
        });
        if (r.dibuat) diposting++;
        if (r.gagal) gagal.push(r.gagal);
      }
    }
    // 2. Instans yang sudah dibatalkan: semua sebelum yang berlaku, atau semuanya bila tidak dibayar lagi.
    const batasBerlaku = t.status === "DIBAYAR" ? t.bayarKe - 1 : t.bayarKe;
    for (let g = 1; g <= batasBerlaku; g++) {
      const id = idBayar(c.id, t.id, g);
      const asli = jurnal.find((j) => j.sourceType === SUMBER_KOL.BAYAR && j.sourceId === id);
      if (!asli || ada.has(`${SUMBER_KOL.BALIK}|${id}`)) continue;
      try {
        const res = await postJournal(client, {
          source: { type: SUMBER_KOL.BALIK, id },
          date: asli.date,
          description: `Pembatalan pembayaran KOL ${label} — ${t.label}`,
          postedById,
          lines: asli.lines.map((l) => ({
            chartAccountId: l.chartAccountId,
            debit: angka(l.credit),
            credit: angka(l.debit),
            ...(l.memo ? { memo: l.memo } : {}),
          })),
        });
        if (res.created) diposting++;
      } catch (e) {
        gagal.push(gagalDariGalat(`${SUMBER_KOL.BALIK}:${id}`, e));
      }
    }
  }

  // 3. Pengakuan fee + reklasifikasi uang muka, dari buku yang sudah termasuk langkah 1–2.
  jurnal = await jurnalKolaborasi(client, c.id);
  const buku = bacaKeadaanBuku(jurnal.map((j) => ({ sourceType: j.sourceType, lines: j.lines.map((l) => ({ memo: l.memo, debit: angka(l.debit), credit: angka(l.credit) })) })));
  const brutoHidupSen = c.terms.filter((t) => t.status !== "BATAL").reduce((s, t) => s + keSen(angka(t.bruto)), 0);
  const selisih = selisihPengakuan({ diakui, brutoHidupSen, buku });
  const baris = barisPengakuan(selisih);
  if (baris.length > 0) {
    const ke = jurnal.filter((j) => j.sourceType === SUMBER_KOL.FEE).length + 1;
    const pertama = ke === 1;
    const r = await posting(client, SUMBER_KOL.FEE, idFee(c.id, ke), baris, {
      date: pertama && diakui && c.liveAt ? c.liveAt : new Date(),
      description: pertama ? `Pengakuan fee KOL ${label}` : `Penyesuaian fee KOL ${label}`,
      postedById,
    });
    if (r.dibuat) diposting++;
    if (r.gagal) gagal.push(r.gagal);
  }

  return { ok: gagal.length === 0, diposting, gagal };
}

/** Jurnal sampel berangkat (DR Beban KOL / CR Persediaan). Pengiriman tanpa nilai tidak dijurnal. */
export async function postJurnalSampelKol(pengirimanId: string, postedById: string, client: Klien = prisma): Promise<HasilSinkron> {
  const p = await client.kolShipment.findUnique({
    where: { id: pengirimanId },
    select: {
      id: true,
      sentAt: true,
      stockIssuedAt: true,
      trackingNo: true,
      lines: { select: { qty: true, unitCost: true, item: { select: { type: true } } } },
      collab: { select: { docNo: true, kol: { select: { name: true } } } },
    },
  });
  if (!p || !p.stockIssuedAt) return { ok: true, dilewati: "TIDAK_DITEMUKAN", diposting: 0, gagal: [] };
  const baris = barisSampel(p.lines.map((l) => ({ qty: l.qty, unitCost: angka(l.unitCost), tipeBarang: l.item?.type ?? null })));
  const r = await posting(client, SUMBER_KOL.SAMPEL, p.id, baris, {
    date: p.sentAt ?? p.stockIssuedAt,
    description: `Sampel KOL ${p.collab.docNo} — ${p.collab.kol.name}${p.trackingNo ? ` (resi ${p.trackingNo})` : ""}`,
    postedById,
  });
  return { ok: !r.gagal, diposting: r.dibuat ? 1 : 0, gagal: r.gagal ? [r.gagal] : [] };
}

// ───────────────────── Pembungkus aman + JOURNAL_PENDING ─────────────────────

export type JenisNotifikasiKol = "kol_kolaborasi" | "kol_sampel";

/** Sumber notifikasi untuk `tandaiJurnalTertundaSelesai`. */
function sumberNotifikasi(jenis: JenisNotifikasiKol, docId: string): SumberNotifikasiJurnal {
  return jenis === "kol_sampel" ? dokumenJurnal(SUMBER_KOL.SAMPEL, docId) : { tipe: "kolaborasiKol", kolaborasiId: docId };
}

const PETUNJUK: Record<JenisNotifikasiKol, string> = {
  kol_kolaborasi: "Petakan akunnya di Keuangan → Pemetaan Akun, lalu posting ulang dari tab Pembayaran kolaborasi itu.",
  kol_sampel: "Petakan akunnya di Keuangan → Pemetaan Akun, lalu posting ulang dari tab Pembayaran kolaborasi itu.",
};

async function sudahDitandai(jenis: JenisNotifikasiKol, docId: string, alasan: string): Promise<boolean> {
  const baru = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { metadata: true },
  });
  return baru.some((n) => {
    const m = (typeof n.metadata === "string" ? safeJson(n.metadata) : n.metadata) as { docId?: string; kind?: string; reason?: string } | null;
    return m?.docId === docId && m?.kind === jenis && m?.reason === alasan;
  });
}

function safeJson(teks: string): unknown {
  try {
    return JSON.parse(teks);
  } catch {
    return null;
  }
}

async function kabari(jenis: JenisNotifikasiKol, docId: string, g: GagalJurnal, extra: Record<string, string | null>): Promise<void> {
  let n: AdminNotification | null = null;
  try {
    if (await sudahDitandai(jenis, docId, g.kode)) return;
    const apa = jenis === "kol_sampel" ? "Jurnal sampel KOL" : "Jurnal fee/pembayaran KOL";
    n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `${apa} belum terposting`,
        message: `${apa}${extra.docNo ? ` ${extra.docNo}` : ""} belum terposting (${g.kode}${g.peran ? `: ${g.peran}` : ""}${g.detail ? `: ${g.detail}` : ""}). ${PETUNJUK[jenis]}`,
        metadata: { docId, kind: jenis, reason: g.kode, role: g.peran, ...extra },
      },
    });
  } catch (e) {
    console.error(`[jurnal-kol] GAGAL menulis JOURNAL_PENDING untuk ${jenis} ${docId}:`, e);
  }
  if (n) void fanOutAdminNotification(n);
}

/** Dilewati di dalam vitest kecuali dipaksa — tes basis data bersama tidak boleh menulis notifikasi tanpa sengaja. */
const dilewatiTes = (paksa?: boolean) => Boolean(process.env.VITEST) && !paksa;

/**
 * Sinkron jurnal beberapa kolaborasi tanpa pernah melempar. Kegagalan →
 * `JOURNAL_PENDING` (sekali per sebab); keberhasilan penuh → notifikasi
 * kolaborasi itu ditandai selesai.
 */
export async function sinkronJurnalKolAman(
  kolaborasiIds: readonly string[],
  postedById: string,
  opsi: { paksa?: boolean } = {},
): Promise<HasilSinkron[]> {
  if (dilewatiTes(opsi.paksa)) return [];
  const hasil: HasilSinkron[] = [];
  for (const id of new Set(kolaborasiIds)) {
    const mulai = new Date();
    try {
      const r = await sinkronJurnalKolaborasi(id, postedById);
      hasil.push(r);
      if (r.dilewati) continue;
      if (r.ok) {
        await tandaiJurnalTertundaSelesai([sumberNotifikasi("kol_kolaborasi", id)], { dibuatSebelum: mulai });
      } else {
        const docNo = (await prisma.kolBrief.findUnique({ where: { id }, select: { docNo: true } }))?.docNo ?? null;
        for (const g of r.gagal) await kabari("kol_kolaborasi", id, g, { docNo });
      }
    } catch (e) {
      console.error("[sinkronJurnalKolAman] gagal untuk", id, e);
      await kabari("kol_kolaborasi", id, gagalDariGalat("KOL", e), { docNo: null });
    }
  }
  return hasil;
}

/** Jurnal sampel berangkat tanpa pernah melempar (dipanggil penulis pengiriman sesudah commit). */
export async function postJurnalSampelKolAman(pengirimanId: string, postedById: string, opsi: { paksa?: boolean } = {}): Promise<HasilSinkron | null> {
  if (dilewatiTes(opsi.paksa)) return null;
  try {
    const r = await postJurnalSampelKol(pengirimanId, postedById);
    const induk = await prisma.kolShipment.findUnique({ where: { id: pengirimanId }, select: { collabId: true, collab: { select: { docNo: true } } } });
    if (r.ok) await tandaiJurnalTertundaSelesai([sumberNotifikasi("kol_sampel", pengirimanId)]);
    else for (const g of r.gagal) await kabari("kol_sampel", pengirimanId, g, { collabId: induk?.collabId ?? null, docNo: induk?.collab.docNo ?? null });
    return r;
  } catch (e) {
    console.error("[postJurnalSampelKolAman] gagal untuk", pengirimanId, e);
    await kabari("kol_sampel", pengirimanId, gagalDariGalat("KOL_SAMPLE", e), { collabId: null, docNo: null });
    return null;
  }
}

/**
 * Notifikasi `JOURNAL_PENDING` KOL yang masih terbuka untuk satu kolaborasi
 * (termasuk sampelnya). Dipakai panel pembayaran untuk menampilkan tombol
 * "Posting ulang jurnal" — dan aksi posting ulangnya hanya memposting sampel
 * yang memang pernah gagal (pengiriman lama tanpa jurnal tidak diposting).
 */
export async function jurnalKolTertunda(kolaborasiId: string): Promise<{ kolaborasi: boolean; sampelIds: string[]; sebab: string[] }> {
  const baru = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    select: { metadata: true },
  });
  const pengiriman = new Set(
    (await prisma.kolShipment.findMany({ where: { collabId: kolaborasiId }, select: { id: true } })).map((p) => p.id),
  );
  let kolaborasi = false;
  const sampel = new Set<string>();
  const sebab = new Set<string>();
  for (const n of baru) {
    const m = (typeof n.metadata === "string" ? safeJson(n.metadata) : n.metadata) as { docId?: string; kind?: string; reason?: string } | null;
    if (!m?.docId) continue;
    if (m.kind === "kol_kolaborasi" && m.docId === kolaborasiId) {
      kolaborasi = true;
      if (m.reason) sebab.add(m.reason);
    }
    if (m.kind === "kol_sampel" && pengiriman.has(m.docId)) {
      sampel.add(m.docId);
      if (m.reason) sebab.add(m.reason);
    }
  }
  return { kolaborasi, sampelIds: [...sampel], sebab: [...sebab] };
}

/** Posting ulang semua jurnal KOL yang tertunda untuk satu kolaborasi (aksi keuangan). */
export async function postingUlangJurnalKol(kolaborasiId: string, postedById: string): Promise<{ ok: boolean; diposting: number; gagal: GagalJurnal[] }> {
  const tertunda = await jurnalKolTertunda(kolaborasiId);
  const hasil = await sinkronJurnalKolAman([kolaborasiId], postedById, { paksa: true });
  let diposting = hasil.reduce((s, r) => s + r.diposting, 0);
  const gagal = hasil.flatMap((r) => r.gagal);
  for (const id of tertunda.sampelIds) {
    const r = await postJurnalSampelKolAman(id, postedById, { paksa: true });
    if (r) {
      diposting += r.diposting;
      gagal.push(...r.gagal);
    }
  }
  return { ok: gagal.length === 0, diposting, gagal };
}
