import { prisma, type Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { susunVarianKirim, type PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import { hariIniWib } from "@/lib/tanggal-isian";
import type { AmbangKreatif } from "./ambang";
import { bacaAmbangKreatif } from "./pengaturan";
import {
  keadaanPengiriman,
  kirimDobel,
  tanpaNomorResi,
  TAHAP_PERLU_KIRIM,
  TAHAP_TUNGGU_TAYANG,
  UKURAN_HALAMAN_SAMPEL,
  type BarisCsvAlamat,
  type KeadaanPengiriman,
  type KirimanLain,
  type PeringatanDobel,
  type TabSampel,
} from "./sampel-aturan";
import type { Tahap } from "./tahap";
import { umurHari } from "./tenggat";

/**
 * Kueri pengiriman sampel KOL (layar Sampel dan panel Pengiriman di detail
 * kolaborasi). Klien hanya boleh `import type` dari berkas ini.
 *
 * Tiga antrean:
 *   - Perlu dikirim  — kolaborasi DEAL / BRIEF_DIKIRIM yang belum punya paket berangkat
 *                      (satu baris per kolaborasi, beserta rencana barang atau
 *                      pengiriman yang belum berangkat);
 *   - Dalam perjalanan — paket berangkat yang belum diterima (satu baris per paket);
 *   - Sudah sampai   — paket diterima yang kontennya belum tayang.
 * Angka di setiap chip memakai saringan yang sama dengan daftarnya.
 */

const hari = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);

export type KolRingkas = {
  id: string;
  nama: string;
  handle: string | null;
  platform: string | null;
  waNormal: string | null;
  phone: string | null;
  recipientName: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
};

export type BarangSampel = {
  itemId: string;
  itemName: string;
  variantSku: string | null;
  variantLabel: string | null;
  qty: number;
  /** Barang bervarian di katalog tanpa varian dipilih — ukurannya harus dipilih sebelum berangkat. */
  perluVarian: boolean;
};

export type BarisPerluKirim = {
  kolaborasiId: string;
  docNo: string;
  tahap: Tahap;
  kol: KolRingkas;
  campaign: { id: string; nama: string } | null;
  /** Hari WIB kesepakatan (atau masuk tahap sekarang). */
  sejak: string;
  umurHari: number;
  /** Rencana sampel kolaborasi. */
  rencana: BarangSampel[];
  /** Pengiriman yang sudah dibuat tapi belum berangkat — resi di baris ini MENGUBAHNYA. */
  draf: { id: string; courier: string | null; trackingNo: string | null; shippingCost: number; baris: BarangSampel[] } | null;
  dobel: PeringatanDobel[];
};

export type BarisPengirimanSampel = {
  pengirimanId: string;
  kolaborasiId: string;
  docNo: string;
  tahap: Tahap;
  kol: KolRingkas;
  campaign: { id: string; nama: string } | null;
  courier: string | null;
  trackingNo: string | null;
  tanpaResi: boolean;
  sentAt: string | null;
  receivedAt: string | null;
  /** Hari sejak kirim (Dalam perjalanan) atau sejak terima (Sudah sampai). */
  umurHari: number;
  baris: BarangSampel[];
};

export type JumlahTabSampel = Record<TabSampel, number>;

export type DaftarSampel = {
  tab: TabSampel;
  /** Nomor kolaborasi yang disaring lewat `?kolaborasi=`, untuk chip "hanya …". */
  kolaborasiDisaring: { id: string; docNo: string } | null;
  perlu: BarisPerluKirim[];
  pengiriman: BarisPengirimanSampel[];
  jumlah: JumlahTabSampel;
  halaman: number;
  jumlahHalaman: number;
  total: number;
  ukuranHalaman: number;
  hariIni: string;
  ambang: Pick<AmbangKreatif, "dealKeKirimHari" | "kirimKeTerimaHari" | "terimaKeTayangHari">;
  /** Pilihan varian + stok tersedia untuk barang di halaman ini (pemilih varian di baris). */
  varianBarang: Record<string, PilihanVarianKirim>;
};

const PILIH_KOL = {
  id: true,
  name: true,
  waNormal: true,
  phone: true,
  recipientName: true,
  address: true,
  city: true,
  province: true,
  postalCode: true,
  accounts: { select: { platform: true, handle: true, followers: true } },
} as const;

type KolMentah = Prisma.KolGetPayload<{ select: typeof PILIH_KOL }>;

/** Akun utama = pengikut terbanyak (urutan tetap bila sama). */
function kolRingkas(k: KolMentah): KolRingkas {
  const utama = [...k.accounts].sort((a, b) => b.followers - a.followers || a.handle.localeCompare(b.handle))[0];
  return {
    id: k.id,
    nama: k.name,
    handle: utama?.handle ?? null,
    platform: utama ? String(utama.platform) : null,
    waNormal: k.waNormal,
    phone: k.phone,
    recipientName: k.recipientName,
    address: k.address,
    city: k.city,
    province: k.province,
    postalCode: k.postalCode,
  };
}

type SaringanSampel = { cari?: string | null; campaignId?: string | null; kolaborasiId?: string | null };

/**
 * Saringan kolaborasi: satu kolaborasi (tautan dari Hari ini), campaign, dan kata kunci
 * (nama/username KOL, nomor kolaborasi, campaign).
 */
function whereKolaborasi(s: SaringanSampel): Prisma.KolBriefWhereInput {
  const q = s.cari?.trim() ?? "";
  const handle = q.replace(/^@+/, "");
  return {
    ...(s.kolaborasiId ? { id: s.kolaborasiId } : {}),
    ...(s.campaignId ? { campaignId: s.campaignId } : {}),
    ...(q
      ? {
          OR: [
            { docNo: cariTeks(q) },
            { kol: { name: cariTeks(q) } },
            ...(handle ? [{ kol: { accounts: { some: { handle: cariTeks(handle) } } } }] : []),
            { campaign: { name: cariTeks(q) } },
          ],
        }
      : {}),
  };
}

function wherePerlu(s: SaringanSampel): Prisma.KolBriefWhereInput {
  return {
    AND: [
      { tahap: { in: [...TAHAP_PERLU_KIRIM] }, shipments: { none: { stockIssuedAt: { not: null } } } },
      whereKolaborasi(s),
    ],
  };
}

/** Paket berangkat + saringan; kata kunci juga mencocokkan nomor resi. */
function wherePaket(s: SaringanSampel, sampai: boolean): Prisma.KolShipmentWhereInput {
  const q = s.cari?.trim() ?? "";
  const kolab = whereKolaborasi({ campaignId: s.campaignId, kolaborasiId: s.kolaborasiId });
  return {
    AND: [
      { stockIssuedAt: { not: null }, receivedAt: sampai ? { not: null } : null },
      sampai ? { collab: { tahap: { in: [...TAHAP_TUNGGU_TAYANG] } } } : {},
      { collab: kolab },
      q ? { OR: [{ trackingNo: cariTeks(q.replace(/\s+/g, "")) }, { collab: whereKolaborasi({ cari: q }) }] } : {},
    ],
  };
}

type BarisMentah = { itemId: string; itemName: string; variantSku: string | null; qty: number };

/** Katalog + stok untuk barang-barang yang tampil, sekali jalan. */
async function infoBarang(itemIds: readonly string[]): Promise<{
  opsi: Map<string, { sku: string; label: string }[]>;
  varian: Record<string, PilihanVarianKirim>;
}> {
  const unik = [...new Set(itemIds)];
  const opsi = new Map<string, { sku: string; label: string }[]>();
  const varian: Record<string, PilihanVarianKirim> = {};
  if (unik.length === 0) return { opsi, varian };
  const [barang, stok] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: unik } }, select: { id: true, variants: true } }),
    prisma.inventoryValue.findMany({
      where: { itemId: { in: unik } },
      select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true },
    }),
  ]);
  for (const b of barang) {
    opsi.set(b.id, variantSelectOptions(parseItemVariants(b.variants)));
    varian[b.id] = susunVarianKirim(
      stok.filter((s) => s.itemId === b.id),
      b.variants,
    );
  }
  return { opsi, varian };
}

function keBarang(l: BarisMentah, opsi: Map<string, { sku: string; label: string }[]>, varian: Record<string, PilihanVarianKirim>): BarangSampel {
  const sku = l.variantSku?.trim() || null;
  const daftar = opsi.get(l.itemId) ?? [];
  const label = sku ? (daftar.find((o) => o.sku === sku)?.label ?? sku) : null;
  const pilihan = varian[l.itemId];
  return {
    itemId: l.itemId,
    itemName: l.itemName,
    variantSku: sku,
    variantLabel: label,
    qty: l.qty,
    perluVarian: !sku && (daftar.length > 0 || Boolean(pilihan?.perluVarian)),
  };
}

const PILIH_KOLABORASI = {
  id: true,
  docNo: true,
  tahap: true,
  tahapAt: true,
  dealAt: true,
  kolId: true,
  campaignId: true,
  campaign: { select: { id: true, name: true } },
  kol: { select: PILIH_KOL },
} as const;

export async function daftarSampel(opsi: {
  tab: TabSampel;
  cari?: string | null;
  campaignId?: string | null;
  /** Hanya satu kolaborasi (tautan "Kirim sampel"/"Tandai diterima" dari Hari ini). */
  kolaborasiId?: string | null;
  halaman?: number;
  ukuranHalaman?: number;
}): Promise<DaftarSampel> {
  const ukuran = opsi.ukuranHalaman ?? UKURAN_HALAMAN_SAMPEL;
  const s: SaringanSampel = { cari: opsi.cari, campaignId: opsi.campaignId, kolaborasiId: opsi.kolaborasiId };
  const hariIni = hariIniWib();

  const [ambang, nPerlu, nJalan, nSampai, disaring] = await Promise.all([
    bacaAmbangKreatif(),
    prisma.kolBrief.count({ where: wherePerlu(s) }),
    prisma.kolShipment.count({ where: wherePaket(s, false) }),
    prisma.kolShipment.count({ where: wherePaket(s, true) }),
    opsi.kolaborasiId
      ? prisma.kolBrief.findUnique({ where: { id: opsi.kolaborasiId }, select: { id: true, docNo: true } })
      : Promise.resolve(null),
  ]);
  const jumlah: JumlahTabSampel = { "perlu-dikirim": nPerlu, "dalam-perjalanan": nJalan, "sudah-sampai": nSampai };
  const total = jumlah[opsi.tab];
  const jumlahHalaman = Math.max(1, Math.ceil(total / ukuran));
  // Daftar menyusut saat dikerjakan: halaman yang sudah kosong jatuh ke halaman terakhir yang ada.
  const halaman = Math.min(Math.max(1, Math.floor(opsi.halaman ?? 1)), jumlahHalaman);

  const dasar = {
    tab: opsi.tab,
    kolaborasiDisaring: disaring,
    jumlah,
    halaman,
    jumlahHalaman,
    total,
    ukuranHalaman: ukuran,
    hariIni,
    ambang: {
      dealKeKirimHari: ambang.dealKeKirimHari,
      kirimKeTerimaHari: ambang.kirimKeTerimaHari,
      terimaKeTayangHari: ambang.terimaKeTayangHari,
    },
  };

  if (opsi.tab === "perlu-dikirim") {
    const rows = await prisma.kolBrief.findMany({
      where: wherePerlu(s),
      orderBy: [{ dealAt: "asc" }, { tahapAt: "asc" }, { id: "asc" }],
      skip: (halaman - 1) * ukuran,
      take: ukuran,
      select: {
        ...PILIH_KOLABORASI,
        items: { select: { itemId: true, itemName: true, variantSku: true, qty: true } },
        shipments: {
          where: { stockIssuedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          select: {
            id: true,
            courier: true,
            trackingNo: true,
            shippingCost: true,
            lines: { select: { itemId: true, itemName: true, variantSku: true, qty: true } },
          },
        },
      },
    });
    const info = await infoBarang(rows.flatMap((r) => [...r.items, ...(r.shipments[0]?.lines ?? [])].map((l) => l.itemId)));
    const dobel = await peringatanKirimDobel(rows.map((r) => r.id));
    const perlu: BarisPerluKirim[] = rows.map((r) => {
      const sejak = hari(r.dealAt ?? r.tahapAt)!;
      const d = r.shipments[0];
      return {
        kolaborasiId: r.id,
        docNo: r.docNo,
        tahap: r.tahap as Tahap,
        kol: kolRingkas(r.kol),
        campaign: r.campaign ? { id: r.campaign.id, nama: r.campaign.name } : null,
        sejak,
        umurHari: umurHari(sejak, hariIni),
        rencana: r.items.map((l) => keBarang(l, info.opsi, info.varian)),
        draf: d
          ? {
              id: d.id,
              courier: d.courier,
              trackingNo: d.trackingNo,
              shippingCost: Number(d.shippingCost),
              baris: d.lines.map((l) => keBarang(l, info.opsi, info.varian)),
            }
          : null,
        dobel: dobel.get(r.id) ?? [],
      };
    });
    return { ...dasar, perlu, pengiriman: [], varianBarang: info.varian };
  }

  const sampai = opsi.tab === "sudah-sampai";
  const rows = await prisma.kolShipment.findMany({
    where: wherePaket(s, sampai),
    orderBy: sampai ? [{ receivedAt: "asc" }, { id: "asc" }] : [{ sentAt: "asc" }, { id: "asc" }],
    skip: (halaman - 1) * ukuran,
    take: ukuran,
    select: {
      id: true,
      courier: true,
      trackingNo: true,
      sentAt: true,
      receivedAt: true,
      stockIssuedAt: true,
      lines: { select: { itemId: true, itemName: true, variantSku: true, qty: true } },
      collab: { select: PILIH_KOLABORASI },
    },
  });
  const info = await infoBarang(rows.flatMap((r) => r.lines.map((l) => l.itemId)));
  const pengiriman: BarisPengirimanSampel[] = rows.map((r) => {
    const kirim = hari(r.sentAt ?? r.stockIssuedAt);
    const terima = hari(r.receivedAt);
    const acuan = sampai ? terima : kirim;
    return {
      pengirimanId: r.id,
      kolaborasiId: r.collab.id,
      docNo: r.collab.docNo,
      tahap: r.collab.tahap as Tahap,
      kol: kolRingkas(r.collab.kol),
      campaign: r.collab.campaign ? { id: r.collab.campaign.id, nama: r.collab.campaign.name } : null,
      courier: r.courier,
      trackingNo: r.trackingNo,
      tanpaResi: tanpaNomorResi(r.trackingNo),
      sentAt: kirim,
      receivedAt: terima,
      umurHari: acuan ? umurHari(acuan, hariIni) : 0,
      baris: r.lines.map((l) => keBarang(l, info.opsi, info.varian)),
    };
  });
  return { ...dasar, perlu: [], pengiriman, varianBarang: info.varian };
}

/**
 * Peringatan kirim dobel untuk beberapa kolaborasi sekaligus: paket yang SUDAH
 * berangkat ke KOL yang sama, atau ke KOL lain dengan nomor WA yang sama, dari
 * kolaborasi lain — di campaign mana pun. Aturannya murni di `kirimDobel`.
 */
export async function peringatanKirimDobel(kolaborasiIds: readonly string[]): Promise<Map<string, PeringatanDobel[]>> {
  const hasil = new Map<string, PeringatanDobel[]>();
  const unik = [...new Set(kolaborasiIds.filter(Boolean))];
  if (unik.length === 0) return hasil;
  const kolab = await prisma.kolBrief.findMany({
    where: { id: { in: unik } },
    select: { id: true, kolId: true, campaignId: true, kol: { select: { waNormal: true } } },
  });
  const kolIds = [...new Set(kolab.map((k) => k.kolId))];
  const nomor = [...new Set(kolab.map((k) => k.kol.waNormal).filter((w): w is string => Boolean(w)))];
  const kiriman = await prisma.kolShipment.findMany({
    where: {
      stockIssuedAt: { not: null },
      collab: { OR: [{ kolId: { in: kolIds } }, ...(nomor.length ? [{ kol: { waNormal: { in: nomor } } }] : [])] },
    },
    select: {
      sentAt: true,
      stockIssuedAt: true,
      collab: {
        select: {
          id: true,
          docNo: true,
          kolId: true,
          campaignId: true,
          campaign: { select: { name: true } },
          kol: { select: { name: true, waNormal: true } },
        },
      },
    },
  });
  const lain: KirimanLain[] = kiriman.map((k) => ({
    kolaborasiId: k.collab.id,
    docNo: k.collab.docNo,
    kolId: k.collab.kolId,
    kolNama: k.collab.kol.name,
    waNormal: k.collab.kol.waNormal,
    campaignId: k.collab.campaignId,
    campaignNama: k.collab.campaign?.name ?? null,
    sentAt: hari(k.sentAt ?? k.stockIssuedAt),
  }));
  for (const k of kolab) {
    hasil.set(k.id, kirimDobel({ id: k.id, kolId: k.kolId, waNormal: k.kol.waNormal, campaignId: k.campaignId }, lain));
  }
  return hasil;
}

/* ───────────────────────── Panel Pengiriman (detail kolaborasi) ───────────────────────── */

export type PengirimanPanel = {
  id: string;
  courier: string | null;
  trackingNo: string | null;
  tanpaResi: boolean;
  sentAt: string | null;
  receivedAt: string | null;
  shippingCost: number;
  note: string | null;
  keadaan: KeadaanPengiriman;
  /** HPP yang disalin saat berangkat; nol selama belum berangkat. */
  baris: (BarangSampel & { unitCost: number })[];
  totalHpp: number;
};

export type DataPanelPengiriman = {
  kolaborasi: { id: string; docNo: string; tahap: Tahap; kol: KolRingkas; campaign: { id: string; nama: string } | null };
  rencana: BarangSampel[];
  pengiriman: PengirimanPanel[];
  dobel: PeringatanDobel[];
  varianBarang: Record<string, PilihanVarianKirim>;
  hariIni: string;
};

export async function dataPanelPengiriman(kolaborasiId: string): Promise<DataPanelPengiriman | null> {
  const c = await prisma.kolBrief.findUnique({
    where: { id: kolaborasiId },
    select: {
      ...PILIH_KOLABORASI,
      items: { select: { itemId: true, itemName: true, variantSku: true, qty: true } },
      shipments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          courier: true,
          trackingNo: true,
          sentAt: true,
          receivedAt: true,
          shippingCost: true,
          stockIssuedAt: true,
          note: true,
          lines: { select: { itemId: true, itemName: true, variantSku: true, qty: true, unitCost: true } },
        },
      },
    },
  });
  if (!c) return null;
  const info = await infoBarang([...c.items, ...c.shipments.flatMap((s) => s.lines)].map((l) => l.itemId));
  const dobel = await peringatanKirimDobel([c.id]);
  return {
    kolaborasi: {
      id: c.id,
      docNo: c.docNo,
      tahap: c.tahap as Tahap,
      kol: kolRingkas(c.kol),
      campaign: c.campaign ? { id: c.campaign.id, nama: c.campaign.name } : null,
    },
    rencana: c.items.map((l) => keBarang(l, info.opsi, info.varian)),
    pengiriman: c.shipments.map((s) => {
      const baris = s.lines.map((l) => ({ ...keBarang(l, info.opsi, info.varian), unitCost: Number(l.unitCost) }));
      return {
        id: s.id,
        courier: s.courier,
        trackingNo: s.trackingNo,
        tanpaResi: tanpaNomorResi(s.trackingNo),
        sentAt: hari(s.sentAt),
        receivedAt: hari(s.receivedAt),
        shippingCost: Number(s.shippingCost),
        note: s.note,
        keadaan: keadaanPengiriman(s),
        baris,
        totalHpp: Math.round(baris.reduce((t, b) => t + b.unitCost * b.qty, 0) * 100) / 100,
      };
    }),
    dobel: dobel.get(c.id) ?? [],
    varianBarang: info.varian,
    hariIni: hariIniWib(),
  };
}

/* ───────────────────────── Pemilih barang ───────────────────────── */

export type BarangPilihanSampel = {
  id: string;
  sku: string;
  nama: string;
  /** Katalog barang punya varian: ukurannya wajib dipilih. */
  bervarian: boolean;
  pilihan: PilihanVarianKirim;
};

/**
 * Barang jadi aktif untuk pemilih sampel, dicari di server (katalog bisa
 * ribuan), lengkap dengan pilihan varian dan stok tersedianya.
 */
export async function cariBarangSampel(cari: string, batas = 20): Promise<BarangPilihanSampel[]> {
  const q = cari.trim();
  if (!q) return [];
  const barang = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD", OR: [{ sku: cariTeks(q) }, { nameId: cariTeks(q) }] },
    orderBy: [{ nameId: "asc" }, { sku: "asc" }],
    take: Math.min(Math.max(batas, 1), 50),
    select: { id: true, sku: true, nameId: true, variants: true },
  });
  const stok = barang.length
    ? await prisma.inventoryValue.findMany({
        where: { itemId: { in: barang.map((b) => b.id) } },
        select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true },
      })
    : [];
  return barang.map((b) => ({
    id: b.id,
    sku: b.sku,
    nama: b.nameId,
    bervarian: variantSelectOptions(parseItemVariants(b.variants)).length > 0,
    pilihan: susunVarianKirim(
      stok.filter((s) => s.itemId === b.id),
      b.variants,
    ),
  }));
}

/* ───────────────────────── Ekspor alamat ───────────────────────── */

/** Batas baris ekspor — antrean kirim yang lebih panjang dari ini perlu disaring dulu. */
export const BATAS_EKSPOR_ALAMAT = 2000;

/** Baris "Daftar alamat kirim" untuk gudang: kolaborasi Perlu dikirim (semua halaman). */
export async function barisAlamatKirim(s: SaringanSampel): Promise<{ baris: BarisCsvAlamat[]; terpotong: boolean }> {
  const rows = await prisma.kolBrief.findMany({
    where: wherePerlu(s),
    orderBy: [{ dealAt: "asc" }, { tahapAt: "asc" }, { id: "asc" }],
    take: BATAS_EKSPOR_ALAMAT + 1,
    select: {
      docNo: true,
      campaign: { select: { name: true } },
      kol: { select: PILIH_KOL },
      items: { select: { itemId: true, itemName: true, variantSku: true, qty: true } },
      shipments: {
        where: { stockIssuedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { lines: { select: { itemId: true, itemName: true, variantSku: true, qty: true } } },
      },
    },
  });
  const dipakai = rows.slice(0, BATAS_EKSPOR_ALAMAT);
  const info = await infoBarang(dipakai.flatMap((r) => [...r.items, ...(r.shipments[0]?.lines ?? [])].map((l) => l.itemId)));
  return {
    terpotong: rows.length > BATAS_EKSPOR_ALAMAT,
    baris: dipakai.map((r) => {
      const barang = (r.shipments[0]?.lines ?? r.items).map((l) => keBarang(l, info.opsi, info.varian));
      return {
        name: r.kol.name,
        recipientName: r.kol.recipientName,
        waNormal: r.kol.waNormal,
        phone: r.kol.phone,
        address: r.kol.address,
        city: r.kol.city,
        province: r.kol.province,
        postalCode: r.kol.postalCode,
        docNo: r.docNo,
        campaignNama: r.campaign?.name ?? null,
        barang: barang.map((b) => ({ nama: b.itemName, varian: b.variantLabel, qty: b.qty })),
      };
    }),
  };
}

/** Campaign yang belum diarsip, untuk saringan layar Sampel. */
export async function pilihanCampaignSampel(): Promise<{ id: string; nama: string }[]> {
  const rows = await prisma.kolCampaign.findMany({
    where: { archivedAt: null },
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
    take: 500,
  });
  return rows.map((r) => ({ id: r.id, nama: r.name }));
}
