/*
 * Dari jurnal ke dokumen sumbernya. Murni (tanpa Prisma) supaya bisa dipakai
 * di komponen klien dan dites. Nomor dokumennya dicari `info-dokumen.ts`.
 *
 * Satu tempat untuk alamat setiap jenis sumber jurnal otomatis — jenis baru di
 * `generateAutoJournal` perlu baris di `tautanDokumenSumber`.
 */

/**
 * Jenis sumber jurnal otomatis — pilihan saringan "Sumber" di halaman Jurnal.
 * Labelnya `financeJournals.sourceTypes.<JENIS>`.
 */
export const JENIS_SUMBER_JURNAL = [
  "SALESORDER_REVENUE",
  "SALESORDER_COGS",
  "SALESRETURN_REVENUE",
  "SALESRETURN_COGS",
  "SETTLEMENT",
  "GRN",
  "GRN_REVERSAL",
  "FG_RECEIPT",
  "OPNAME",
  "VAN_LOAD",
  "VAN_SALE",
  "VAN_RECONCILE",
  "SUPPLIER_PAYMENT",
  "SUPPLIER_PAYMENT_REVERSAL",
] as const;

/** Nilai `?source=` → saringan kueri; nilai tak dikenal tidak menyaring apa pun. */
export function saringanSumber(source: string | undefined): { manualOnly?: true; sourceType?: string } {
  if (source === "manual") return { manualOnly: true };
  if (source && (JENIS_SUMBER_JURNAL as readonly string[]).includes(source)) return { sourceType: source };
  return {};
}

/** Data induk untuk dokumen yang tidak punya halaman sendiri. */
export type IndukDokumen = {
  poId?: string | null;
  woId?: string | null;
  canvasserId?: string | null;
};

/** Pembayaran pemasok ber-sourceId `poId#generasi`; jenis lain memakai sourceId apa adanya. */
export function idDokumenDariSumber(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  if (sourceType === "SUPPLIER_PAYMENT" || sourceType === "SUPPLIER_PAYMENT_REVERSAL") {
    const poId = sourceId.split("#")[0];
    return poId ? poId : null;
  }
  return sourceId;
}

export function kunciDokumen(jenis: string, id: string): string {
  return `${jenis}|${id}`;
}

function seg(id: string): string {
  return encodeURIComponent(id);
}

/** Halaman dokumen sumber; null bila jenisnya tidak dikenal (jangan menebak alamat). */
export function tautanDokumenSumber(
  jenis: string | null,
  id: string | null,
  induk: IndukDokumen = {},
): string | null {
  if (!jenis || !id) return null;
  switch (jenis) {
    case "SETTLEMENT":
      return `/backoffice/finance/settlements/${seg(id)}`;
    case "OPNAME":
      return `/backoffice/inventory/stock-opname/${seg(id)}`;
    case "GRN":
    case "GRN_REVERSAL":
      // Penerimaan barang tidak punya halaman sendiri: tampil di PO-nya, atau di tab GRN.
      return induk.poId ? `/backoffice/purchase-orders/${seg(induk.poId)}` : "/backoffice/inventory?tab=grn";
    case "FG_RECEIPT":
      return induk.woId ? `/backoffice/work-orders/${seg(induk.woId)}` : "/backoffice/work-orders";
    case "SALESORDER_REVENUE":
    case "SALESORDER_COGS":
      return `/backoffice/sales-orders/${seg(id)}`;
    case "SALESRETURN_REVENUE":
    case "SALESRETURN_COGS":
      return `/backoffice/returns/${seg(id)}`;
    case "VAN_LOAD":
      // Muatan van tampil di halaman van kanvasernya.
      return induk.canvasserId ? `/backoffice/canvassing/${seg(induk.canvasserId)}` : "/backoffice/canvassing";
    case "VAN_SALE":
      return `/backoffice/van-sales/${seg(id)}`;
    case "VAN_RECONCILE":
      return `/backoffice/canvassing/reconcile/${seg(id)}`;
    case "SUPPLIER_PAYMENT":
    case "SUPPLIER_PAYMENT_REVERSAL":
      return `/backoffice/purchase-orders/${seg(id)}`;
    default:
      return null;
  }
}

function duaDigit(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Bulan kalender WIB yang memuat tanggal jurnal, sebagai isian `from`/`to`
 * buku besar akun ("YYYY-MM-DD"). Dipakai tautan akun di rincian jurnal.
 */
export function rentangBulanWib(iso: string): { dari: string; sampai: string } | null {
  const waktu = new Date(iso).getTime();
  if (Number.isNaN(waktu)) return null;
  // WIB = UTC+7 tanpa musim panas, jadi geser lalu baca komponen UTC.
  const wib = new Date(waktu + 7 * 60 * 60 * 1000);
  const tahun = wib.getUTCFullYear();
  const bulan = wib.getUTCMonth() + 1;
  const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  return {
    dari: `${tahun}-${duaDigit(bulan)}-01`,
    sampai: `${tahun}-${duaDigit(bulan)}-${duaDigit(hariTerakhir)}`,
  };
}

/**
 * Buku besar satu akun pada periode yang sama dengan laporan/jurnal asalnya.
 * `dari` null = sejak awal.
 */
export function tautanBukuBesar(accountId: string, rentang?: { dari: string | null; sampai: string }): string {
  const dasar = `/backoffice/finance/journals/ledger/${encodeURIComponent(accountId)}`;
  if (!rentang) return dasar;
  const qs = new URLSearchParams();
  if (rentang.dari) qs.set("from", rentang.dari);
  qs.set("to", rentang.sampai);
  return `${dasar}?${qs.toString()}`;
}
