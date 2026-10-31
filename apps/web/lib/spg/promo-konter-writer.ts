import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import {
  ENTITAS_PROMO_KONTER,
  JEJAK_PROMO_KONTER,
  keRentangWib,
  periksaIsianPromoKonter,
  rapikanIsianPromoKonter,
  type IsianPromoKonter,
  type MasalahIsianPromoKonter,
} from "./promo-konter-kantor";

/**
 * Penulis promo konter SPG (kantor). Terpisah dari promo pesanan toko
 * (`lib/promos/*`) — itu harga Elorae ke toko, ini harga toko ke pembeli.
 *
 * Setiap perubahan meninggalkan jejak `AuditLog` DI DALAM transaksinya, dengan
 * pasangan sebelum/sesudah: barisnya hanya menyimpan keadaan terakhir, jadi
 * definisi promo yang sudah diganti hanya hidup di jejaknya — padahal nota lama
 * memakai definisi itu.
 *
 * Promo yang sudah pernah dipakai di nota tidak bisa dihapus (`SUDAH_DIPAKAI`);
 * kantor mematikannya. Nota menyimpan nama promonya sendiri, jadi menghapus
 * promo tidak merusak nota, tapi menghapus satu-satunya definisinya.
 */

type Klien = Prisma.TransactionClient;

export type HasilSimpanPromoKonter =
  | { ok: true; id: string }
  | { ok: false; code: "TIDAK_VALID"; masalah: MasalahIsianPromoKonter[] }
  | { ok: false; code: "TIDAK_ADA" };

export type HasilAturAktif = { ok: true; berubah: boolean } | { ok: false; code: "TIDAK_ADA" };

export type HasilHapus = { ok: true } | { ok: false; code: "TIDAK_ADA" } | { ok: false; code: "SUDAH_DIPAKAI"; nota: number };

const pilihPromo = {
  id: true,
  name: true,
  type: true,
  value: true,
  buyQty: true,
  freeQty: true,
  minSubtotal: true,
  allItems: true,
  allStores: true,
  startsAt: true,
  endsAt: true,
  priority: true,
  isActive: true,
  note: true,
  storeSharePercent: true,
  memberOnly: true,
  targets: { select: { kind: true, refId: true, qty: true } },
} satisfies Prisma.CounterPromoSelect;

type BarisPromo = Prisma.CounterPromoGetPayload<{ select: typeof pilihPromo }>;

/**
 * Bentuk jejak: angka biasa, tanggal ISO, sasaran terurut — supaya sebelum/sesudah
 * bisa dibandingkan mata. Isi paket ikut dengan jumlahnya (`komponen`, kosong
 * untuk jenis lain): tanpa itu "2 kaos + 1 celana" yang diubah jadi "1 kaos + 1
 * celana" tidak meninggalkan jejak apa pun, karena daftar barangnya sama.
 */
function potret(p: BarisPromo) {
  const ref = (kind: string) =>
    p.targets
      .filter((t) => t.kind === kind)
      .map((t) => t.refId)
      .sort();
  const komponen =
    p.type === "PAKET"
      ? p.targets
          .filter((t) => t.kind === "ITEM" || t.kind === "CATEGORY")
          .map((t) => ({ jenis: t.kind, refId: t.refId, qty: t.qty ?? 1 }))
          .sort((a, b) => (a.jenis === b.jenis ? (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0) : a.jenis < b.jenis ? -1 : 1))
      : [];
  return {
    name: p.name,
    type: p.type,
    value: p.value === null ? null : Number(p.value),
    buyQty: p.buyQty,
    freeQty: p.freeQty,
    minSubtotal: p.minSubtotal === null ? null : Number(p.minSubtotal),
    allItems: p.allItems,
    itemIds: ref("ITEM"),
    categoryIds: ref("CATEGORY"),
    allStores: p.allStores,
    storeIds: ref("STORE"),
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
    priority: p.priority,
    isActive: p.isActive,
    note: p.note,
    storeSharePercent: Number(p.storeSharePercent),
    memberOnly: p.memberOnly,
    komponen,
  };
}

/**
 * Baris `CounterPromoTarget` dari isian yang sudah dirapikan. PAKET menulis
 * komponennya (dengan `qty`) sebagai sasaran ITEM/CATEGORY — `itemIds`/
 * `categoryIds`-nya diturunkan dari komponen yang sama, jadi tidak ditulis lagi
 * (satu barang satu baris: kunci unik promo × jenis × id).
 */
const sasaran = (i: IsianPromoKonter) => [
  ...(i.type === "PAKET"
    ? i.komponen.map((k) => ({ kind: k.jenis, refId: k.refId, qty: k.qty }))
    : [
        ...i.itemIds.map((refId) => ({ kind: "ITEM", refId })),
        ...i.categoryIds.map((refId) => ({ kind: "CATEGORY", refId })),
      ]),
  ...i.storeIds.map((refId) => ({ kind: "STORE", refId })),
];

/**
 * Sasaran yang disebut harus ada: barang jadi, kategori, dan toko. Yang nonaktif boleh (promo lama yang diubah).
 * Komponen paket ikut terperiksa: `rapikanIsianPromoKonter` menurunkan `itemIds`/`categoryIds` dari komponennya.
 */
async function periksaRujukan(klien: Klien | typeof prisma, i: IsianPromoKonter): Promise<MasalahIsianPromoKonter[]> {
  const [barang, kategori, toko] = await Promise.all([
    i.itemIds.length ? klien.item.count({ where: { id: { in: i.itemIds }, type: "FINISHED_GOOD" } }) : 0,
    i.categoryIds.length ? klien.itemCategory.count({ where: { id: { in: i.categoryIds } } }) : 0,
    i.storeIds.length ? klien.store.count({ where: { id: { in: i.storeIds } } }) : 0,
  ]);
  const masalah: MasalahIsianPromoKonter[] = [];
  if (barang !== i.itemIds.length) masalah.push("BARANG_TIDAK_DIKENAL");
  if (kategori !== i.categoryIds.length) masalah.push("KATEGORI_TIDAK_DIKENAL");
  if (toko !== i.storeIds.length) masalah.push("TOKO_TIDAK_DIKENAL");
  return masalah;
}

/**
 * Buat (tanpa `id`) atau ubah promo konter. Tanggal disimpan sebagai awal hari
 * WIB (mulai) dan akhir hari WIB (berakhir). `aktif` hanya dipakai saat membuat;
 * menyalakan/mematikan promo yang ada lewat `aturAktifPromoKonter`, supaya
 * jejaknya tercatat sebagai tindakannya sendiri.
 *
 * Tanggal mulai kosong = mulai SAAT DISIMPAN, bukan "sejak dulu": nota dari
 * antrean HP dinilai pada waktu jualnya (sampai 14 hari ke belakang), dan
 * promo yang belum ada saat barang dijual tidak boleh ikut memotong nota yang
 * pembelinya sudah membayar harga layar.
 */
export async function simpanPromoKonter(input: {
  id?: string | null;
  isian: IsianPromoKonter;
  aktif?: boolean;
  userId: string;
  sekarang?: Date;
}): Promise<HasilSimpanPromoKonter> {
  const isian = rapikanIsianPromoKonter(input.isian);
  const masalah = periksaIsianPromoKonter(isian);
  if (masalah.length > 0) return { ok: false, code: "TIDAK_VALID", masalah };
  const rentang = keRentangWib(isian.dari, isian.sampai)!;
  const ubah = input.id !== undefined && input.id !== null;
  if (ubah && (typeof input.id !== "string" || input.id.length === 0)) return { ok: false, code: "TIDAK_ADA" };

  const data = {
    name: isian.name,
    type: isian.type,
    value: isian.value,
    buyQty: isian.buyQty,
    freeQty: isian.freeQty,
    minSubtotal: isian.minSubtotal,
    allItems: isian.allItems,
    allStores: isian.allStores,
    startsAt: rentang.startsAt ?? input.sekarang ?? new Date(),
    endsAt: rentang.endsAt,
    priority: isian.priority,
    note: isian.note || null,
    storeSharePercent: isian.storeSharePercent,
    memberOnly: isian.memberOnly,
  };

  return runSerializable(async (tx): Promise<HasilSimpanPromoKonter> => {
    const rujukan = await periksaRujukan(tx, isian);
    if (rujukan.length > 0) return { ok: false, code: "TIDAK_VALID", masalah: rujukan };

    if (!ubah) {
      const baru = await tx.counterPromo.create({
        data: { ...data, isActive: input.aktif !== false, createdById: input.userId, targets: { create: sasaran(isian) } },
        select: pilihPromo,
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: JEJAK_PROMO_KONTER.DIBUAT,
          entityType: ENTITAS_PROMO_KONTER,
          entityId: baru.id,
          changes: { before: null, after: potret(baru) } as Prisma.InputJsonValue,
        },
      });
      return { ok: true, id: baru.id };
    }

    const lama = await tx.counterPromo.findUnique({ where: { id: input.id! }, select: pilihPromo });
    if (!lama) return { ok: false, code: "TIDAK_ADA" };
    // Sasaran diganti utuh. Disaring lewat id baris yang baru saja dibaca, bukan lewat isian.
    await tx.counterPromoTarget.deleteMany({ where: { promoId: lama.id } });
    const baru = await tx.counterPromo.update({
      where: { id: lama.id },
      data: { ...data, targets: { create: sasaran(isian) } },
      select: pilihPromo,
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: JEJAK_PROMO_KONTER.DIUBAH,
        entityType: ENTITAS_PROMO_KONTER,
        entityId: lama.id,
        changes: { before: potret(lama), after: potret(baru) } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, id: lama.id };
  });
}

/** Nyalakan/matikan. Menyetel ke keadaan yang sudah berlaku tidak menulis jejak. */
export async function aturAktifPromoKonter(input: { id: string; aktif: boolean; userId: string }): Promise<HasilAturAktif> {
  if (typeof input.id !== "string" || input.id.length === 0) return { ok: false, code: "TIDAK_ADA" };
  return runSerializable(async (tx): Promise<HasilAturAktif> => {
    const lama = await tx.counterPromo.findUnique({ where: { id: input.id }, select: { id: true, isActive: true } });
    if (!lama) return { ok: false, code: "TIDAK_ADA" };
    if (lama.isActive === input.aktif) return { ok: true, berubah: false };
    await tx.counterPromo.update({ where: { id: lama.id }, data: { isActive: input.aktif } });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.aktif ? JEJAK_PROMO_KONTER.DINYALAKAN : JEJAK_PROMO_KONTER.DIMATIKAN,
        entityType: ENTITAS_PROMO_KONTER,
        entityId: lama.id,
        changes: { before: { isActive: lama.isActive }, after: { isActive: input.aktif } } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, berubah: true };
  });
}

/**
 * Berapa nota yang memakai promo ini. Baris nota menyimpan promo dengan
 * potongan terbesar di `counterPromoId`; promo kedua di baris yang sama hanya
 * tertulis di `promoName` ("A + B"), jadi nama ikut dicocokkan per segmen.
 * Kecocokan nama yang keliru (dua promo bernama sama) hanya membuat hapus
 * ditolak — arah yang aman.
 */
export async function hitungNotaPemakai(klien: Klien | typeof prisma, promo: { id: string; name: string }): Promise<number> {
  const pemisah = " + ";
  const [baris, nota] = await Promise.all([
    klien.spgSaleLine.findMany({
      where: {
        OR: [
          { counterPromoId: promo.id },
          { promoName: promo.name },
          { promoName: { startsWith: `${promo.name}${pemisah}` } },
          { promoName: { endsWith: `${pemisah}${promo.name}` } },
          { promoName: { contains: `${pemisah}${promo.name}${pemisah}` } },
        ],
      },
      select: { spgSaleId: true },
      distinct: ["spgSaleId"],
    }),
    klien.spgSale.findMany({ where: { orderPromoId: promo.id }, select: { id: true } }),
  ]);
  return new Set([...baris.map((b) => b.spgSaleId), ...nota.map((n) => n.id)]).size;
}

/**
 * Hapus promo yang BELUM pernah dipakai. Serializable: penulis nota SPG juga
 * serializable dan membaca promo yang sama, jadi nota yang memakai promo ini
 * bersamaan dengan penghapusannya membuat salah satunya diulang, bukan lolos.
 */
export async function hapusPromoKonter(input: { id: string; userId: string }): Promise<HasilHapus> {
  if (typeof input.id !== "string" || input.id.length === 0) return { ok: false, code: "TIDAK_ADA" };
  return runSerializable(async (tx): Promise<HasilHapus> => {
    const lama = await tx.counterPromo.findUnique({ where: { id: input.id }, select: pilihPromo });
    if (!lama) return { ok: false, code: "TIDAK_ADA" };
    const nota = await hitungNotaPemakai(tx, lama);
    if (nota > 0) return { ok: false, code: "SUDAH_DIPAKAI", nota };
    // Sasaran dihapus terang-terangan (relationMode prisma: tidak ada kunci asing di basis data).
    await tx.counterPromoTarget.deleteMany({ where: { promoId: lama.id } });
    const terhapus = await tx.counterPromo.deleteMany({ where: { id: lama.id } });
    if (terhapus.count !== 1) return { ok: false, code: "TIDAK_ADA" };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: JEJAK_PROMO_KONTER.DIHAPUS,
        entityType: ENTITAS_PROMO_KONTER,
        entityId: lama.id,
        changes: { before: potret(lama), after: null } as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  });
}
