import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { formatDateOnlyJakarta } from '@/lib/date-only';
import { catatJejak, JEJAK } from '@/lib/receivables/jejak';
import { denganNomorUnik } from '@/lib/receivables/nomor';
import { sinkronJurnalKolAman } from './jurnal-kol';
import { selaraskanTermin } from './termin-writer';
import {
  bolehPindahTahap,
  indeksTahap,
  statusBayarBawaan,
  type JenisKerjaSama,
  type Tahap,
} from './tahap';
import { bolehPindahStatusKonten, type StatusRencanaKonten } from './rencana-konten';

/**
 * Penulis creative marketing.
 *
 * Kolaborasi (tabel `KolBrief`) berjalan lewat 13 tahap + 3 jalur keluar
 * (`tahap.ts`). Memindah tahap TIDAK PERNAH menggerakkan stok: stok sampel
 * bergerak per pengiriman sampel (`KolShipment`), tepat sekali saat
 * pengirimannya berangkat — dicatat di `KolShipment.stockIssuedAt`.
 */

type Klien = Prisma.TransactionClient;
const D = (n: number) => new Prisma.Decimal(n);

export type AlasanGagalKreatif =
  | 'TIDAK_DITEMUKAN'
  | 'NAMA_WAJIB'
  | 'ALASAN_WAJIB'
  | 'STATUS_TIDAK_VALID'
  | 'TANPA_DELIVERABLE'
  | 'BARANG_TIDAK_DITEMUKAN'
  | 'STOK_KURANG'
  | 'QTY_TIDAK_VALID'
  /** KOL diblokir: tidak boleh diajak kolaborasi baru atau dimajukan (keluar jalur tetap boleh). */
  | 'KOL_DIBLOKIR'
  /** Campaign diarsipkan: tidak menerima kolaborasi baru. */
  | 'CAMPAIGN_DIARSIPKAN'
  /** Menukar sebuah ubin dengan dirinya sendiri — tidak ada yang berubah. */
  | 'TIDAK_VALID';

export type HasilKreatif<T = void> =
  | ({ ok: true } & (T extends void ? Record<string, never> : T))
  | { ok: false; alasan: AlasanGagalKreatif; detail?: string };

/* ────────────────────────────── KOL ────────────────────────────── */

/*
 * KOL disimpan oleh `kol-writer.ts` (2026-10-07): akun diubah DI TEMPAT (id
 * tetap, riwayat pengikut tidak hilang) dan setiap jumlah pengikut yang
 * berubah dicatat sebagai baris riwayat. Bentuk lama `simpanKol` tetap ada
 * untuk pemanggil lama.
 */
export { simpanKol, type AkunKol, type IsiKol } from './kol-writer';

/* ──────────────────── KOLABORASI (tabel KolBrief) ──────────────────── */

export type BarisDeliverable = {
  platform: 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'SHOPEE' | 'LAINNYA';
  format: 'FEED' | 'REELS' | 'STORY' | 'VIDEO' | 'LIVE' | 'CAROUSEL';
  qty: number;
  dueDate?: Date | null;
};

/** Rencana sampel (`KolBriefItem`) — rencana saja; stok bergerak per pengiriman. */
export type BarisBarangKirim = { itemId: string; variantSku?: string | null; qty: number };

/**
 * Nomor kolaborasi berikutnya dalam tahun WIB berjalan. Formatnya tetap BRIEF/YYYY/NNNN.
 * Di dalam satu transaksi, pemanggilan berikutnya membaca nomor yang baru dibuat
 * (dipakai `masukkanKeCampaign` yang membuat banyak kolaborasi sekaligus).
 */
export async function nomorBrief(tx: Klien, tahun: string): Promise<string> {
  const depan = `BRIEF/${tahun}/`;
  const terakhir = await tx.kolBrief.findFirst({
    where: { docNo: { startsWith: depan } },
    orderBy: { docNo: 'desc' },
    select: { docNo: true },
  });
  const urutan = terakhir ? Number(terakhir.docNo.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/** Tanggal yang ikut terisi saat sebuah kolaborasi MENCAPAI tahap tertentu. */
export function tanggalTahap(ke: Tahap, sekarang: Date, lama?: { outreachAt: Date | null; dealAt: Date | null; liveAt: Date | null }) {
  const sampai = (t: Tahap) => indeksTahap(ke) >= indeksTahap(t);
  return {
    ...(sampai('DIHUBUNGI') && !lama?.outreachAt ? { outreachAt: sekarang } : {}),
    ...(sampai('DEAL') && !lama?.dealAt ? { dealAt: sekarang } : {}),
    ...(sampai('TAYANG') && !lama?.liveAt ? { liveAt: sekarang } : {}),
  };
}

/**
 * Buat kolaborasi baru.
 *
 * Tahap awal bawaan PROSPEK. Deliverable dan rencana sampel boleh kosong —
 * kolaborasi yang baru diincar memang belum menugaskan apa pun. Brief yang
 * kosong mewarisi brief campaign-nya. Stok TIDAK bergerak di sini.
 */
export async function buatBrief(input: {
  kolId: string;
  campaignId?: string | null;
  tahap?: Tahap;
  jenis?: JenisKerjaSama;
  fee: number;
  commissionPct?: number | null;
  picId?: string | null;
  plannedLiveAt?: Date | null;
  briefText?: string | null;
  doList?: string | null;
  dontList?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  deliverables?: BarisDeliverable[];
  barang?: BarisBarangKirim[];
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string; docNo: string }>> {
  const deliverables = (input.deliverables ?? []).filter((d) => d.qty > 0);
  const barang = (input.barang ?? []).filter((b) => b.itemId && b.qty !== 0);
  if (barang.some((b) => !Number.isInteger(b.qty) || b.qty <= 0)) {
    return { ok: false, alasan: 'QTY_TIDAK_VALID' };
  }
  const tahap = input.tahap ?? 'PROSPEK';
  if (tahap === 'DITOLAK' || tahap === 'GHOSTING' || tahap === 'BATAL') {
    // Kolaborasi tidak lahir di jalur keluar: tidak ada alasan yang bisa dicatat.
    return { ok: false, alasan: 'STATUS_TIDAK_VALID', detail: tahap };
  }
  const fee = Number.isFinite(input.fee) && input.fee > 0 ? input.fee : 0;

  return denganNomorUnik(() =>
    runSerializable(async (tx) => {
      const kol = await tx.kol.findUnique({
        where: { id: input.kolId },
        select: { id: true, name: true, blockedAt: true },
      });
      if (!kol) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      // KOL yang diblokir tidak diajak kerja sama baru — dicek di penulis, bukan
      // hanya di layar, supaya jalur massal dan impor tidak bisa melewatinya.
      if (kol.blockedAt) return { ok: false as const, alasan: 'KOL_DIBLOKIR' as const };

      let briefCampaign: string | null = null;
      if (input.campaignId) {
        const c = await tx.kolCampaign.findUnique({
          where: { id: input.campaignId },
          select: { id: true, brief: true, archivedAt: true },
        });
        if (!c) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const, detail: 'campaign' };
        if (c.archivedAt) return { ok: false as const, alasan: 'CAMPAIGN_DIARSIPKAN' as const };
        briefCampaign = c.brief;
      }

      const namaBarang = new Map<string, string>();
      if (barang.length) {
        const items = await tx.item.findMany({
          where: { id: { in: barang.map((b) => b.itemId) } },
          select: { id: true, nameId: true },
        });
        if (items.length !== new Set(barang.map((b) => b.itemId)).size) {
          return { ok: false as const, alasan: 'BARANG_TIDAK_DITEMUKAN' as const };
        }
        for (const i of items) namaBarang.set(i.id, i.nameId);
      }

      const sekarang = new Date();
      const brief = await tx.kolBrief.create({
        data: {
          docNo: await nomorBrief(tx, formatDateOnlyJakarta(input.startDate ?? sekarang).slice(0, 4)),
          kolId: kol.id,
          campaignId: input.campaignId || null,
          tahap,
          tahapAt: sekarang,
          ...tanggalTahap(tahap, sekarang),
          lastContactAt: indeksTahap(tahap) >= indeksTahap('DIHUBUNGI') ? sekarang : null,
          jenis: input.jenis ?? 'BARTER',
          fee: D(fee),
          commissionPct: input.commissionPct == null ? null : D(input.commissionPct),
          payStatus: statusBayarBawaan(fee),
          picId: input.picId || null,
          plannedLiveAt: input.plannedLiveAt ?? null,
          briefText: input.briefText?.trim() || briefCampaign?.trim() || null,
          doList: input.doList?.trim() || null,
          dontList: input.dontList?.trim() || null,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          createdById: input.olehUserId,
          deliverables: { create: deliverables.map((d) => ({ ...d, dueDate: d.dueDate ?? null })) },
          items: {
            create: barang.map((b) => ({
              itemId: b.itemId,
              itemName: namaBarang.get(b.itemId) ?? '',
              variantSku: b.variantSku?.trim() || null,
              qty: b.qty,
            })),
          },
        },
        select: { id: true, docNo: true },
      });

      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.BRIEF_DIBUAT,
        entityType: 'KolBrief',
        entityId: brief.id,
        changes: { after: { docNo: brief.docNo, tahap, fee } },
        metadata: { kol: kol.name, campaignId: input.campaignId || null, jumlahBarang: barang.length },
      });

      // Kolaborasi berbayar langsung punya termin bawaan (Pelunasan sesudah tayang, PPh dihitung).
      if (fee > 0) {
        const termin = await selaraskanTermin(tx, { kolaborasiId: brief.id, olehUserId: input.olehUserId, sebab: 'Kolaborasi dibuat' });
        if (!termin.ok) throw new Error(`TERMIN_${termin.kode}`);
      }

      return { ok: true as const, id: brief.id, docNo: brief.docNo };
    }),
  );
}

/**
 * Pindahkan kolaborasi ke tahap lain, menurut `bolehPindahTahap`: maju bebas
 * melompat; mundur, keluar jalur, dan "buka lagi" wajib beralasan.
 *
 * Tanggal yang menandai sebuah tahap (outreachAt, dealAt, liveAt) terisi saat
 * tahapnya PERTAMA kali dicapai dan tidak ditimpa sesudahnya. Kontak terakhir
 * ikut diperbarui — memindah tahap berarti ada yang baru saja terjadi dengan
 * KOL-nya — kecuali saat keluar jalur.
 *
 * Stok TIDAK bergerak di sini; stok sampel bergerak lewat pengiriman sampel.
 */
export async function pindahTahapKolaborasi(input: {
  kolaborasiId: string;
  ke: Tahap;
  alasan?: string | null;
  olehUserId: string;
}): Promise<HasilKreatif<{ dari: Tahap; ke: Tahap }>> {
  const hasil = await runSerializable(async (tx) => {
    const c = await tx.kolBrief.findUnique({
      where: { id: input.kolaborasiId },
      select: {
        id: true,
        docNo: true,
        tahap: true,
        outreachAt: true,
        dealAt: true,
        liveAt: true,
        cancelReason: true,
        tahapAt: true,
        kol: { select: { name: true, blockedAt: true } },
      },
    });
    if (!c) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    const dari = c.tahap as Tahap;
    const boleh = bolehPindahTahap(dari, input.ke, input.alasan);
    if (!boleh.boleh) {
      return boleh.sebab === 'ALASAN_WAJIB'
        ? { ok: false as const, alasan: 'ALASAN_WAJIB' as const }
        : { ok: false as const, alasan: 'STATUS_TIDAK_VALID' as const, detail: dari };
    }
    /*
     * KOL yang diblokir: kolaborasinya tidak boleh dimajukan atau dibuka lagi.
     * Keluar jalur dan mundur (membetulkan salah catat) tetap boleh — itulah
     * cara menyelesaikan tugas "KOL diblokir tapi kolaborasinya berjalan".
     */
    if (c.kol.blockedAt && (boleh.jenis === 'MAJU' || boleh.jenis === 'BUKA_LAGI')) {
      return { ok: false as const, alasan: 'KOL_DIBLOKIR' as const };
    }

    const sekarang = new Date();
    const keluar = boleh.jenis === 'KELUAR';
    await tx.kolBrief.update({
      where: { id: c.id },
      data: {
        tahap: input.ke,
        tahapAt: sekarang,
        ...(keluar ? {} : { lastContactAt: sekarang }),
        ...tanggalTahap(input.ke, sekarang, c),
        ...(keluar ? { cancelReason: input.alasan?.trim() || null } : {}),
        ...(boleh.jenis === 'BUKA_LAGI' ? { cancelReason: null } : {}),
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOLABORASI_PINDAH_TAHAP,
      entityType: 'KolBrief',
      entityId: c.id,
      changes: {
        before: { tahap: dari, tahapAt: c.tahapAt.toISOString() },
        after: { tahap: input.ke, tahapAt: sekarang.toISOString() },
      },
      metadata: { docNo: c.docNo, kol: c.kol.name, jenis: boleh.jenis, otomatis: false },
      reason: input.alasan,
    });

    return { ok: true as const, dari, ke: input.ke };
  });
  // Sesudah commit: masuk/keluar TAYANG mengubah fee yang diakui di buku besar (best-effort).
  if (hasil.ok) await sinkronJurnalKolAman([input.kolaborasiId], input.olehUserId);
  return hasil;
}

/* ───────────────────────────── KONTEN ───────────────────────────── */

export type IsiKonten = {
  title: string;
  platform: 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'LAINNYA';
  format: 'FEED' | 'REELS' | 'STORY' | 'VIDEO' | 'LIVE' | 'CAROUSEL';
  status?: 'IDE' | 'DRAFT' | 'REVIEW' | 'DIJADWALKAN' | 'TAYANG' | 'BATAL';
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  postUrl?: string | null;
  imageUrl?: string | null;
  caption?: string | null;
  note?: string | null;
  itemId?: string | null;
  assigneeId?: string | null;
  briefId?: string | null;
};

/**
 * Ganti HANYA gambar sebuah konten.
 *
 * Ada terpisah dari `simpanKonten` karena menyusun feed adalah pekerjaan
 * menempel gambar berkali-kali sampai komposisinya enak. Memaksa jalur itu
 * lewat penyimpanan penuh menuntut pemanggilnya mengirim ulang SELURUH isi —
 * dan yang lupa mengirim satu kolom akan menghapusnya tanpa ada yang meminta.
 */
export async function gantiGambarKonten(input: {
  id: string;
  imageUrl: string | null;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  return runSerializable(async (tx) => {
    const lama = await tx.contentPlan.findUnique({
      where: { id: input.id },
      select: { id: true, title: true, imageUrl: true },
    });
    if (!lama) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    await tx.contentPlan.update({
      where: { id: input.id },
      data: { imageUrl: input.imageUrl },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTEN_DIUBAH,
      entityType: 'ContentPlan',
      entityId: input.id,
      changes: { before: { imageUrl: lama.imageUrl }, after: { imageUrl: input.imageUrl } },
      metadata: { title: lama.title },
    });

    return { ok: true as const, id: input.id };
  });
}

/**
 * Hapus satu rencana konten.
 *
 * BENAR-BENAR dihapus, tidak diarsipkan. Berbeda dari klaim pembayaran atau
 * nota retur yang barisnya dipertahankan karena menyangkut uang dan stok:
 * rencana konten yang dibatalkan tidak pernah menggerakkan apa pun. Yang
 * membatalkan tapi ingin jejaknya tinggal memindahkannya ke status `BATAL`.
 *
 * Fotonya TIDAK ikut dihapus di sini. Ia jadi yatim dan disapu penyapu foto
 * beberapa jam kemudian — yang benar, karena foto yang sama bisa saja sedang
 * dipakai konten lain, dan menghapusnya dari sini akan mengosongkan ubin orang
 * lain tanpa ada yang meminta.
 */
export async function hapusKonten(input: {
  id: string;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  return runSerializable(async (tx) => {
    const lama = await tx.contentPlan.findUnique({
      where: { id: input.id },
      select: { id: true, title: true, status: true, scheduledAt: true, imageUrl: true },
    });
    if (!lama) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    await tx.contentPlan.delete({ where: { id: input.id } });

    /*
     * Jejaknya ditulis SESUDAH penghapusan tapi di dalam transaksi yang sama:
     * kalau penghapusannya gagal, jejaknya ikut batal, jadi tidak pernah ada
     * catatan penghapusan atas baris yang masih hidup.
     */
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTEN_DIHAPUS,
      entityType: 'ContentPlan',
      entityId: input.id,
      changes: { before: { title: lama.title, status: lama.status }, after: null },
      metadata: {
        title: lama.title,
        scheduledAt: lama.scheduledAt?.toISOString() ?? null,
        imageUrl: lama.imageUrl,
      },
    });

    return { ok: true as const, id: input.id };
  });
}

/**
 * Hapus beberapa konten sekaligus.
 *
 * Menyusun feed berarti membuang beberapa percobaan yang tidak jadi dipakai,
 * dan menghapusnya satu per satu — konfirmasi, tunggu, ulangi — membuat
 * pekerjaan yang seharusnya satu gerakan jadi sepuluh.
 *
 * SATU transaksi. Kalau salah satu gagal, tidak ada yang terhapus: setengah
 * terhapus adalah keadaan yang tidak bisa dijelaskan siapa pun, dan orang tidak
 * tahu harus mengulang yang mana.
 */
export async function hapusBanyakKonten(input: {
  ids: string[];
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string; dihapus: number }>> {
  const ids = [...new Set(input.ids)].filter(Boolean);
  if (ids.length === 0) return { ok: false, alasan: 'TIDAK_VALID' };

  return runSerializable(async (tx) => {
    const lama = await tx.contentPlan.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, status: true, scheduledAt: true, imageUrl: true },
    });
    if (lama.length === 0) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    await tx.contentPlan.deleteMany({ where: { id: { in: lama.map((k) => k.id) } } });

    /*
     * Satu baris jejak per konten, bukan satu untuk seluruh kumpulan. Barisnya
     * benar-benar hilang, jadi jejak adalah satu-satunya tempat isinya masih
     * bisa dibaca — dan mencarinya nanti dilakukan per konten, bukan per
     * penghapusan massal yang nomornya tidak diingat siapa pun.
     */
    for (const k of lama) {
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KONTEN_DIHAPUS,
        entityType: 'ContentPlan',
        entityId: k.id,
        changes: { before: { title: k.title, status: k.status }, after: null },
        metadata: {
          title: k.title,
          scheduledAt: k.scheduledAt?.toISOString() ?? null,
          imageUrl: k.imageUrl,
          sekaligus: lama.length,
        },
      });
    }

    return { ok: true as const, id: lama[0].id, dihapus: lama.length };
  });
}

/**
 * Tukar posisi dua ubin di grid feed.
 *
 * Urutan grid MURNI berasal dari `scheduledAt` — itu bukan kebetulan, itu yang
 * membuat grid ini kalender dan bukan papan gambar. Maka menukar posisi berarti
 * menukar TANGGALNYA, dan dua postingan benar-benar berpindah jadwal.
 *
 * Sempat saya pertimbangkan kolom urutan tersendiri supaya posisi bisa digeser
 * tanpa menyentuh jadwal. Ditolak: begitu urutan grid dan urutan tanggal boleh
 * berbeda, pratinjau feednya berhenti memberitahu kapan sesuatu tayang — dan
 * itulah satu-satunya hal yang tidak bisa dilakukan spreadsheet yang mereka
 * pakai sekarang.
 *
 * Menukar, bukan menyisipkan. Menyisipkan menggeser tanggal SEMUA postingan di
 * bawahnya; satu seretan yang salah akan menjadwal ulang sebulan penuh.
 */
export async function tukarJadwalKonten(input: {
  idA: string;
  idB: string;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  if (input.idA === input.idB) return { ok: false, alasan: 'TIDAK_VALID' };

  return runSerializable(async (tx) => {
    const dua = await tx.contentPlan.findMany({
      where: { id: { in: [input.idA, input.idB] } },
      select: { id: true, title: true, scheduledAt: true },
    });
    if (dua.length !== 2) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    const a = dua.find((x) => x.id === input.idA)!;
    const b = dua.find((x) => x.id === input.idB)!;

    await tx.contentPlan.update({ where: { id: a.id }, data: { scheduledAt: b.scheduledAt } });
    await tx.contentPlan.update({ where: { id: b.id }, data: { scheduledAt: a.scheduledAt } });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTEN_DITUKAR,
      entityType: 'ContentPlan',
      entityId: a.id,
      changes: {
        before: { scheduledAt: a.scheduledAt?.toISOString() ?? null },
        after: { scheduledAt: b.scheduledAt?.toISOString() ?? null },
      },
      metadata: {
        // Pasangannya ikut dicatat: sebuah penukaran yang hanya tercatat di satu
        // sisi tidak bisa ditelusuri balik dari sisi yang lain.
        pasanganId: b.id,
        pasanganJudul: b.title,
        judul: a.title,
      },
    });

    return { ok: true as const, id: a.id };
  });
}

export async function simpanKonten(input: {
  id?: string | null;
  isi: IsiKonten;
  /** Wajib bila status dimundurkan; ikut tercatat di jejak bila status berubah. */
  alasan?: string | null;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  const judul = input.isi.title?.trim();
  if (!judul) return { ok: false, alasan: 'NAMA_WAJIB' };

  /*
   * Kolom yang TIDAK dikirim (undefined) tidak disentuh saat mengubah; null
   * yang dikirim dengan sengaja tetap mengosongkan. Dulu setiap simpan menulis
   * null ke semua kolom opsional, jadi dialog ubah — yang tidak membawa link
   * posting, tanggal tayang, catatan, barang, dan penanggung jawab — diam-diam
   * menghapus isinya, dan status kembali ke IDE.
   */
  const teks = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  const ruj = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
  const isian = {
    title: judul,
    platform: input.isi.platform,
    format: input.isi.format,
    status: input.isi.status,
    scheduledAt: input.isi.scheduledAt,
    publishedAt: input.isi.publishedAt,
    postUrl: teks(input.isi.postUrl),
    imageUrl: teks(input.isi.imageUrl),
    caption: teks(input.isi.caption),
    note: teks(input.isi.note),
    itemId: ruj(input.isi.itemId),
    assigneeId: ruj(input.isi.assigneeId),
    briefId: ruj(input.isi.briefId),
  };

  return runSerializable(async (tx) => {
    if (input.id) {
      const lama = await tx.contentPlan.findUnique({
        where: { id: input.id },
        select: { id: true, title: true, status: true, scheduledAt: true },
      });
      if (!lama) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      /*
       * Status mengikuti aturan perpindahan (`rencana-konten.ts`, bug F):
       * maju boleh melompat, mundur wajib beralasan dan alasannya masuk jejak.
       * Dibaca di dalam transaksi supaya dua dialog yang terbuka bersamaan
       * tidak bisa memundurkan status tanpa alasan.
       */
      const pindahStatus = isian.status !== undefined && isian.status !== lama.status;
      if (pindahStatus) {
        const cek = bolehPindahStatusKonten(lama.status as StatusRencanaKonten, isian.status!, input.alasan);
        if (!cek.boleh) {
          return { ok: false as const, alasan: cek.sebab === 'ALASAN_WAJIB' ? ('ALASAN_WAJIB' as const) : ('STATUS_TIDAK_VALID' as const) };
        }
      }
      const data = Object.fromEntries(Object.entries(isian).filter(([, v]) => v !== undefined)) as Partial<typeof isian>;
      await tx.contentPlan.update({ where: { id: lama.id }, data });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KONTEN_DIUBAH,
        entityType: 'ContentPlan',
        entityId: lama.id,
        changes: {
          before: { title: lama.title, status: lama.status, scheduledAt: lama.scheduledAt },
          after: {
            title: judul,
            status: data.status ?? lama.status,
            scheduledAt: data.scheduledAt === undefined ? lama.scheduledAt : data.scheduledAt,
          },
        },
        reason: pindahStatus ? input.alasan?.trim() || null : null,
      });
      return { ok: true as const, id: lama.id };
    }

    const data = {
      ...isian,
      status: isian.status ?? 'IDE',
      scheduledAt: isian.scheduledAt ?? null,
      publishedAt: isian.publishedAt ?? null,
      postUrl: isian.postUrl ?? null,
      imageUrl: isian.imageUrl ?? null,
      caption: isian.caption ?? null,
      note: isian.note ?? null,
      itemId: isian.itemId ?? null,
      assigneeId: isian.assigneeId ?? null,
      briefId: isian.briefId ?? null,
    };
    const dibuat = await tx.contentPlan.create({
      data: { ...data, createdById: input.olehUserId },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTEN_DIBUAT,
      entityType: 'ContentPlan',
      entityId: dibuat.id,
      changes: { after: { title: judul, status: data.status } },
    });
    return { ok: true as const, id: dibuat.id };
  });
}
