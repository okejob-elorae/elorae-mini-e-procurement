import { prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { daftarSalesman, daftarSpg } from "@/lib/salesman/queries";
import {
  bacaJejakKeringanan,
  batasPotongSen,
  dariSen,
  ENTITAS_HILANG,
  JEJAK_HILANG,
  keSen,
  REF_KOMISI_SALESMAN,
  STATUS_HILANG,
  umurHari,
  type JejakKeringanan,
  type Penanggung,
  type StatusHilang,
  type SumberHilang,
} from "./hilang";
import { bacaAturanHilang } from "./hilang-db";

/**
 * Kueri barang hilang: daftar & rincian kantor, beban di HP orang yang
 * menanggung, dan kolom potongan di laporan komisi salesman. Tanggal diformat
 * di server (WIB).
 */

const angka = (v: unknown): number => Number(v ?? 0);

async function namaPengguna(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

async function namaToko(ids: (string | null | undefined)[]): Promise<Map<string, { name: string; termsType: "PUTUS" | "KONSI" }>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.store.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, termsType: true } });
  return new Map(rows.map((s) => [s.id, { name: s.name, termsType: s.termsType }]));
}

// ─── Daftar kantor ──────────────────────────────────────────────────────────

export type BarisDaftarHilang = {
  id: string;
  sumber: SumberHilang;
  sourceDocNo: string | null;
  toko: string | null;
  dibuat: string;
  umurHari: number;
  totalQty: number;
  nilai: number;
  status: StatusHilang;
  penanggung: Penanggung[];
  sisaTerbuka: number;
};

export type DaftarHilangKantor = {
  baris: BarisDaftarHilang[];
  perStatus: Record<StatusHilang, number>;
  toko: { id: string; name: string }[];
  dibatasi: boolean;
};

const BATAS_DAFTAR = 300;

export async function daftarHilangKantor(saring: {
  status: StatusHilang | null;
  storeId: string | null;
  sumber: SumberHilang | null;
  sekarang?: Date;
}): Promise<DaftarHilangKantor> {
  const sekarang = saring.sekarang ?? new Date();
  const where = {
    ...(saring.status ? { status: saring.status } : {}),
    ...(saring.storeId ? { storeId: saring.storeId } : {}),
    ...(saring.sumber ? { source: saring.sumber } : {}),
  };
  const [rows, grup, tokoGrup] = await Promise.all([
    prisma.stockLoss.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: BATAS_DAFTAR + 1,
      select: {
        id: true,
        source: true,
        sourceDocNo: true,
        storeId: true,
        createdAt: true,
        totalQty: true,
        totalAmount: true,
        status: true,
        shares: { select: { bearer: true, amount: true, settledAmount: true } },
      },
    }),
    prisma.stockLoss.groupBy({
      by: ["status"],
      where: { ...(saring.storeId ? { storeId: saring.storeId } : {}), ...(saring.sumber ? { source: saring.sumber } : {}) },
      _count: { _all: true },
    }),
    prisma.stockLoss.groupBy({ by: ["storeId"], _count: { _all: true } }),
  ]);
  const dibatasi = rows.length > BATAS_DAFTAR;
  const tampil = rows.slice(0, BATAS_DAFTAR);
  const toko = await namaToko([...tampil.map((r) => r.storeId), ...tokoGrup.map((g) => g.storeId)]);

  const perStatus = Object.fromEntries(STATUS_HILANG.map((s) => [s, 0])) as Record<StatusHilang, number>;
  for (const g of grup) if ((STATUS_HILANG as readonly string[]).includes(g.status)) perStatus[g.status as StatusHilang] = g._count._all;

  // Yang menunggu keputusan lebih dulu, lalu yang terbaru.
  const urut = (s: string) => (s === "TERBUKA" ? 0 : s === "DITETAPKAN" ? 1 : 2);
  const baris = tampil
    .map((r): BarisDaftarHilang => ({
      id: r.id,
      sumber: r.source as SumberHilang,
      sourceDocNo: r.sourceDocNo,
      toko: r.storeId ? (toko.get(r.storeId)?.name ?? null) : null,
      dibuat: formatDisplayDate(r.createdAt),
      umurHari: umurHari(r.createdAt, sekarang),
      totalQty: r.totalQty,
      nilai: angka(r.totalAmount),
      status: r.status as StatusHilang,
      penanggung: [...new Set(r.shares.map((s) => s.bearer as Penanggung))],
      sisaTerbuka: dariSen(r.shares.reduce((n, s) => n + Math.max(0, keSen(angka(s.amount)) - keSen(angka(s.settledAmount))), 0)),
    }))
    .sort((a, b) => urut(a.status) - urut(b.status));

  return {
    baris,
    perStatus,
    toko: tokoGrup
      .map((g) => (g.storeId ? { id: g.storeId, name: toko.get(g.storeId)?.name ?? g.storeId } : null))
      .filter((x): x is { id: string; name: string } => x !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "id")),
    dibatasi,
  };
}

// ─── Rincian kantor ─────────────────────────────────────────────────────────

export type PotonganRincian = { id: string; jumlah: number; refType: string; refId: string; catatan: string | null; pada: string; oleh: string };

export type BagianRincian = {
  id: string;
  bearer: Penanggung;
  orang: { id: string; nama: string } | null;
  nilai: number;
  dipotong: number;
  sisa: number;
  lunas: boolean;
  lunasPada: string | null;
  catatanLunas: string | null;
  potongan: PotonganRincian[];
};

export type RincianHilangKantor = {
  id: string;
  status: StatusHilang;
  sumber: SumberHilang;
  sourceDocNo: string | null;
  tautanSumber: string | null;
  toko: {
    id: string;
    name: string;
    termsType: "PUTUS" | "KONSI";
    pemegang: { id: string; nama: string } | null;
    spg: { id: string; nama: string }[];
  } | null;
  dibuat: string;
  dibuatOleh: string;
  catatan: string | null;
  dasarNilai: string;
  totalQty: number;
  nilaiBarang: number;
  total: number;
  adaBarisTanpaNilai: boolean;
  keputusan: { oleh: string; pada: string; catatan: string | null } | null;
  /** Keringanan diskon pegawai pada keputusan yang berlaku (dari jejaknya), atau null. */
  keringanan: JejakKeringanan | null;
  /**
   * `hargaCadangan`: dasar HARGA_TERIMA, tetapi toko itu belum pernah menerima
   * barang ini — dinilai dengan harga jual Elorae.
   */
  baris: {
    id: string;
    productName: string;
    variantSku: string;
    qty: number;
    nilaiSatuan: number;
    nilai: number;
    tanpaNilai: boolean;
    hargaCadangan: boolean;
  }[];
  bagian: BagianRincian[];
  /** Ada potongan/tagihan atas bagian toko/orang — keputusan tidak bisa diubah/dibatalkan lagi. */
  terkunci: boolean;
  riwayat: { id: string; action: string; oleh: string; pada: string; alasan: string | null }[];
};

async function tautanSumber(sumber: string, sourceId: string | null, storeId: string | null): Promise<string | null> {
  if (sumber === "OPNAME") return storeId ? `/backoffice/stores/${storeId}` : null;
  if (!sourceId) return null;
  if (sumber === "MUTASI") return `/backoffice/spg-transfers/${sourceId}`;
  if (sumber !== "PENERIMAAN") return null;
  const r = await prisma.storeReceipt.findUnique({ where: { id: sourceId }, select: { sourceType: true, sourceId: true } });
  if (!r) return null;
  if (r.sourceType === "KONSI_ORDER") return `/backoffice/field-sales-orders/${r.sourceId}`;
  if (r.sourceType === "PUTUS_DELIVERY") {
    const d = await prisma.fieldSalesDelivery.findUnique({ where: { id: r.sourceId }, select: { orderId: true } });
    return d ? `/backoffice/field-sales-orders/${d.orderId}` : null;
  }
  if (r.sourceType === "KONSI_SHIPMENT") {
    const k = await prisma.consignmentShipment.findUnique({ where: { id: r.sourceId }, select: { cycleId: true } });
    return k?.cycleId ? `/backoffice/konsinyasi/${k.cycleId}` : null;
  }
  return null;
}

export async function rincianHilangKantor(id: string): Promise<RincianHilangKantor | null> {
  const loss = await prisma.stockLoss.findUnique({
    where: { id },
    include: { lines: { orderBy: { productName: "asc" } }, shares: { orderBy: { id: "asc" } } },
  });
  if (!loss) return null;

  const [toko, potongan, jejak, tautan] = await Promise.all([
    loss.storeId
      ? prisma.store.findUnique({ where: { id: loss.storeId }, select: { id: true, name: true, termsType: true, salesmanId: true } })
      : Promise.resolve(null),
    loss.shares.length
      ? prisma.stockLossDeduction.findMany({ where: { shareId: { in: loss.shares.map((s) => s.id) } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_HILANG, entityId: loss.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, userId: true, createdAt: true, reason: true, metadata: true },
    }),
    tautanSumber(loss.source, loss.sourceId, loss.storeId),
  ]);
  const spg = toko ? await prisma.user.findMany({ where: { assignedStoreId: toko.id }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }) : [];
  const nama = await namaPengguna([
    loss.createdById,
    loss.decidedById,
    toko?.salesmanId,
    ...loss.shares.map((s) => s.bearerUserId),
    ...potongan.map((p) => p.createdById),
    ...jejak.map((j) => j.userId),
  ]);

  const bagian: BagianRincian[] = loss.shares.map((s) => {
    const nilaiSen = keSen(angka(s.amount));
    const dipotongSen = keSen(angka(s.settledAmount));
    return {
      id: s.id,
      bearer: s.bearer as Penanggung,
      orang: s.bearerUserId ? { id: s.bearerUserId, nama: nama.get(s.bearerUserId) ?? s.bearerUserId } : null,
      nilai: dariSen(nilaiSen),
      dipotong: dariSen(dipotongSen),
      sisa: dariSen(Math.max(0, nilaiSen - dipotongSen)),
      lunas: s.settledAt !== null,
      lunasPada: s.settledAt ? formatDisplayDateTime(s.settledAt) : null,
      catatanLunas: s.settleNote,
      potongan: potongan
        .filter((p) => p.shareId === s.id)
        .map((p) => ({
          id: p.id,
          jumlah: angka(p.amount),
          refType: p.refType,
          refId: p.refId,
          catatan: p.note,
          pada: formatDisplayDateTime(p.createdAt),
          oleh: nama.get(p.createdById) ?? p.createdById,
        })),
    };
  });
  const terkunci = bagian.some((b) => b.bearer !== "ELORAE" && (b.dipotong > 0 || b.potongan.length > 0));

  // Keputusan yang berlaku = jejak keputusan/perubahan TERAKHIR (bagian dihapus dan ditulis ulang setiap kali).
  const jejakKeputusan = [...jejak].reverse().find((j) => j.action === JEJAK_HILANG.DIPUTUSKAN || j.action === JEJAK_HILANG.DIUBAH);
  const keringanan = loss.status === "DITETAPKAN" || loss.status === "SELESAI" ? bacaJejakKeringanan(jejakKeputusan?.metadata) : null;
  const jejakBuka = jejak.find((j) => j.action === JEJAK_HILANG.DIBUKA);
  const cadangan = new Set(bacaHargaCadangan(jejakBuka?.metadata));
  const nilaiBarang = dariSen(loss.lines.reduce((n, l) => n + keSen(angka(l.amount)), 0));

  return {
    id: loss.id,
    status: loss.status as StatusHilang,
    sumber: loss.source as SumberHilang,
    sourceDocNo: loss.sourceDocNo,
    tautanSumber: tautan,
    toko: toko
      ? {
          id: toko.id,
          name: toko.name,
          termsType: toko.termsType,
          pemegang: toko.salesmanId ? { id: toko.salesmanId, nama: nama.get(toko.salesmanId) ?? toko.salesmanId } : null,
          spg: spg.map((u) => ({ id: u.id, nama: u.name ?? u.email })),
        }
      : null,
    dibuat: formatDisplayDateTime(loss.createdAt),
    dibuatOleh: nama.get(loss.createdById) ?? loss.createdById,
    catatan: loss.note,
    dasarNilai: loss.valueBasis,
    totalQty: loss.totalQty,
    nilaiBarang,
    total: angka(loss.totalAmount),
    adaBarisTanpaNilai: loss.lines.some((l) => keSen(angka(l.unitValue)) === 0),
    keputusan: loss.decidedAt
      ? { oleh: loss.decidedById ? (nama.get(loss.decidedById) ?? loss.decidedById) : "—", pada: formatDisplayDateTime(loss.decidedAt), catatan: loss.decisionNote }
      : null,
    keringanan,
    baris: loss.lines.map((l) => ({
      id: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty,
      nilaiSatuan: angka(l.unitValue),
      nilai: angka(l.amount),
      tanpaNilai: !l.itemId || keSen(angka(l.unitValue)) === 0,
      hargaCadangan: loss.valueBasis === "HARGA_TERIMA" && Boolean(l.itemId) && cadangan.has(kunciBaris(l.itemId, l.variantSku)),
    })),
    bagian,
    terkunci,
    riwayat: jejak.map((j) => ({
      id: j.id,
      action: j.action,
      oleh: nama.get(j.userId) ?? j.userId,
      pada: formatDisplayDateTime(j.createdAt),
      alasan: j.reason,
    })),
  };
}

const kunciBaris = (itemId: string | null, variantSku: string | null) => `${itemId ?? ""}\u0000${variantSku ?? ""}`;

/** `metadata.hargaCadangan` di jejak pembukaan → kunci baris yang dinilai dengan harga jual Elorae. */
function bacaHargaCadangan(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const daftar = (metadata as Record<string, unknown>).hargaCadangan;
  if (!Array.isArray(daftar)) return [];
  return daftar.flatMap((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return typeof o.itemId === "string" ? [kunciBaris(o.itemId, typeof o.variantSku === "string" ? o.variantSku : "")] : [];
  });
}

/** Orang yang bisa dipilih sebagai penanggung: semua SPG (dengan tokonya) dan semua salesman. */
export async function pilihanOrangHilang(): Promise<{ spg: { id: string; nama: string; toko: string | null }[]; sales: { id: string; nama: string }[] }> {
  const [spg, sales] = await Promise.all([daftarSpg(), daftarSalesman()]);
  return { spg: spg.map((s) => ({ id: s.id, nama: s.nama, toko: s.tokoNama })), sales };
}

// ─── HP: beban saya ─────────────────────────────────────────────────────────

/**
 * Satu bagian beban barang hilang milik orang yang masuk. HANYA nilai bagian
 * miliknya — tidak ada nilai satuan, total catatan, atau bagian orang lain
 * (aturan HP: rupiah toko/orang lain tidak pernah sampai ke HP).
 */
export type BebanHilangSaya = {
  id: string;
  toko: string | null;
  tanggal: string;
  barang: { nama: string; qty: number }[];
  barangLain: number;
  nilai: number;
  dipotong: number;
  sisa: number;
  lunas: boolean;
  /** Bagian ini sudah dikurangi keringanan diskon pegawai sekian persen, atau null. Hanya persennya. */
  keringananPersen: number | null;
};

const BARANG_TAMPIL = 4;

export async function bebanHilangSaya(userId: string): Promise<BebanHilangSaya[]> {
  if (!userId) return [];
  const rows = await prisma.stockLossShare.findMany({
    where: { bearerUserId: userId, bearer: { in: ["SPG", "SALES"] }, loss: { status: { in: ["DITETAPKAN", "SELESAI"] } } },
    orderBy: [{ loss: { decidedAt: "desc" } }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      bearer: true,
      amount: true,
      settledAmount: true,
      settledAt: true,
      loss: {
        select: {
          id: true,
          storeId: true,
          decidedAt: true,
          createdAt: true,
          lines: { select: { productName: true, qty: true }, orderBy: { productName: "asc" } },
        },
      },
    },
  });
  const [toko, keringanan] = await Promise.all([namaToko(rows.map((r) => r.loss.storeId)), keringananPerCatatan(rows.map((r) => r.loss.id))]);
  const persenKeringanan = (lossId: string, bearer: string): number | null => {
    const k = keringanan.get(lossId);
    return k?.perOrang.some((p) => p.bearerUserId === userId && p.bearer === bearer) ? k.persen : null;
  };
  // Yang belum lunas di atas; di dalamnya yang terbaru dulu (urutan kueri dipertahankan).
  const urut = [...rows.filter((r) => r.settledAt === null), ...rows.filter((r) => r.settledAt !== null)];
  return urut.map((r) => {
    const nilaiSen = keSen(angka(r.amount));
    const dipotongSen = Math.min(nilaiSen, keSen(angka(r.settledAmount)));
    return {
      id: r.id,
      toko: r.loss.storeId ? (toko.get(r.loss.storeId)?.name ?? null) : null,
      tanggal: formatDisplayDate(r.loss.decidedAt ?? r.loss.createdAt),
      barang: r.loss.lines.slice(0, BARANG_TAMPIL).map((l) => ({ nama: l.productName, qty: l.qty })),
      barangLain: Math.max(0, r.loss.lines.length - BARANG_TAMPIL),
      nilai: dariSen(nilaiSen),
      dipotong: dariSen(dipotongSen),
      sisa: dariSen(nilaiSen - dipotongSen),
      lunas: r.settledAt !== null,
      keringananPersen: persenKeringanan(r.loss.id, r.bearer),
    };
  });
}

/**
 * Keringanan pada keputusan yang berlaku untuk setiap catatan: jejak
 * keputusan/perubahan TERAKHIR per catatan (tanpa kolom baru — keringanan
 * hanya hidup di metadata jejak). Catatan tanpa keringanan tidak ada di peta.
 */
async function keringananPerCatatan(lossIds: string[]): Promise<Map<string, JejakKeringanan>> {
  const ids = [...new Set(lossIds)];
  if (ids.length === 0) return new Map();
  const jejak = await prisma.auditLog.findMany({
    where: { entityType: ENTITAS_HILANG, entityId: { in: ids }, action: { in: [JEJAK_HILANG.DIPUTUSKAN, JEJAK_HILANG.DIUBAH] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, metadata: true },
  });
  const hasil = new Map<string, JejakKeringanan>();
  const dilihat = new Set<string>();
  for (const j of jejak) {
    if (!j.entityId || dilihat.has(j.entityId)) continue;
    dilihat.add(j.entityId);
    const k = bacaJejakKeringanan(j.metadata);
    if (k) hasil.set(j.entityId, k);
  }
  return hasil;
}

// ─── Laporan komisi salesman ────────────────────────────────────────────────

export type PotonganHilangSales = { sisa: number; dipotongBulanIni: number; saran: number };

/**
 * Kolom "Potongan barang hilang" di laporan komisi salesman: sisa bagian SALES
 * yang belum lunas, yang sudah ditandai dipotong untuk bulan ini, dan saran
 * potongan bulan ini (batas `maksPotongPersen` × komisi, dikurangi yang sudah
 * dipotong, tidak lebih dari sisa).
 */
export async function potonganHilangSalesBulan(
  baris: { salesmanId: string; komisi: number }[],
  bulan: string,
): Promise<{ maksPotongPersen: number; per: Record<string, PotonganHilangSales> }> {
  const ids = [...new Set(baris.map((b) => b.salesmanId))];
  const aturan = await bacaAturanHilang(prisma);
  if (ids.length === 0) return { maksPotongPersen: aturan.maksPotongPersen, per: {} };
  const [terbuka, bagianSemua] = await Promise.all([
    prisma.stockLossShare.findMany({
      where: { bearerUserId: { in: ids }, bearer: "SALES", settledAt: null, loss: { status: "DITETAPKAN" } },
      select: { bearerUserId: true, amount: true, settledAmount: true },
    }),
    prisma.stockLossShare.findMany({ where: { bearerUserId: { in: ids }, bearer: "SALES" }, select: { id: true, bearerUserId: true } }),
  ]);
  const pemilik = new Map(bagianSemua.map((s) => [s.id, s.bearerUserId as string]));
  const potongan = bagianSemua.length
    ? await prisma.stockLossDeduction.findMany({
        where: { refType: REF_KOMISI_SALESMAN, shareId: { in: bagianSemua.map((s) => s.id) } },
        select: { shareId: true, refId: true, amount: true },
      })
    : [];

  const per: Record<string, PotonganHilangSales> = {};
  for (const b of baris) {
    const sisaSen = terbuka
      .filter((s) => s.bearerUserId === b.salesmanId)
      .reduce((n, s) => n + Math.max(0, keSen(angka(s.amount)) - keSen(angka(s.settledAmount))), 0);
    const bulanIniSen = potongan
      .filter((p) => pemilik.get(p.shareId) === b.salesmanId && p.refId.startsWith(`${b.salesmanId}:${bulan}:`))
      .reduce((n, p) => n + keSen(angka(p.amount)), 0);
    const batasSen = batasPotongSen(b.komisi, aturan.maksPotongPersen);
    const saranSen = Math.max(0, Math.min(sisaSen, batasSen - bulanIniSen));
    per[b.salesmanId] = { sisa: dariSen(sisaSen), dipotongBulanIni: dariSen(bulanIniSen), saran: dariSen(saranSen) };
  }
  return { maksPotongPersen: aturan.maksPotongPersen, per };
}
