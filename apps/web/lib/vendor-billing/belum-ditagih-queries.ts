import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { grnBelumDiproses } from "@/lib/grn/grn-tanpa-po";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { billedQtyByGrnLine, billedQtyByWoStep, returnedQtyByGrnLine, unbookedReceiptQtyByWo } from "./billable";
import { grnLineKey, grnLineSource, readGrnLinesDetail } from "./bill-paid-rule";
import { belumDitagihLangkah, belumDitagihPerKunci, EPS_QTY, selisihHariKalender, type JenisSumberTagih } from "./belum-ditagih-aturan";
import { rincianLunasPerSumber } from "./supplier-paid";
import { permintaanTerbukaPerSumber } from "./permintaan-invoice-queries";

/*
 * Pembaca "Invoice belum ditagih" (Q18; 2026-10-29; P19; P52). KHUSUS SERVER. `bacaTagihanSumber` adalah
 * pembaca RAMPING yang dipakai di dalam transaksi (permintaan invoice, "tidak perlu invoice"): baris
 * sumber, keadaan prosesnya, qty yang ditagih, retur selesai, dan pembebasan yang berlaku — tanpa
 * jurnal dan tanpa alokasi. Nilai rupiahnya (`nilaiBelumDitagih`) membaca jurnal, jadi dihitung di
 * luar transaksi.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const round2 = (n: number) => Math.round(n * 100) / 100;

function potong<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export type KunciTagih = {
  /** `grnLineKey` untuk GRN; "" untuk langkah WO. */
  key: string;
  itemId: string | null;
  variantSku: string | null;
  label: string;
  diterima: number;
  diretur: number;
  ditagih: number;
  dibebaskan: number;
  neto: number;
  belum: number;
};

export type KeadaanSumberTagih = {
  jenis: JenisSumberTagih;
  id: string;
  supplierId: string;
  nomor: string;
  poNomor: string | null;
  /** grnDate, atau tanggal penerimaan barang jadi tertua yang pcs-nya belum ditagih. */
  tanggal: Date;
  /** Sumber yang tidak bisa ditagih lagi: GRN ditolak pemilik / PO dibatalkan / WO dibatalkan. */
  mati: boolean;
  terhalang: null | "MENUNGGU_PEMILIK" | "MENUNGGU_KONFIRMASI";
  kunci: KunciTagih[];
  belum: number;
  ditagih: number;
  dibebaskan: number;
  neto: number;
  /** Langkah WO: pcs belum ditagih dari penerimaan lama yang ongkos jahitnya belum pernah dibukukan. */
  qtyLama: number;
  hargaJasa: number | null;
};

async function pembebasan(db: Db, sumber: ReadonlyArray<{ jenis: JenisSumberTagih; id: string }>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sumber.length === 0) return out;
  const or: Prisma.SupplierInvoiceWaiverWhereInput[] = [];
  const grn = sumber.filter((s) => s.jenis === "GRN").map((s) => s.id);
  const step = sumber.filter((s) => s.jenis === "WO_STEP").map((s) => s.id);
  if (grn.length) or.push({ sourceType: "GRN", sourceId: { in: grn } });
  if (step.length) or.push({ sourceType: "WO_STEP", sourceId: { in: step } });
  const rows = await db.supplierInvoiceWaiver.findMany({ where: { cancelledAt: null, OR: or }, select: { sourceType: true, sourceId: true, itemId: true, variantSku: true, qty: true } });
  for (const r of rows) {
    const k = r.sourceType === "GRN" ? grnLineSource(r.sourceId, grnLineKey(r.itemId ?? "", r.variantSku)) : kunciDokumenHutang("WO_STEP", r.sourceId);
    out.set(k, round2((out.get(k) ?? 0) + Number(r.qty)));
  }
  return out;
}

/** Keadaan setiap sumber yang diminta, dikunci `kunciDokumenHutang(jenis, id)`. Sumber yang tidak ada tidak masuk peta. */
export async function bacaTagihanSumber(db: Db, sumber: ReadonlyArray<{ jenis: JenisSumberTagih; id: string }>): Promise<Map<string, KeadaanSumberTagih>> {
  const out = new Map<string, KeadaanSumberTagih>();
  const grnIds = [...new Set(sumber.filter((s) => s.jenis === "GRN").map((s) => s.id))];
  const stepIds = [...new Set(sumber.filter((s) => s.jenis === "WO_STEP").map((s) => s.id))];
  const bebas = await pembebasan(db, [...grnIds.map((id) => ({ jenis: "GRN" as const, id })), ...stepIds.map((id) => ({ jenis: "WO_STEP" as const, id }))]);

  for (const ids of potong(grnIds, 500)) {
    const grns = await db.gRN.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        docNumber: true,
        grnDate: true,
        supplierId: true,
        items: true,
        ownerDeclinedAt: true,
        requiresOwnerApproval: true,
        ownerApprovedAt: true,
        requiresNoPoConfirmation: true,
        noPoConfirmedAt: true,
        po: { select: { docNumber: true, status: true } },
      },
    });
    const [billed, returned] = await Promise.all([billedQtyByGrnLine(db, ids), returnedQtyByGrnLine(db, ids)]);
    const detail = new Map(grns.map((g) => [g.id, readGrnLinesDetail(g.items)]));
    const itemIds = [...new Set([...detail.values()].flatMap((d) => d.map((l) => l.itemId)))];
    const nama = new Map((itemIds.length ? await db.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true } }) : []).map((i) => [i.id, i.nameId]));
    for (const g of grns) {
      const perKey = new Map<string, { itemId: string; variantSku: string | null; qty: number }>();
      for (const l of detail.get(g.id) ?? []) {
        const cur = perKey.get(l.key) ?? { itemId: l.itemId, variantSku: l.variantSku, qty: 0 };
        cur.qty += l.qty;
        perKey.set(l.key, cur);
      }
      const kunci: KunciTagih[] = [];
      const bahan = [...perKey].map(([key, k]) => {
        const src = grnLineSource(g.id, key);
        return { key, k, diterima: round2(k.qty), diretur: returned.get(src) ?? 0, ditagih: billed.get(src) ?? 0, dibebaskan: bebas.get(src) ?? 0 };
      });
      const hitung = belumDitagihPerKunci(bahan);
      bahan.forEach((b, i) => {
        kunci.push({
          key: b.key,
          itemId: b.k.itemId,
          variantSku: b.k.variantSku,
          label: `${nama.get(b.k.itemId) ?? b.k.itemId}${b.k.variantSku ? ` · ${b.k.variantSku}` : ""}`,
          diterima: b.diterima,
          diretur: b.diretur,
          ditagih: b.ditagih,
          dibebaskan: b.dibebaskan,
          neto: hitung[i].neto,
          belum: hitung[i].belum,
        });
      });
      const jumlah = (f: keyof Pick<KunciTagih, "belum" | "ditagih" | "dibebaskan" | "neto">) => round2(kunci.reduce((s, k) => s + k[f], 0));
      out.set(kunciDokumenHutang("GRN", g.id), {
        jenis: "GRN",
        id: g.id,
        supplierId: g.supplierId,
        nomor: g.docNumber,
        poNomor: g.po?.docNumber ?? null,
        tanggal: g.grnDate,
        mati: g.ownerDeclinedAt != null || g.po?.status === "CANCELLED",
        terhalang: grnBelumDiproses(g) ? "MENUNGGU_KONFIRMASI" : g.requiresOwnerApproval && g.ownerApprovedAt == null ? "MENUNGGU_PEMILIK" : null,
        kunci,
        belum: jumlah("belum"),
        ditagih: jumlah("ditagih"),
        dibebaskan: jumlah("dibebaskan"),
        neto: jumlah("neto"),
        qtyLama: 0,
        hargaJasa: null,
      });
    }
  }

  for (const ids of potong(stepIds, 500)) {
    const steps = await db.workOrderStep.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        supplierId: true,
        sequence: true,
        stepName: true,
        qty: true,
        servicePrice: true,
        wo: { select: { id: true, docNumber: true, status: true, receipts: { select: { receivedAt: true, qtyAccepted: true }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] } } },
      },
    });
    const billed = await billedQtyByWoStep(db, ids);
    const unbooked = await unbookedReceiptQtyByWo(db, [...new Set(steps.map((s) => s.wo.id))]);
    for (const s of steps) {
      const diterima = Number(s.qty ?? 0);
      const ditagih = billed.get(s.id) ?? 0;
      const kunciDok = kunciDokumenHutang("WO_STEP", s.id);
      const dibebaskan = bebas.get(kunciDok) ?? 0;
      const l = belumDitagihLangkah({ qtyDiterima: diterima, qtyDitagih: ditagih, qtyDibebaskan: dibebaskan, qtyLamaBelumDibukukan: Math.max(0, (unbooked.get(s.wo.id) ?? 0) - ditagih) });
      let tertutup = ditagih + dibebaskan;
      let tanggal = s.wo.receipts[0]?.receivedAt ?? new Date();
      for (const r of s.wo.receipts) {
        const q = Number(r.qtyAccepted);
        if (q <= 0) continue;
        if (tertutup < q - EPS_QTY) {
          tanggal = r.receivedAt;
          break;
        }
        tertutup -= q;
      }
      const nomor = `${s.wo.docNumber} · ${s.sequence}${s.stepName ? ` ${s.stepName}` : ""}`;
      out.set(kunciDok, {
        jenis: "WO_STEP",
        id: s.id,
        supplierId: s.supplierId,
        nomor,
        poNomor: null,
        tanggal,
        mati: s.wo.status === "CANCELLED",
        terhalang: null,
        kunci: [{ key: "", itemId: null, variantSku: null, label: nomor, diterima, diretur: 0, ditagih, dibebaskan, neto: diterima, belum: l.qtyBelum }],
        belum: l.qtyBelum,
        ditagih,
        dibebaskan,
        neto: diterima,
        qtyLama: l.qtyLama,
        hargaJasa: Number(s.servicePrice),
      });
    }
  }
  return out;
}

/**
 * Nilai rupiah yang belum ditagih per sumber dan kunci (sen): utang tercatat per potong × pcs belum.
 * Pcs lama langkah WO (ongkos jahitnya belum pernah dibukukan) tidak bernilai (`null`). Membaca jurnal —
 * dipanggil DI LUAR transaksi.
 */
export async function nilaiBelumDitagih(db: Db, sumber: ReadonlyArray<KeadaanSumberTagih>): Promise<Map<string, { perKunciSen: Map<string, number>; totalSen: number; adaTakDiketahui: boolean }>> {
  const out = new Map<string, { perKunciSen: Map<string, number>; totalSen: number; adaTakDiketahui: boolean }>();
  const rinci = await rincianLunasPerSumber(db, {
    grnIds: sumber.filter((s) => s.jenis === "GRN").map((s) => s.id),
    woStepIds: sumber.filter((s) => s.jenis === "WO_STEP").map((s) => s.id),
  });
  for (const s of sumber) {
    const kunci = kunciDokumenHutang(s.jenis, s.id);
    const r = rinci.get(kunci);
    const perKunciSen = new Map<string, number>();
    let totalSen = 0;
    for (const k of s.kunci) {
      const qty = s.jenis === "WO_STEP" ? Math.max(0, k.belum - s.qtyLama) : k.belum;
      const n = Math.round(qty * (r?.perPotongSen.get(k.key) ?? 0));
      perKunciSen.set(k.key, n);
      totalSen += n;
    }
    out.set(kunci, { perKunciSen, totalSen, adaTakDiketahui: s.jenis === "WO_STEP" && s.qtyLama > EPS_QTY });
  }
  return out;
}

export type StatusBelumDitagih = "BELUM_DIMINTA" | "DIMINTA" | "TERLAMBAT";

export type BarisBelumDitagih = {
  /** `kunciDokumenHutang(jenis, id)`. */
  kunci: string;
  /** Kunci baris di layar: `<kunci>#<key barang>`. */
  baris: string;
  jenis: JenisSumberTagih;
  id: string;
  supplierId: string;
  supplierName: string;
  nomor: string;
  poNomor: string | null;
  tanggal: string;
  umurHari: number;
  itemId: string | null;
  variantSku: string | null;
  label: string;
  diterima: number;
  diretur: number;
  ditagih: number;
  dibebaskan: number;
  belum: number;
  qtyLama: number;
  nilaiSen: number | null;
  hargaNol: boolean;
  terhalang: KeadaanSumberTagih["terhalang"];
  status: StatusBelumDitagih;
  diminta: { requestId: string; tanggal: string; oleh: string } | null;
};

export type HasilBelumDitagih = {
  baris: BarisBelumDitagih[];
  ringkasan: Array<{ supplierId: string; supplierName: string; penerimaan: number; nilaiSen: number; terpotong: boolean }>;
};

const MAKS_BARIS_PER_PEMASOK = 500;

/** Sumber kandidat pemasok-pemasok ini: GRN yang tidak mati, dan langkah WO ber-qty pada WO yang tidak dibatalkan. */
async function kandidat(db: Db, supplierIds: string[] | null, jenis?: JenisSumberTagih): Promise<Array<{ jenis: JenisSumberTagih; id: string }>> {
  const saring = supplierIds ? { in: supplierIds } : undefined;
  const hasil: Array<{ jenis: JenisSumberTagih; id: string }> = [];
  if (jenis !== "WO_STEP") {
    const grns = await db.gRN.findMany({
      where: { ...(saring ? { supplierId: saring } : {}), ownerDeclinedAt: null, OR: [{ poId: null }, { po: { status: { not: "CANCELLED" } } }] },
      select: { id: true },
      orderBy: [{ grnDate: "asc" }, { id: "asc" }],
    });
    hasil.push(...grns.map((g) => ({ jenis: "GRN" as const, id: g.id })));
  }
  if (jenis !== "GRN") {
    const steps = await db.workOrderStep.findMany({
      where: { ...(saring ? { supplierId: saring } : {}), qty: { gt: 0 }, wo: { status: { not: "CANCELLED" } } },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    hasil.push(...steps.map((s) => ({ jenis: "WO_STEP" as const, id: s.id })));
  }
  return hasil;
}

/**
 * Setiap penerimaan yang masih punya pcs yang belum disebut invoice dan tidak dibebaskan, per GRN dan
 * kunci barang, atau per langkah WO. Tanpa saringan tanggal. Paling banyak 500 baris per pemasok
 * (ringkasannya menandai yang terpotong). `status` dari permintaan invoice terbuka yang menyebut
 * sumbernya.
 */
export async function daftarBelumDitagih(
  o: { supplierId?: string; supplierIds?: string[]; jenis?: JenisSumberTagih; status?: "belum" | "diminta" | "terlambat"; hariIni?: string },
  db: Db = prisma,
): Promise<HasilBelumDitagih> {
  const supplierIds = o.supplierIds ?? (o.supplierId ? [o.supplierId] : null);
  const hariIni = o.hariIni ?? hariIniWib();
  const sumber = await kandidat(db, supplierIds, o.jenis);
  const keadaan: KeadaanSumberTagih[] = [];
  for (const bagian of potong(sumber, 500)) {
    for (const k of (await bacaTagihanSumber(db, bagian)).values()) if (!k.mati && k.belum > EPS_QTY) keadaan.push(k);
  }
  const [nilai, terbuka, pemasok] = await Promise.all([
    nilaiBelumDitagih(db, keadaan),
    permintaanTerbukaPerSumber(db, keadaan.map((k) => kunciDokumenHutang(k.jenis, k.id)), hariIni),
    db.supplier.findMany({ where: { id: { in: [...new Set(keadaan.map((k) => k.supplierId))] } }, select: { id: true, name: true } }),
  ]);
  const namaPemasok = new Map(pemasok.map((p) => [p.id, p.name]));
  const semua: BarisBelumDitagih[] = [];
  for (const k of keadaan) {
    const kunci = kunciDokumenHutang(k.jenis, k.id);
    const v = nilai.get(kunci);
    const t = terbuka.get(kunci) ?? null;
    const tanggal = formatDateOnlyJakarta(k.tanggal);
    for (const x of k.kunci) {
      if (x.belum <= EPS_QTY) continue;
      const lamaSaja = k.jenis === "WO_STEP" && k.qtyLama >= x.belum - EPS_QTY;
      semua.push({
        kunci,
        baris: `${kunci}#${x.key}`,
        jenis: k.jenis,
        id: k.id,
        supplierId: k.supplierId,
        supplierName: namaPemasok.get(k.supplierId) ?? "",
        nomor: k.nomor,
        poNomor: k.poNomor,
        tanggal,
        umurHari: Math.max(0, selisihHariKalender(tanggal, hariIni)),
        itemId: x.itemId,
        variantSku: x.variantSku,
        label: x.label,
        diterima: x.diterima,
        diretur: x.diretur,
        ditagih: x.ditagih,
        dibebaskan: x.dibebaskan,
        belum: x.belum,
        qtyLama: k.jenis === "WO_STEP" ? k.qtyLama : 0,
        nilaiSen: lamaSaja ? null : v?.perKunciSen.get(x.key) ?? 0,
        hargaNol: k.jenis === "WO_STEP" && (k.hargaJasa ?? 0) <= 0,
        terhalang: k.terhalang,
        status: t ? (t.terlambat ? "TERLAMBAT" : "DIMINTA") : "BELUM_DIMINTA",
        diminta: t ? { requestId: t.requestId, tanggal: t.tanggal, oleh: t.oleh } : null,
      });
    }
  }
  const disaring = semua.filter((b) =>
    o.status === "belum" ? b.status === "BELUM_DIMINTA" : o.status === "diminta" ? b.status !== "BELUM_DIMINTA" : o.status === "terlambat" ? b.status === "TERLAMBAT" : true,
  );
  const perPemasok = new Map<string, { supplierId: string; supplierName: string; penerimaan: Set<string>; nilaiSen: number; baris: number; terpotong: boolean }>();
  const baris: BarisBelumDitagih[] = [];
  for (const b of disaring) {
    const r = perPemasok.get(b.supplierId) ?? { supplierId: b.supplierId, supplierName: b.supplierName, penerimaan: new Set<string>(), nilaiSen: 0, baris: 0, terpotong: false };
    r.penerimaan.add(b.kunci);
    r.nilaiSen += b.nilaiSen ?? 0;
    if (r.baris < MAKS_BARIS_PER_PEMASOK) {
      baris.push(b);
      r.baris += 1;
    } else r.terpotong = true;
    perPemasok.set(b.supplierId, r);
  }
  return {
    baris,
    ringkasan: [...perPemasok.values()]
      .map((r) => ({ supplierId: r.supplierId, supplierName: r.supplierName, penerimaan: r.penerimaan.size, nilaiSen: r.nilaiSen, terpotong: r.terpotong }))
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName, "id")),
  };
}

/**
 * Beranda: penerimaan yang masih punya pcs belum ditagih dan belum diminta invoice-nya (P19). Tanpa
 * `supplierIds` = semua pemasok; tes basis data membatasinya ke pemasok tesnya sendiri.
 */
export async function hitungPenerimaanBelumDiminta(asOf?: Date, supplierIds?: string[]): Promise<number> {
  const r = await daftarBelumDitagih({ status: "belum", supplierIds, hariIni: asOf ? formatDateOnlyJakarta(asOf) : undefined });
  return new Set(r.baris.filter((b) => b.terhalang == null).map((b) => b.kunci)).size;
}
