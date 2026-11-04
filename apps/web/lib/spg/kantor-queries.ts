import { prisma } from "@elorae/db";

/**
 * Kueri kantor untuk pekerjaan SPG: permintaan kiriman dan barang dicari.
 */

export type StatusPermintaan = "BARU" | "DIPROSES" | "SELESAI" | "DITOLAK";

export type PermintaanKiriman = {
  id: string;
  toko: { id: string; name: string };
  peminta: string;
  status: StatusPermintaan;
  catatan: string | null;
  dibuat: string;
  ditangani: { oleh: string; pada: string; catatan: string | null } | null;
  baris: { productName: string; variantSku: string; qty: number }[];
  totalQty: number;
};

async function namaPengguna(ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

export async function daftarPermintaanKiriman(opsi: { status?: StatusPermintaan; storeId?: string } = {}): Promise<PermintaanKiriman[]> {
  const rows = await prisma.stockRequest.findMany({
    where: { ...(opsi.status ? { status: opsi.status } : {}), ...(opsi.storeId ? { storeId: opsi.storeId } : {}) },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      status: true,
      note: true,
      createdAt: true,
      requestedById: true,
      handledById: true,
      handledAt: true,
      handleNote: true,
      store: { select: { id: true, name: true } },
      lines: { select: { productName: true, variantSku: true, qty: true } },
    },
  });
  const nama = await namaPengguna(rows.flatMap((r) => [r.requestedById, r.handledById ?? ""]));
  return rows.map((r) => ({
    id: r.id,
    toko: r.store,
    peminta: nama.get(r.requestedById) ?? "—",
    status: r.status,
    catatan: r.note,
    dibuat: r.createdAt.toISOString(),
    ditangani:
      r.handledById && r.handledAt
        ? { oleh: nama.get(r.handledById) ?? "—", pada: r.handledAt.toISOString(), catatan: r.handleNote }
        : null,
    baris: r.lines,
    totalQty: r.lines.reduce((n, l) => n + l.qty, 0),
  }));
}

export type BarangDicari = {
  id: string;
  toko: string;
  oleh: string;
  keterangan: string;
  qty: number;
  waktu: string;
};

export type RingkasBarangDicari = { keterangan: string; qty: number; kali: number; toko: number };

/**
 * Barang yang dicari pembeli tapi tidak ada, plus ringkasannya: keterangan
 * yang sama (tanpa beda huruf besar/kecil dan spasi) dijumlahkan, supaya yang
 * paling sering dicari muncul di atas — bahan untuk kiriman dan produksi.
 */
export async function daftarBarangDicari(opsi: { sejak?: Date; sebelum?: Date; storeId?: string } = {}): Promise<{
  baris: BarangDicari[];
  ringkas: RingkasBarangDicari[];
}> {
  const rows = await prisma.lostSale.findMany({
    where: {
      ...(opsi.sejak || opsi.sebelum
        ? { createdAt: { ...(opsi.sejak ? { gte: opsi.sejak } : {}), ...(opsi.sebelum ? { lt: opsi.sebelum } : {}) } }
        : {}),
      ...(opsi.storeId ? { storeId: opsi.storeId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, description: true, qty: true, createdAt: true, userId: true, storeId: true, store: { select: { name: true } } },
  });
  const nama = await namaPengguna(rows.map((r) => r.userId));

  const kelompok = new Map<string, { keterangan: string; qty: number; kali: number; toko: Set<string> }>();
  for (const r of rows) {
    const k = r.description.trim().toLowerCase().replace(/\s+/g, " ");
    const ada = kelompok.get(k) ?? { keterangan: r.description.trim(), qty: 0, kali: 0, toko: new Set<string>() };
    ada.qty += r.qty;
    ada.kali += 1;
    ada.toko.add(r.storeId);
    kelompok.set(k, ada);
  }

  return {
    baris: rows.map((r) => ({
      id: r.id,
      toko: r.store.name,
      oleh: nama.get(r.userId) ?? "—",
      keterangan: r.description,
      qty: r.qty,
      waktu: r.createdAt.toISOString(),
    })),
    ringkas: [...kelompok.values()]
      .map((g) => ({ keterangan: g.keterangan, qty: g.qty, kali: g.kali, toko: g.toko.size }))
      .sort((a, b) => b.qty - a.qty || b.kali - a.kali),
  };
}

/** Semua jenis gerakan buku stok toko (`StoreStockKind`). */
export const JENIS_GERAKAN_STOK = [
  "TERIMA",
  "JUAL",
  "OPNAME",
  "MUTASI_KELUAR",
  "MUTASI_MASUK",
  "RETUR_KELUAR",
  "RETUR_PEMBELI",
  "HILANG",
] as const;
export type JenisGerakanStok = (typeof JENIS_GERAKAN_STOK)[number];

export type GerakanStok = {
  id: string;
  waktu: string;
  jenis: JenisGerakanStok;
  nama: string;
  variantSku: string;
  qty: number;
  oleh: string;
};

/** Gerakan stok terakhir satu toko, untuk kartu stok di halaman toko. */
export async function gerakanStokToko(storeId: string, batas = 30): Promise<GerakanStok[]> {
  const rows = await prisma.storeStockMovement.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: batas,
    select: { id: true, createdAt: true, kind: true, variantSku: true, qty: true, createdById: true, item: { select: { nameId: true } } },
  });
  const nama = await namaPengguna(rows.map((r) => r.createdById));
  return rows.map((r) => ({
    id: r.id,
    waktu: r.createdAt.toISOString(),
    jenis: r.kind,
    nama: r.item.nameId,
    variantSku: r.variantSku,
    qty: r.qty,
    oleh: nama.get(r.createdById) ?? "—",
  }));
}
