import { prisma, Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { gantiPemegangToko } from "@/lib/stores/penanggung-jawab-writer";
import {
  bacaAturanKelasToko,
  bacaKelas,
  DAFTAR_KELAS,
  KUNCI_KELAS_TOKO,
  perubahanUsulan,
  usulanPerJenis,
  type AturanKelasToko,
  type KelasToko,
  type SatuanNilaiKelas,
} from "@/lib/stores/kelas-toko";

export type StoreFields = {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  marginPercent: number | null;
  lat: number | null;
  lng: number | null;
  checkinRadiusMeters: number | null;
  /**
   * Toko pengusaha kena pajak.
   *
   * Menentukan boleh-tidaknya potongan berjenis `pkpOnly` (PPh 23). Milik
   * admin, BUKAN sales — sama seperti termsType dan marginPercent, karena
   * mengubahnya mengubah berapa yang boleh dipotong dari tagihan.
   */
  isPkp: boolean;
  /** Area (StoreGroup) — JGU, JTT, … Milik admin. */
  groupId: string | null;
  /**
   * Sales yang memegang toko ini SEKARANG. Milik admin; dirotasi dari
   * formulir toko atau massal dari daftar toko, dan setiap perubahan tercatat
   * di jejak audit. Bukan penjual faktur — itu tetap di faktur/pesanannya.
   */
  salesmanId: string | null;
  /**
   * Batas kredit toko PUTUS: sisa piutang maksimal (Rp) dan jumlah faktur
   * belum lunas maksimal. Kosong = ikut batas bawaan di Pengaturan → Salesman;
   * 0 adalah nilai sah ("tidak boleh ada"). Milik admin, bukan sales.
   *
   * Opsional di masukan: pemanggil yang tidak mengirimnya (`undefined`) tidak
   * mengubah nilai yang tersimpan — formulir lama tidak menghapus batas diam-diam.
   */
  creditLimit?: number | null;
  maxOpenInvoices?: number | null;
  /**
   * Kelas toko A/B/C — menentukan jarak kunjungan sales (diatur per kelas di
   * Pengaturan → Salesman). null = tanpa kelas, ikut batas hari umum. Milik
   * admin. Opsional seperti batas kredit: `undefined` tidak mengubah yang tersimpan.
   */
  storeClass?: KelasToko | null;
};

export type StoreListItem = StoreFields & {
  creditLimit: number | null;
  maxOpenInvoices: number | null;
  storeClass: KelasToko | null;
  id: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toDecimalOrNull(v: number | null): Prisma.Decimal | null {
  return v === null ? null : new Prisma.Decimal(v);
}

function serializeStore(s: {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  marginPercent: Prisma.Decimal | null;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  checkinRadiusMeters: number | null;
  isPkp: boolean;
  groupId: string | null;
  salesmanId: string | null;
  creditLimit: Prisma.Decimal | null;
  maxOpenInvoices: number | null;
  storeClass: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): StoreListItem {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    phone: s.phone,
    contactName: s.contactName,
    termsType: s.termsType,
    paymentTempo: s.paymentTempo,
    marginPercent: s.marginPercent ? s.marginPercent.toNumber() : null,
    lat: s.lat ? s.lat.toNumber() : null,
    lng: s.lng ? s.lng.toNumber() : null,
    checkinRadiusMeters: s.checkinRadiusMeters,
    isPkp: s.isPkp,
    groupId: s.groupId,
    salesmanId: s.salesmanId,
    creditLimit: s.creditLimit ? s.creditLimit.toNumber() : null,
    maxOpenInvoices: s.maxOpenInvoices,
    storeClass: bacaKelas(s.storeClass),
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Aksi jejak saat batas kredit toko diubah dari formulir toko. */
export const AKSI_BATAS_KREDIT_TOKO = "STORE_CREDIT_LIMIT_CHANGED";
/** Aksi jejak saat kelas toko diubah — dari formulir toko atau dari usulan otomatis. */
export const AKSI_KELAS_TOKO = "STORE_CLASS_CHANGED";

export async function listStores(
  opts: {
    activeOnly?: boolean;
    search?: string;
    /** Area (StoreGroup id). */
    groupId?: string;
    /** Pemegang sekarang; "TANPA" = toko yang belum punya pemegang. */
    salesmanId?: string | "TANPA";
    /** Kelas toko; "TANPA" = toko yang belum diberi kelas. */
    storeClass?: KelasToko | "TANPA";
  } = {},
  paging?: { page: number; pageSize: number },
): Promise<{ items: StoreListItem[]; totalCount: number }> {
  const where: Prisma.StoreWhereInput = {};
  if (opts.activeOnly) where.isActive = true;
  if (opts.groupId) where.groupId = opts.groupId;
  if (opts.salesmanId) where.salesmanId = opts.salesmanId === "TANPA" ? null : opts.salesmanId;
  if (opts.storeClass) where.storeClass = opts.storeClass === "TANPA" ? null : opts.storeClass;
  if (opts.search && opts.search.trim()) {
    where.OR = [
      { name: cariTeks(opts.search.trim()) },
      { code: cariTeks(opts.search.trim()) },
    ];
  }
  const [rows, totalCount] = await Promise.all([
    prisma.store.findMany({
      where,
      orderBy: { name: "asc" },
      ...(paging ? { skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize } : {}),
    }),
    prisma.store.count({ where }),
  ]);
  return { items: rows.map(serializeStore), totalCount };
}

// Lightweight {id,name} list for filter dropdowns — all stores (incl. inactive,
// since orders can reference a since-deactivated store), ordered by name.
export async function listStoreOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/**
 * Toko aktif untuk HP. `hanyaMilik` = saat kunci "hanya toko sendiri" menyala,
 * sempitkan ke toko yang dipegang sales itu.
 */
export async function listActiveStoresForPwa(opsi?: { hanyaMilik?: string }) {
  const rows = await prisma.store.findMany({
    where: { isActive: true, ...(opsi?.hanyaMilik ? { salesmanId: opsi.hanyaMilik } : {}) },
    orderBy: { name: "asc" },
  });
  return rows.map(serializeStore);
}

export async function getStore(id: string) {
  const s = await prisma.store.findUnique({ where: { id } });
  return s ? serializeStore(s) : null;
}

export async function createStore(input: StoreFields): Promise<StoreListItem> {
  const created = await prisma.store.create({
    data: {
      code: input.code,
      name: input.name,
      address: input.address,
      phone: input.phone,
      contactName: input.contactName,
      termsType: input.termsType,
      paymentTempo: input.paymentTempo,
      marginPercent: toDecimalOrNull(input.marginPercent),
      lat: toDecimalOrNull(input.lat),
      lng: toDecimalOrNull(input.lng),
      checkinRadiusMeters: input.checkinRadiusMeters,
      isPkp: input.isPkp,
      groupId: input.groupId,
      salesmanId: input.salesmanId,
      creditLimit: toDecimalOrNull(input.creditLimit ?? null),
      maxOpenInvoices: input.maxOpenInvoices ?? null,
      storeClass: input.storeClass ?? null,
    },
  });
  return serializeStore(created);
}

/**
 * Simpan formulir toko. Perubahan pemegang dan batas kredit ditulis ke jejak
 * audit di transaksi yang sama — kolomnya hanya menyimpan nilai terakhir.
 */
export async function updateStore(id: string, input: StoreFields, olehUserId: string): Promise<StoreListItem> {
  return prisma.$transaction(async (tx) => {
    const sebelum = await tx.store.findUnique({
      where: { id },
      select: { salesmanId: true, creditLimit: true, maxOpenInvoices: true, storeClass: true },
    });
    const updated = await tx.store.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        address: input.address,
        phone: input.phone,
        contactName: input.contactName,
        termsType: input.termsType,
        paymentTempo: input.paymentTempo,
        marginPercent: toDecimalOrNull(input.marginPercent),
        lat: toDecimalOrNull(input.lat),
        lng: toDecimalOrNull(input.lng),
        checkinRadiusMeters: input.checkinRadiusMeters,
        isPkp: input.isPkp,
        groupId: input.groupId,
        salesmanId: input.salesmanId,
        ...(input.creditLimit !== undefined ? { creditLimit: toDecimalOrNull(input.creditLimit) } : {}),
        ...(input.maxOpenInvoices !== undefined ? { maxOpenInvoices: input.maxOpenInvoices } : {}),
        ...(input.storeClass !== undefined ? { storeClass: input.storeClass } : {}),
      },
    });
    const kreditSebelum = {
      creditLimit: sebelum?.creditLimit ? sebelum.creditLimit.toNumber() : null,
      maxOpenInvoices: sebelum?.maxOpenInvoices ?? null,
    };
    const kreditSesudah = {
      creditLimit: updated.creditLimit ? updated.creditLimit.toNumber() : null,
      maxOpenInvoices: updated.maxOpenInvoices,
    };
    // Batas kredit menentukan pesanan mana yang ditahan atau ditolak — siapa
    // mengubahnya, kapan, dan dari berapa hanya hidup di jejak ini.
    if (
      sebelum &&
      (kreditSebelum.creditLimit !== kreditSesudah.creditLimit ||
        kreditSebelum.maxOpenInvoices !== kreditSesudah.maxOpenInvoices)
    ) {
      await tx.auditLog.create({
        data: {
          userId: olehUserId,
          action: AKSI_BATAS_KREDIT_TOKO,
          entityType: "Store",
          entityId: id,
          changes: { before: kreditSebelum, after: kreditSesudah },
        },
      });
    }
    // Kelas menentukan seberapa sering toko didatangi — jejaknya sama dengan batas kredit.
    const kelasSebelum = bacaKelas(sebelum?.storeClass);
    const kelasSesudah = bacaKelas(updated.storeClass);
    if (sebelum && kelasSebelum !== kelasSesudah) {
      await tx.auditLog.create({
        data: {
          userId: olehUserId,
          action: AKSI_KELAS_TOKO,
          entityType: "Store",
          entityId: id,
          changes: { before: { storeClass: kelasSebelum }, after: { storeClass: kelasSesudah } },
          metadata: { sumber: "FORMULIR" },
        },
      });
    }
    await gantiPemegangToko(tx, {
      storeId: id,
      sebelum: sebelum?.salesmanId ?? null,
      sesudah: input.salesmanId,
      olehUserId,
    });
    return serializeStore(updated);
  });
}

export async function deactivateStore(id: string): Promise<void> {
  await prisma.store.update({ where: { id }, data: { isActive: false } });
}

export async function getActiveVisit(userId: string) {
  const v = await prisma.storeVisit.findFirst({
    where: { userId, checkoutAt: null },
    include: { store: { select: { name: true, termsType: true } } },
    orderBy: { checkinAt: "desc" },
  });
  if (!v) return null;
  return {
    id: v.id,
    storeId: v.storeId,
    store: v.store,
    checkinAt: v.checkinAt,
    checkinOutOfRadius: v.checkinOutOfRadius,
    checkinDistanceMeters: v.checkinDistanceMeters,
  };
}

export async function listVisitsForStore(storeId: string, limit: number) {
  const rows = await prisma.storeVisit.findMany({
    where: { storeId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { checkinAt: "desc" },
    take: limit,
  });
  return rows.map(r => ({
    id: r.id,
    checkinAt: r.checkinAt,
    checkoutAt: r.checkoutAt,
    checkinLat: r.checkinLat.toNumber(),
    checkinLng: r.checkinLng.toNumber(),
    checkoutLat: r.checkoutLat ? r.checkoutLat.toNumber() : null,
    checkoutLng: r.checkoutLng ? r.checkoutLng.toNumber() : null,
    autoClosed: r.autoClosed,
    checkinOutOfRadius: r.checkinOutOfRadius,
    checkinDistanceMeters: r.checkinDistanceMeters,
    user: r.user,
  }));
}

export async function listRecentVisitsForUser(userId: string, limit: number) {
  const rows = await prisma.storeVisit.findMany({
    where: { userId },
    include: { store: { select: { name: true } } },
    orderBy: { checkinAt: "desc" },
    take: limit,
  });
  return rows.map(r => ({
    id: r.id,
    storeId: r.storeId,
    store: r.store,
  }));
}

export async function listVisitPhotos(visitId: string) {
  return prisma.visitPhoto.findMany({
    where: { visitId },
    orderBy: { capturedAt: "asc" },
    select: { id: true, url: true, caption: true, capturedAt: true },
  });
}

export async function listVisitPhotosForVisits(visitIds: string[]) {
  const map = new Map<string, Array<{ id: string; url: string; caption: string | null; capturedAt: Date }>>();
  if (visitIds.length === 0) return map;
  const rows = await prisma.visitPhoto.findMany({
    where: { visitId: { in: visitIds } },
    orderBy: { capturedAt: "asc" },
    select: { id: true, visitId: true, url: true, caption: true, capturedAt: true },
  });
  for (const r of rows) {
    const list = map.get(r.visitId) ?? [];
    list.push({ id: r.id, url: r.url, caption: r.caption, capturedAt: r.capturedAt });
    map.set(r.visitId, list);
  }
  return map;
}

// ─── Kelas toko ──────────────────────────────────────────────────────────────

/** Rentang nilai beli yang dipakai mengusulkan kelas toko. */
export const HARI_NILAI_KELAS = 180;

/** Aturan kelas toko dari `SystemSetting` (nilai rusak → bawaan per kolom). */
export async function aturanKelasToko(): Promise<AturanKelasToko> {
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_KELAS_TOKO }, select: { value: true } });
  return bacaAturanKelasToko(baris?.value);
}

export type BarisKelasToko = {
  storeId: string;
  code: string;
  name: string;
  termsType: "PUTUS" | "KONSI";
  areaKode: string | null;
  kelas: KelasToko | null;
  /** Nilai beli 180 hari: rupiah untuk toko putus, potong untuk toko konsinyasi. */
  nilai: number;
  satuan: SatuanNilaiKelas;
  /** null = belum ada pembelian dalam 180 hari — tidak diberi usulan. */
  usulan: KelasToko | null;
};

/**
 * Setiap toko aktif dengan nilai belinya 180 hari terakhir dan usulan kelasnya.
 *
 * Nilai beli:
 * - Toko PUTUS = rupiah seluruh nota pengiriman dalam 180 hari (menurut tanggal
 *   kirim). Yang dihitung barang yang benar-benar diterima toko, bukan yang
 *   dipesan: pesanan yang sisanya ditutup hanya terhitung bagian terkirimnya.
 * - Toko KONSI = jumlah POTONG di pesanan konsinyasi yang disetujui dalam 180
 *   hari (menurut tanggal disetujui). Konsinyasi tidak punya harga beli —
 *   barangnya titipan, dibayar sesudah laku — jadi rupiah pesanannya tidak
 *   sebanding dengan toko putus. Karena itu kedua jenis diperingkat terpisah
 *   (`usulanPerJenis`), dan layar menyebut satuannya.
 * Penjualan van ke toko tidak ikut: definisi pemilik adalah kiriman putus dan
 * konsinyasi. Toko tanpa pembelian tetap tanpa usulan.
 */
export async function daftarKelasToko(aturan: AturanKelasToko, hariIni: Date = new Date()): Promise<BarisKelasToko[]> {
  const sejak = new Date(hariIni.getTime() - HARI_NILAI_KELAS * 86_400_000);
  const [toko, kirim, konsi] = await Promise.all([
    prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, termsType: true, storeClass: true, group: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: { gte: sejak }, order: { orderType: "PUTUS", status: "APPROVED" } },
      select: { total: true, order: { select: { storeId: true } } },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { orderType: "KONSI", status: "APPROVED", approvedAt: { gte: sejak } },
      select: { storeId: true, lines: { select: { qty: true } } },
    }),
  ]);

  const rupiah = new Map<string, number>();
  for (const d of kirim) rupiah.set(d.order.storeId, (rupiah.get(d.order.storeId) ?? 0) + Number(d.total));
  const potong = new Map<string, number>();
  for (const o of konsi) {
    const n = o.lines.reduce((j, l) => j + l.qty, 0);
    potong.set(o.storeId, (potong.get(o.storeId) ?? 0) + n);
  }

  const usulan = usulanPerJenis(
    toko.map((t) => ({
      storeId: t.id,
      termsType: t.termsType,
      rupiah: rupiah.get(t.id) ?? 0,
      potong: potong.get(t.id) ?? 0,
    })),
    aturan.otomatis,
  );
  return toko.map((t) => ({
    storeId: t.id,
    code: t.code,
    name: t.name,
    termsType: t.termsType,
    areaKode: t.group?.code ?? null,
    kelas: bacaKelas(t.storeClass),
    nilai: usulan[t.id].nilai,
    satuan: usulan[t.id].satuan,
    usulan: usulan[t.id].usulan,
  }));
}

/** Jumlah toko aktif per kelas, untuk ringkasan di Pengaturan → Salesman. */
export async function jumlahTokoPerKelas(): Promise<Record<KelasToko | "TANPA", number>> {
  const rows = await prisma.store.groupBy({ by: ["storeClass"], where: { isActive: true }, _count: { _all: true } });
  const hasil: Record<KelasToko | "TANPA", number> = { A: 0, B: 0, C: 0, TANPA: 0 };
  for (const r of rows) hasil[bacaKelas(r.storeClass) ?? "TANPA"] += r._count._all;
  return hasil;
}

/**
 * "Terapkan usulan" di halaman Kelas toko: ubah kelas toko terpilih menjadi
 * usulannya. Usulan DIHITUNG ULANG di sini — kelas kiriman layar tidak
 * dipercaya — dan kelas sekarang dibaca di dalam transaksi, supaya jejak
 * mencatat nilai "sebelum" yang benar. Setiap toko yang berubah mendapat satu
 * baris jejak `STORE_CLASS_CHANGED` beserta nilai beli yang mendasarinya.
 */
export async function terapkanUsulanKelas(
  storeIds: readonly string[],
  olehUserId: string,
  hariIni: Date = new Date(),
): Promise<{ diubah: number }> {
  const daftar = await daftarKelasToko(await aturanKelasToko(), hariIni);
  const dasar = new Map(daftar.map((b) => [b.storeId, b]));
  const ids = [...new Set(storeIds)].filter((id) => dasar.has(id));
  if (ids.length === 0) return { diubah: 0 };

  return prisma.$transaction(async (tx) => {
    const sekarang = await tx.store.findMany({ where: { id: { in: ids } }, select: { id: true, storeClass: true } });
    const ubah = perubahanUsulan(
      sekarang.map((t) => ({ storeId: t.id, kelas: bacaKelas(t.storeClass), usulan: dasar.get(t.id)?.usulan ?? null })),
      ids,
    );
    if (ubah.length === 0) return { diubah: 0 };
    // Satu pembaruan per kelas tujuan, bukan per toko — ratusan toko tetap
    // selesai jauh di bawah batas waktu transaksi.
    for (const k of DAFTAR_KELAS) {
      const ke = ubah.filter((u) => u.ke === k).map((u) => u.storeId);
      if (ke.length) await tx.store.updateMany({ where: { id: { in: ke } }, data: { storeClass: k } });
    }
    await tx.auditLog.createMany({
      data: ubah.map((u) => {
        const b = dasar.get(u.storeId);
        return {
          userId: olehUserId,
          action: AKSI_KELAS_TOKO,
          entityType: "Store",
          entityId: u.storeId,
          changes: { before: { storeClass: u.dari }, after: { storeClass: u.ke } },
          metadata: { sumber: "USULAN_OTOMATIS", hari: HARI_NILAI_KELAS, nilai: b?.nilai ?? 0, satuan: b?.satuan ?? null },
        };
      }),
    });
    return { diubah: ubah.length };
  });
}
