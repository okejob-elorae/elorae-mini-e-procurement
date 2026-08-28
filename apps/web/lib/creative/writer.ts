import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { generateDocNumber } from '@/lib/docNumber';
import { catatJejak, JEJAK } from '@/lib/receivables/jejak';
import { denganNomorUnik } from '@/lib/receivables/nomor';
import { bolehPindahBrief, stokKeluarSaat, type StatusBrief } from './aturan';

/**
 * Penulis creative marketing.
 *
 * Di sinilah dua aturan rancangannya benar-benar dipaksa: fee tidak pernah jadi
 * beban sebelum kontennya tayang, dan stok bergerak TEPAT SEKALI — pada
 * perpindahan draft → dikirim, dicatat sebagai `stockIssuedAt`.
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
  | 'QTY_TIDAK_VALID';

export type HasilKreatif<T = void> =
  | ({ ok: true } & (T extends void ? Record<string, never> : T))
  | { ok: false; alasan: AlasanGagalKreatif; detail?: string };

/* ────────────────────────────── KOL ────────────────────────────── */

export type AkunKol = { platform: 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'LAINNYA'; handle: string; followers: number; url?: string | null };

export type IsiKol = {
  name: string;
  niche?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  rateCard?: number | null;
  rateNote?: string | null;
  note?: string | null;
  isActive?: boolean;
  akun: AkunKol[];
};

/**
 * Simpan KOL beserta akun-akunnya.
 *
 * Akunnya ditulis ulang seluruhnya, bukan ditambal per baris: daftar akun
 * pendek dan seluruhnya ada di formulir, jadi menyandingkan yang lama dengan
 * yang baru hanya menambah cara untuk salah. Tier TIDAK disimpan — ia dihitung
 * saat dibaca.
 */
export async function simpanKol(input: {
  id?: string | null;
  isi: IsiKol;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  const nama = input.isi.name?.trim();
  if (!nama) return { ok: false, alasan: 'NAMA_WAJIB' };

  const akun = input.isi.akun
    .filter((a) => a.handle.trim())
    .map((a) => ({
      platform: a.platform,
      // Handle diseragamkan tanpa @ supaya "@toko" dan "toko" tidak jadi dua akun.
      handle: a.handle.trim().replace(/^@/, ''),
      followers: Math.max(0, Math.trunc(a.followers || 0)),
      url: a.url?.trim() || null,
    }));

  return runSerializable(async (tx) => {
    const data = {
      name: nama,
      niche: input.isi.niche?.trim() || null,
      city: input.isi.city?.trim() || null,
      phone: input.isi.phone?.trim() || null,
      email: input.isi.email?.trim() || null,
      rateCard: input.isi.rateCard == null ? null : D(input.isi.rateCard),
      rateNote: input.isi.rateNote?.trim() || null,
      note: input.isi.note?.trim() || null,
      isActive: input.isi.isActive ?? true,
    };

    if (input.id) {
      const lama = await tx.kol.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, isActive: true },
      });
      if (!lama) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

      await tx.kol.update({ where: { id: lama.id }, data });
      await tx.kolAccount.deleteMany({ where: { kolId: lama.id } });
      if (akun.length) {
        await tx.kolAccount.createMany({ data: akun.map((a) => ({ ...a, kolId: lama.id })) });
      }
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KOL_DIUBAH,
        entityType: 'Kol',
        entityId: lama.id,
        changes: { before: { name: lama.name, isActive: lama.isActive }, after: { name: nama, isActive: data.isActive } },
        metadata: { jumlahAkun: akun.length },
      });
      return { ok: true as const, id: lama.id };
    }

    const dibuat = await tx.kol.create({
      data: { ...data, createdById: input.olehUserId, accounts: { create: akun } },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOL_DIBUAT,
      entityType: 'Kol',
      entityId: dibuat.id,
      changes: { after: { name: nama } },
      metadata: { jumlahAkun: akun.length },
    });
    return { ok: true as const, id: dibuat.id };
  });
}

/* ───────────────────────────── BRIEF ───────────────────────────── */

export type BarisDeliverable = {
  platform: 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'LAINNYA';
  format: 'FEED' | 'REELS' | 'STORY' | 'VIDEO' | 'LIVE' | 'CAROUSEL';
  qty: number;
  dueDate?: Date | null;
};

export type BarisBarangKirim = { itemId: string; variantSku?: string | null; qty: number };

/** Nomor brief berikutnya dalam tahun berjalan. */
async function nomorBrief(tx: Klien, tahun: number): Promise<string> {
  const depan = `BRIEF/${tahun}/`;
  const terakhir = await tx.kolBrief.findFirst({
    where: { docNo: { startsWith: depan } },
    orderBy: { docNo: 'desc' },
    select: { docNo: true },
  });
  const urutan = terakhir ? Number(terakhir.docNo.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

export async function buatBrief(input: {
  kolId: string;
  campaign: string;
  fee: number;
  briefText?: string | null;
  doList?: string | null;
  dontList?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  deliverables: BarisDeliverable[];
  barang?: BarisBarangKirim[];
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string; docNo: string }>> {
  if (!input.campaign?.trim()) return { ok: false, alasan: 'NAMA_WAJIB' };

  const deliverables = input.deliverables.filter((d) => d.qty > 0);
  // Brief tanpa deliverable tidak menugaskan apa pun; ia cuma catatan.
  if (deliverables.length === 0) return { ok: false, alasan: 'TANPA_DELIVERABLE' };

  const barang = (input.barang ?? []).filter((b) => b.itemId && b.qty > 0);
  if (barang.some((b) => !Number.isInteger(b.qty) || b.qty <= 0)) {
    return { ok: false, alasan: 'QTY_TIDAK_VALID' };
  }

  return denganNomorUnik(() =>
    runSerializable(async (tx) => {
      const kol = await tx.kol.findUnique({ where: { id: input.kolId }, select: { id: true, name: true } });
      if (!kol) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

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

      const brief = await tx.kolBrief.create({
        data: {
          docNo: await nomorBrief(tx, (input.startDate ?? new Date()).getFullYear()),
          kolId: kol.id,
          campaign: input.campaign.trim(),
          status: 'DRAFT',
          fee: D(input.fee || 0),
          briefText: input.briefText?.trim() || null,
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

      /*
       * Stok TIDAK bergerak di sini. Brief lahir sebagai DRAFT, dan draft masih
       * boleh berubah isinya — barangnya baru berangkat saat briefnya dikirim.
       */
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.BRIEF_DIBUAT,
        entityType: 'KolBrief',
        entityId: brief.id,
        changes: { after: { docNo: brief.docNo, status: 'DRAFT', fee: input.fee } },
        metadata: { kol: kol.name, campaign: input.campaign.trim(), jumlahBarang: barang.length },
      });

      return { ok: true as const, id: brief.id, docNo: brief.docNo };
    }),
  );
}

/**
 * Cari baris persediaan sebuah barang.
 *
 * Toleran terhadap `variantSku` null ATAU string kosong — pelajaran yang sudah
 * mahal di modul field sales: barang tanpa varian menulis `null` di satu jalur
 * dan `""` di jalur lain, dan pencarian yang ketat diam-diam tidak menemukan
 * apa-apa lalu melaporkan stok nol.
 */
async function cariPersediaan(tx: Klien, itemId: string, variantSku: string | null) {
  const kosong = !variantSku || variantSku.trim() === '';
  return tx.inventoryValue.findFirst({
    where: {
      itemId,
      ...(kosong ? { OR: [{ variantSku: null }, { variantSku: '' }] } : { variantSku }),
    },
    select: { id: true, qtyOnHand: true, reservedQty: true, avgCost: true },
  });
}

/**
 * Pindahkan brief ke status berikutnya.
 *
 * Perpindahan draft → dikirim adalah satu-satunya yang menggerakkan stok, dan
 * ia menstempel `stockIssuedAt` supaya yang benar-benar terjadi TERCATAT, bukan
 * disimpulkan dari status. Bedanya nyata: brief yang dibatalkan setelah
 * dikirim barangnya sudah di tangan KOL, dan tidak ada status yang bisa
 * menceritakan itu sendirian.
 */
export async function pindahStatusBrief(input: {
  briefId: string;
  ke: StatusBrief;
  alasan?: string | null;
  olehUserId: string;
}): Promise<HasilKreatif<{ stokKeluar: number }>> {
  if (input.ke === 'BATAL' && !input.alasan?.trim()) {
    return { ok: false, alasan: 'ALASAN_WAJIB' };
  }

  return runSerializable(async (tx) => {
    const brief = await tx.kolBrief.findUnique({
      where: { id: input.briefId },
      select: {
        id: true,
        docNo: true,
        status: true,
        stockIssuedAt: true,
        kol: { select: { name: true } },
        items: { select: { itemId: true, itemName: true, variantSku: true, qty: true } },
      },
    });
    if (!brief) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    const dari = brief.status as StatusBrief;
    if (!bolehPindahBrief(dari, input.ke)) {
      return { ok: false as const, alasan: 'STATUS_TIDAK_VALID' as const, detail: dari };
    }

    let stokKeluar = 0;
    if (stokKeluarSaat(dari, input.ke) && brief.stockIssuedAt === null) {
      for (const b of brief.items) {
        const inv = await cariPersediaan(tx, b.itemId, b.variantSku);
        if (!inv) {
          return { ok: false as const, alasan: 'BARANG_TIDAK_DITEMUKAN' as const, detail: b.itemName };
        }
        const ada = inv.qtyOnHand.toNumber();
        // Seeding TIDAK boleh menembus stok jadi negatif: barang yang tidak ada
        // tidak bisa dikirim, dan gudang minus tidak pernah bisa dijelaskan.
        if (ada < b.qty) {
          return { ok: false as const, alasan: 'STOK_KURANG' as const, detail: b.itemName };
        }
        const avg = inv.avgCost.toNumber();
        const baru = ada - b.qty;
        await tx.inventoryValue.update({
          where: { id: inv.id },
          data: { qtyOnHand: baru, totalValue: baru * avg },
        });
        await tx.stockAdjustment.create({
          data: {
            /*
             * Nomor ADJ dari generator bersama, bukan dirakit dari nomor brief.
             * Rakitan `${docNo}/${itemId}` bentrok begitu satu barang muncul dua
             * baris di brief yang sama — dan kolomnya `@unique`, jadi yang kalah
             * membatalkan seluruh pengiriman.
             */
            docNumber: await generateDocNumber('ADJ', tx),
            itemId: b.itemId,
            type: 'NEGATIVE',
            qtyChange: -b.qty,
            reason: `Seeding KOL ${brief.docNo} → ${brief.kol.name}`,
            prevQty: ada,
            newQty: baru,
            prevAvgCost: avg,
            newAvgCost: avg,
            createdById: input.olehUserId,
            source: 'KOL_SEEDING',
          },
        });
        stokKeluar += b.qty;
      }
    }

    await tx.kolBrief.update({
      where: { id: brief.id },
      data: {
        status: input.ke,
        ...(input.ke === 'DIKIRIM' ? { sentAt: new Date() } : {}),
        ...(input.ke === 'TAYANG' ? { liveAt: new Date() } : {}),
        ...(input.ke === 'BATAL' ? { cancelReason: input.alasan?.trim() || null } : {}),
        ...(stokKeluar > 0 ? { stockIssuedAt: new Date() } : {}),
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: input.ke === 'BATAL' ? JEJAK.BRIEF_DIBATALKAN : input.ke === 'DIKIRIM' ? JEJAK.BRIEF_DIKIRIM : JEJAK.BRIEF_PINDAH_STATUS,
      entityType: 'KolBrief',
      entityId: brief.id,
      changes: { before: { status: dari }, after: { status: input.ke } },
      metadata: {
        docNo: brief.docNo,
        kol: brief.kol.name,
        stokKeluar,
        // Dicatat supaya pembatalan setelah pengiriman bisa dibaca sebagai
        // kehilangan barang, bukan sekadar brief yang batal.
        barangSudahBerangkat: brief.stockIssuedAt !== null || stokKeluar > 0,
      },
      reason: input.alasan,
    });

    return { ok: true as const, stokKeluar };
  });
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

export async function simpanKonten(input: {
  id?: string | null;
  isi: IsiKonten;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  const judul = input.isi.title?.trim();
  if (!judul) return { ok: false, alasan: 'NAMA_WAJIB' };

  return runSerializable(async (tx) => {
    const data = {
      title: judul,
      platform: input.isi.platform,
      format: input.isi.format,
      status: input.isi.status ?? 'IDE',
      scheduledAt: input.isi.scheduledAt ?? null,
      publishedAt: input.isi.publishedAt ?? null,
      postUrl: input.isi.postUrl?.trim() || null,
      imageUrl: input.isi.imageUrl?.trim() || null,
      caption: input.isi.caption?.trim() || null,
      note: input.isi.note?.trim() || null,
      itemId: input.isi.itemId || null,
      assigneeId: input.isi.assigneeId || null,
      briefId: input.isi.briefId || null,
    };

    if (input.id) {
      const lama = await tx.contentPlan.findUnique({
        where: { id: input.id },
        select: { id: true, title: true, status: true, scheduledAt: true },
      });
      if (!lama) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      await tx.contentPlan.update({ where: { id: lama.id }, data });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KONTEN_DIUBAH,
        entityType: 'ContentPlan',
        entityId: lama.id,
        changes: {
          before: { title: lama.title, status: lama.status, scheduledAt: lama.scheduledAt },
          after: { title: judul, status: data.status, scheduledAt: data.scheduledAt },
        },
      });
      return { ok: true as const, id: lama.id };
    }

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
