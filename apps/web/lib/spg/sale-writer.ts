import { moveStoreStock, Prisma } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { roundToWholeRupiah } from "@elorae/db/pricing";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { variantDetailForSku } from "@/lib/items/variants";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { bacaDiskonManual, KUNCI_DISKON_MANUAL } from "./pengaturan";
import { SPG_STORE_PRICING_SELECT, spgStorePricingFrom, spgUnitPrice } from "./pricing";
import { hitungPromoKonter, type AnggotaNota, type DiskonManual } from "./promo-konter";
import { promoKonterUntukToko } from "./promo-konter-queries";
import { anggotaUntukNota, awalPeriodeMember, tingkatUntukBelanja } from "./member";
import { bacaAturanMemberDb, belanjaBersihNomor } from "./member-queries";
import { daftarkanMemberDiTx } from "./member-writer";
import { ENTITAS_TITIP, JEJAK_TITIP, STATUS_TITIP_TERBUKA } from "./titip";
import { kunciBaris } from "./stok";
import { terhitungSesudah } from "./stok-writer";

export type SpgSaleLineInput = { itemId: string; variantSku: string | null; qty: number };

/**
 * Pembeli pada nota: pelanggan toko yang sudah ada (`id`), atau yang baru
 * dicatat di konter (nama + HP). Pelanggan baru WAJIB sudah setuju dihubungi
 * lewat WhatsApp — nomornya hanya disimpan kalau `setuju` benar.
 * `daftarMember` = pembeli setuju didaftarkan sebagai member Elorae di nota ini.
 */
export type PembeliNota = ({ id: string } | { nama: string; hp: string; setuju: boolean }) & { daftarMember?: boolean };

/** Kenapa pembeli yang minta didaftarkan tidak menjadi member (notanya tetap tercatat). */
export type AlasanTanpaMember = "PROGRAM_MATI" | "MEMBER_NONAKTIF" | "BELANJA_KURANG";

export type MemberNota = { tingkat: string; potongan: number; baru: boolean };

export type DiskonManualNota = DiskonManual & { alasan?: string | null };

export type KodeGagalJualSpg =
  | "EMPTY"
  | "STORE_NOT_FOUND"
  | "NO_PRICE"
  | "INSUFFICIENT_PAYMENT"
  | "DISKON_MANUAL_NONAKTIF"
  | "DISKON_MANUAL_LEWAT_BATAS"
  | "DISKON_MANUAL_TIDAK_VALID"
  | "ALASAN_DISKON_WAJIB"
  | "PELANGGAN_TIDAK_VALID"
  | "WAKTU_TIDAK_VALID";

export type RecordSpgSaleResult =
  | {
      ok: true;
      spgSaleId: string;
      docNo: string;
      changeGiven: number;
      total: number;
      member?: MemberNota | null;
      tanpaMember?: AlasanTanpaMember | null;
    }
  | { ok: false; code: KodeGagalJualSpg };

/** Penjualan tanpa sinyal yang lebih tua dari ini ditolak, bukan dicatat diam-diam. */
export const BATAS_UMUR_LURING_HARI = 14;

function mergeLines(lines: SpgSaleLineInput[]): SpgSaleLineInput[] {
  const map = new Map<string, SpgSaleLineInput>();
  for (const l of lines) {
    if (l.qty <= 0) continue;
    const key = `${l.itemId}::${l.variantSku ?? ""}`;
    const e = map.get(key);
    if (e) e.qty += l.qty;
    else map.set(key, { itemId: l.itemId, variantSku: l.variantSku, qty: l.qty });
  }
  return Array.from(map.values());
}

/**
 * Waktu jual nota. Penjualan di konter = sekarang. Penjualan dari antrean HP
 * (tanpa sinyal) membawa waktu jualnya sendiri, supaya nota, laporan tutup hari,
 * target, dan komisi jatuh di hari barang benar-benar terjual — bukan hari
 * sinyalnya kembali. Jam HP yang maju dijepit ke sekarang.
 */
export function tentukanWaktuJual(waktuJual: Date | null | undefined, sekarang: Date): Date | null {
  if (!waktuJual) return sekarang;
  const t = waktuJual.getTime();
  if (!Number.isFinite(t)) return null;
  // Jam HP yang maju tidak membuat nota "dari masa depan".
  if (t > sekarang.getTime()) return sekarang;
  if (t < sekarang.getTime() - BATAS_UMUR_LURING_HARI * 86_400_000) return null;
  return waktuJual;
}

export type InputJualSpg = {
  salesmanId: string;
  storeId: string;
  createdById?: string;
  lines: SpgSaleLineInput[];
  cashReceived?: number;
  saleLat?: number | null;
  saleLng?: number | null;
  note?: string;
  idempotencyKey?: string;
  pembeli?: PembeliNota | null;
  diskonManual?: DiskonManualNota | null;
  /** Hanya untuk penjualan dari antrean HP; diabaikan kalau `luring` tidak benar. */
  waktuJual?: Date | null;
  luring?: boolean;
  visitId?: string | null;
  sekarang?: Date;
};

/**
 * Catat penjualan SPG di konter — POS terminal, tanpa persetujuan, seperti
 * recordVanSale (apps/web/lib/canvassing/sale-writer.ts).
 *
 * Barangnya sudah DI toko, jadi stok gudang tidak pernah disentuh: tanpa
 * VanStock, InventoryValue, atau StockAdjustment. Yang bergerak adalah buku
 * stok toko — satu `StoreStockMovement` JUAL (−qty) per baris (dan, di toko
 * konsinyasi, kartu `StoreStock`), di transaksi yang sama, sehingga nota yang dikirim ulang (kunci idempotensi) tidak
 * memotong dua kali. Saldo toko boleh negatif; penjualan tidak pernah ditolak
 * karenanya (barangnya sungguh terjual), opname toko yang meluruskan.
 *
 * Harga, promo konter, dan diskon manual dihitung DI SINI dari data server
 * (`hitungPromoKonter`); layar hanya menampilkan pratinjau dengan aturan yang
 * sama. `unitPrice` = harga sebelum potongan; `lineTotal` dan `total` = bersih.
 * Harga dasarnya adalah harga di toko (`spgUnitPrice`): di toko konsinyasi
 * itu harga jual Elorae dinaikkan markup toko, bukan harga putus. Total yang
 * ditagih dibulatkan ke rupiah utuh; `subtotal` tetap jumlah persisnya.
 *
 * Penjualan dari antrean HP (`luring`) dicatat pada waktu jualnya. Barang yang
 * sudah dihitung di opname toko SESUDAH waktu itu tidak mendapat baris buku
 * JUAL — opname sudah melihat raknya tanpa barang tersebut, jadi memotongnya
 * lagi berarti memotong dua kali (semangat yang sama dengan nota retur SPG yang
 * tertinggal di belakang opname, tapi per barang dan per detik).
 */
export async function recordSpgSale(input: InputJualSpg): Promise<RecordSpgSaleResult> {
  // Tolakan yang tidak butuh basis data dijawab tanpa membuka transaksi.
  if (mergeLines(input.lines).length === 0) return { ok: false, code: "EMPTY" };
  // `sekarang` ditetapkan SEKALI di luar transaksi: percobaan ulang memakai jam yang sama.
  const sekarang = input.sekarang ?? new Date();
  if (!tentukanWaktuJual(input.luring ? input.waktuJual : null, sekarang)) return { ok: false, code: "WAKTU_TIDAK_VALID" };
  return runSerializable((tx) => recordSpgSaleTx(tx, { ...input, sekarang }));
}

/**
 * Badan transaksi `recordSpgSale` — satu aturan harga, promo, pelanggan, dan
 * buku stok untuk setiap nota SPG. Pemanggil WAJIB menjalankannya di dalam
 * `runSerializable`; kait sesudah transaksi tetap urusan pemanggil.
 */
export async function recordSpgSaleTx(tx: Prisma.TransactionClient, input: InputJualSpg): Promise<RecordSpgSaleResult> {
  const merged = mergeLines(input.lines);
  if (merged.length === 0) return { ok: false, code: "EMPTY" };
  const sekarang = input.sekarang ?? new Date();
  const waktu = tentukanWaktuJual(input.luring ? input.waktuJual : null, sekarang);
  if (!waktu) return { ok: false, code: "WAKTU_TIDAK_VALID" };

  const manual = input.diskonManual && input.diskonManual.nilai > 0 ? input.diskonManual : null;
  const alasanManual = manual?.alasan?.trim() || null;

  if (input.idempotencyKey) {
    const existing = await tx.spgSale.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, docNo: true, changeGiven: true, total: true },
    });
    if (existing) {
      return { ok: true, spgSaleId: existing.id, docNo: existing.docNo, changeGiven: Number(existing.changeGiven), total: Number(existing.total) };
    }
  }

  const store = await tx.store.findUnique({ where: { id: input.storeId }, select: SPG_STORE_PRICING_SELECT });
  if (!store) return { ok: false, code: "STORE_NOT_FOUND" };
  const pricing = spgStorePricingFrom(store);

  // Harga + data barang per baris = harga yang dibayar pembeli DI toko ini
  // (`spgUnitPrice`): toko putus harga jual Elorae dikurangi diskon harga toko,
  // toko konsinyasi harga jual dinaikkan markup toko. Toko konsinyasi tanpa
  // markup yang sah menolak NO_PRICE — bukan dijual di harga katalog yang
  // diam-diam terlalu murah. Katalog HP memakai fungsi yang sama.
  const itemIds = Array.from(new Set(merged.map((l) => l.itemId)));
  const items = await tx.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, sku: true, nameId: true, sellingPrice: true, variants: true, categoryId: true, category: { select: { name: true } } },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  type Priced = { line: SpgSaleLineInput; item: (typeof items)[number]; unitPrice: number; key: string };
  const priced: Priced[] = [];
  for (const l of merged) {
    const item = itemById.get(l.itemId);
    if (!item) return { ok: false, code: "NO_PRICE" };
    const price = spgUnitPrice(pricing, item.sellingPrice === null ? null : Number(item.sellingPrice));
    if (price === null) return { ok: false, code: "NO_PRICE" };
    priced.push({ line: l, item, unitPrice: price, key: `${l.itemId}::${l.variantSku ?? ""}` });
  }

  // Promo konter + diskon manual — aturan murni yang sama dengan pratinjau HP.
  const [promos, setelanManual] = await Promise.all([
    promoKonterUntukToko(input.storeId, waktu, tx),
    tx.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL }, select: { value: true } }),
  ]);
  const aturanManual = bacaDiskonManual(setelanManual?.value);
  if (manual && aturanManual.alasanWajib && !alasanManual) return { ok: false, code: "ALASAN_DISKON_WAJIB" };

  // Pembeli: pelanggan toko ini saja; pelanggan baru dicatat sekali per nomor.
  // Di sini hanya DIBACA — penulisannya sesudah nota lolos semua tolakan.
  const olehId = input.createdById ?? input.salesmanId;
  let pembeli: { customerId: string | null; nama: string; phone: string } | null = null;
  if (input.pembeli) {
    if ("id" in input.pembeli) {
      const ada = await tx.storeCustomer.findFirst({ where: { id: input.pembeli.id, storeId: input.storeId }, select: { id: true, name: true, phone: true } });
      if (!ada) return { ok: false, code: "PELANGGAN_TIDAK_VALID" };
      pembeli = { customerId: ada.id, nama: ada.name, phone: ada.phone };
    } else {
      const nama = input.pembeli.nama.trim();
      const hp = nomorWhatsApp(input.pembeli.hp);
      if (!nama || nama.length > 100 || !hp || !input.pembeli.setuju) return { ok: false, code: "PELANGGAN_TIDAK_VALID" };
      const ada = await tx.storeCustomer.findUnique({ where: { storeId_phone: { storeId: input.storeId, phone: hp } }, select: { id: true, name: true } });
      pembeli = { customerId: ada?.id ?? null, nama: ada?.name ?? nama, phone: hp };
    }
  }

  // Member: dikenali dari nomornya di toko mana pun. Tingkat dari belanja bersih
  // nomor itu sebelum nota ini, dalam jendela pengaturan member.
  const aturanMember = pembeli ? await bacaAturanMemberDb(tx) : null;
  let calonMember: { memberId: string | null; daftar: boolean; tanpa: AlasanTanpaMember | null } | null = null;
  let anggota: AnggotaNota | null = null;
  if (pembeli && aturanMember) {
    const m = await tx.member.findUnique({ where: { phone: pembeli.phone }, select: { id: true, isActive: true } });
    const mintaDaftar = input.pembeli?.daftarMember === true;
    if (m?.isActive) calonMember = { memberId: m.id, daftar: false, tanpa: null };
    else if (m && mintaDaftar) calonMember = { memberId: null, daftar: false, tanpa: "MEMBER_NONAKTIF" };
    else if (!m && mintaDaftar) calonMember = aturanMember.aktif ? { memberId: null, daftar: true, tanpa: null } : { memberId: null, daftar: false, tanpa: "PROGRAM_MATI" };
    if (calonMember && (calonMember.memberId || calonMember.daftar)) {
      const belanja = await belanjaBersihNomor(tx, pembeli.phone, awalPeriodeMember(waktu, aturanMember.periodeBulan), waktu);
      anggota = anggotaUntukNota(tingkatUntukBelanja(belanja, aturanMember), aturanMember);
    }
  }

  const dasarPromo = {
    baris: priced.map((p) => ({ key: p.key, itemId: p.item.id, categoryId: p.item.categoryId, qty: p.line.qty, unitPrice: p.unitPrice })),
    promos,
    storeId: input.storeId,
    waktu,
    diskonManual: manual ? { jenis: manual.jenis, nilai: manual.nilai } : null,
    aturanManual,
  };
  const hitungAwal = hitungPromoKonter({ ...dasarPromo, anggota });
  if (!hitungAwal.ok) return { ok: false, code: hitungAwal.code };
  let promo = hitungAwal;

  // Pendaftaran di nota ini butuh nilai nota minimal (sebelum diskon member).
  // Kalau tidak tercapai, nota tetap tercatat — tanpa member dan tanpa harga member.
  let tanpaMember: AlasanTanpaMember | null = calonMember?.tanpa ?? null;
  let daftarkan = calonMember?.daftar === true;
  if (daftarkan && promo.total + (promo.member?.potongan ?? 0) < aturanMember!.minBelanjaDaftar) {
    daftarkan = false;
    tanpaMember = "BELANJA_KURANG";
    const ulang = hitungPromoKonter({ ...dasarPromo, anggota: null });
    if (!ulang.ok) return { ok: false, code: ulang.code };
    promo = ulang;
  }
  const hasilBaris = new Map(promo.baris.map((b) => [b.key, b]));

  const displayName = (p: Priced) => {
    const label = variantDetailForSku(p.item.variants, p.line.variantSku);
    return label ? `${p.item.nameId} — ${label}` : p.item.nameId;
  };

  // Total yang ditagih = rupiah utuh (uang di konter tidak bersen); `subtotal` tetap jumlah persisnya.
  const total = roundToWholeRupiah(promo.total);
  const cashReceived = input.cashReceived ?? total;
  if (cashReceived < total) return { ok: false, code: "INSUFFICIENT_PAYMENT" };
  const changeGiven = cashReceived - total;

  // Pelanggan baru dan member baru baru DITULIS sesudah semua tolakan di atas:
  // transaksi ini selesai normal walau nota ditolak, jadi tulisan lebih awal
  // akan tertinggal tanpa notanya.
  let customerId: string | null = pembeli?.customerId ?? null;
  if (pembeli && !customerId) {
    customerId = (
      await tx.storeCustomer.create({
        data: { storeId: input.storeId, name: pembeli.nama, phone: pembeli.phone, consentAt: sekarang, createdById: olehId },
        select: { id: true },
      })
    ).id;
  }
  let memberId = calonMember?.memberId ?? null;
  if (daftarkan && pembeli) {
    // Keadaan nomor sudah dibaca di transaksi ini (belum member, program nyala),
    // jadi pendaftaran berhasil; balapan dengan pendaftaran lain diulang oleh runSerializable.
    const daftar = await daftarkanMemberDiTx(tx, { phone: pembeli.phone, nama: pembeli.nama, storeId: input.storeId, userId: olehId, sekarang, sumber: "NOTA" });
    if (daftar.ok) memberId = daftar.id;
    else tanpaMember = daftar.code;
  }

  const docNo = await generateDocNumber("SPGSALE", tx);
  const sale = await tx.spgSale.create({
    data: {
      docNo,
      salesmanId: input.salesmanId,
      storeId: input.storeId,
      createdById: input.createdById ?? input.salesmanId,
      saleLat: input.saleLat == null ? null : new Prisma.Decimal(input.saleLat),
      saleLng: input.saleLng == null ? null : new Prisma.Decimal(input.saleLng),
      subtotal: promo.subtotal,
      total,
      discountTotal: promo.potonganTotal,
      orderPromoId: promo.promoNota?.id ?? null,
      orderPromoName: promo.promoNota?.name ?? null,
      orderDiscount: promo.promoNota?.potongan ?? 0,
      manualDiscount: promo.diskonManual,
      manualDiscountReason: promo.diskonManual > 0 ? alasanManual : null,
      customerId,
      memberId,
      memberTier: memberId ? (promo.member?.tingkat ?? null) : null,
      memberDiscount: memberId ? (promo.member?.potongan ?? 0) : 0,
      visitId: input.visitId ?? null,
      capturedOffline: Boolean(input.luring),
      syncedAt: input.luring ? sekarang : null,
      cashReceived,
      changeGiven,
      note: input.note,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: waktu,
      lines: {
        create: priced.map((p) => {
          const h = hasilBaris.get(p.key);
          return {
            itemId: p.line.itemId,
            variantSku: p.line.variantSku ?? "",
            productName: displayName(p),
            qty: p.line.qty,
            unitPrice: p.unitPrice,
            lineTotal: h ? h.bersih : p.line.qty * p.unitPrice,
            discount: h ? h.potongan : 0,
            storeDiscount: h ? h.potonganToko : 0,
            counterPromoId: h?.promoId ?? null,
            promoName: h?.promoName ?? null,
          };
        }),
      },
    },
    select: { id: true, lines: { select: { id: true, itemId: true, variantSku: true } } },
  });

  // Rincian potongan per promo per baris — dasar laporan efektivitas promo.
  const idBaris = new Map(sale.lines.map((l) => [`${l.itemId}::${l.variantSku}`, l.id]));
  const rincian = priced.flatMap((p) =>
    (hasilBaris.get(p.key)?.rincian ?? []).map((r) => ({
      spgSaleId: sale.id,
      spgSaleLineId: idBaris.get(`${p.line.itemId}::${p.line.variantSku ?? ""}`) ?? null,
      promoId: r.promoId,
      promoName: r.name,
      kind: r.kind,
      qty: r.qty,
      discount: r.potongan,
      storeDiscount: r.potonganToko,
      createdAt: waktu,
    })),
  );
  if (rincian.length > 0) await tx.spgSalePromo.createMany({ data: rincian });

  const rows = buildOfflineSalesHistoryRows({
    orderNo: docNo,
    orderTotal: total,
    lines: priced.map((p) => ({
      itemId: p.line.itemId,
      variantSku: p.line.variantSku ?? "",
      parentSku: p.item.sku,
      productName: displayName(p),
      qty: p.line.qty,
      unitPrice: p.unitPrice,
      lineTotal: hasilBaris.get(p.key)?.bersih ?? p.line.qty * p.unitPrice,
      productCategory: p.item.category?.name ?? null,
    })),
  }).map((r) => ({
    ...r,
    // Harga satuan sesudah potongan = nilai bersih baris ÷ jumlah, supaya
    // laporan penjualan membaca harga yang sungguh dibayar pembeli.
    unitPriceAfterDiscount: r.quantity > 0 ? Math.round((r.lineTotal / r.quantity) * 100) / 100 : r.unitPrice,
    orderDate: waktu,
    completedDate: waktu,
  }));
  await tx.salesHistory.createMany({ data: rows });

  // Barang yang sudah DIHITUNG di opname SESUDAH waktu jual tidak dipotong lagi:
  // opname itu sudah melihat raknya tanpa barang ini. Per barang dan per waktu
  // hitung BARIS, bukan waktu opname disimpan — barang yang terjual sesudah
  // dihitung tapi sebelum opname disimpan tetap dipotong.
  const sudahDihitung = input.luring ? await terhitungSesudah(tx, input.storeId, itemIds, waktu) : new Set<string>();
  const bukuBaris = priced.filter((p) => !sudahDihitung.has(kunciBaris(p.line.itemId, p.line.variantSku)));
  if (bukuBaris.length > 0) {
    await tx.storeStockMovement.createMany({
      data: bukuBaris.map((p) => ({
        storeId: input.storeId,
        itemId: p.line.itemId,
        variantSku: p.line.variantSku ?? "",
        qty: -p.line.qty,
        kind: "JUAL" as const,
        refType: "SpgSale",
        refId: sale.id,
        createdById: olehId,
        createdAt: waktu,
      })),
    });
  }

  /*
   * Toko konsinyasi: barangnya keluar dari toko saat terjual, jadi kartu stok
   * toko (`StoreStock`) ikut bergerak di transaksi yang sama — tidak pernah
   * dijepit atau ditolak walau saldonya jadi negatif. Toko putus tidak punya
   * baris StoreStock (barangnya milik toko).
   */
  if (store.termsType === "KONSI") {
    for (const p of priced) {
      await moveStoreStock(tx, {
        storeId: input.storeId,
        itemId: p.line.itemId,
        variantSku: p.line.variantSku,
        qtyDelta: -p.line.qty,
        refType: "SpgSale" satisfies StockLedgerRefType,
        refId: sale.id,
        refDocNumber: docNo,
        createdById: olehId,
      });
    }
  }

  if (customerId) {
    // Titip pesan pembeli ini yang barangnya ikut terjual di nota ini selesai
    // sendiri — termasuk permintaan "ukuran mana pun" (variantSku "") untuk
    // barang itu. Setiap penutupan meninggalkan jejaknya.
    const terbuka = await tx.customerRequest.findMany({
      where: {
        storeId: input.storeId,
        customerId,
        status: { in: [...STATUS_TITIP_TERBUKA] },
        itemId: { in: itemIds },
      },
      select: { id: true, itemId: true, variantSku: true, status: true },
    });
    const terjual = new Set(priced.map((p) => `${p.line.itemId}::${p.line.variantSku ?? ""}`));
    const kena = terbuka.filter((r) => r.itemId && (r.variantSku === "" || terjual.has(`${r.itemId}::${r.variantSku}`)));
    if (kena.length > 0) {
      const olehId = input.createdById ?? input.salesmanId;
      await tx.customerRequest.updateMany({
        where: { id: { in: kena.map((r) => r.id) }, status: { in: [...STATUS_TITIP_TERBUKA] } },
        data: { status: "SELESAI", closedAt: sekarang, closedById: olehId, spgSaleId: sale.id },
      });
      await tx.auditLog.createMany({
        data: kena.map((r) => ({
          userId: olehId,
          action: JEJAK_TITIP.SELESAI,
          entityType: ENTITAS_TITIP,
          entityId: r.id,
          changes: { before: { status: r.status }, after: { status: "SELESAI", spgSaleId: sale.id } },
          metadata: { otomatis: true, docNo },
        })),
      });
    }
  }

  return {
    ok: true,
    spgSaleId: sale.id,
    docNo,
    changeGiven,
    total,
    member: memberId && promo.member ? { tingkat: promo.member.tingkat, potongan: promo.member.potongan, baru: daftarkan } : null,
    tanpaMember,
  };
}
