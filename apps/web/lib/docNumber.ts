import { DocType } from "@elorae/db";
import { prisma, Prisma, sqlId } from "@elorae/db";

const DEFAULT_CONFIGS: Record<
  DocType,
  { prefix: string; resetPeriod: "YEARLY" | "MONTHLY"; padding: number }
> = {
  PO: { prefix: "PO/", resetPeriod: "YEARLY", padding: 4 },
  GRN: { prefix: "GRN/", resetPeriod: "MONTHLY", padding: 4 },
  WO: { prefix: "WO/", resetPeriod: "YEARLY", padding: 4 },
  ADJ: { prefix: "ADJ/", resetPeriod: "MONTHLY", padding: 4 },
  RET: { prefix: "RET/", resetPeriod: "MONTHLY", padding: 4 },
  ISSUE: { prefix: "ISS/", resetPeriod: "MONTHLY", padding: 4 },
  RECEIPT: { prefix: "RCPT/", resetPeriod: "MONTHLY", padding: 4 },
  OPN: { prefix: "OPN/", resetPeriod: "MONTHLY", padding: 4 },
  PUTUS: { prefix: "PUTUS/", resetPeriod: "YEARLY", padding: 4 },
  KONSI: { prefix: "KONSI/", resetPeriod: "YEARLY", padding: 4 },
  VANLOAD: { prefix: "VLOAD/", resetPeriod: "YEARLY", padding: 4 },
  VANSALE: { prefix: "VSALE/", resetPeriod: "YEARLY", padding: 4 },
  VANRECON: { prefix: "VRCN/", resetPeriod: "YEARLY", padding: 4 },
  SPGSALE: { prefix: "SPG/", resetPeriod: "YEARLY", padding: 4 },
  DELIVERY: { prefix: "DLV/", resetPeriod: "MONTHLY", padding: 4 },
  CASHOUT: { prefix: "BKK/", resetPeriod: "MONTHLY", padding: 4 },
  CASHIN: { prefix: "BKMK/", resetPeriod: "MONTHLY", padding: 4 },
  CASHTRF: { prefix: "TRF/", resetPeriod: "MONTHLY", padding: 4 },
  SUPPAY: { prefix: "BYR/", resetPeriod: "MONTHLY", padding: 4 },
  ASSET: { prefix: "AT/", resetPeriod: "YEARLY", padding: 4 },
};

/**
 * Tabel + kolom (`@unique`) tempat nomor tiap jenis dokumen disimpan. Generator
 * memakainya untuk menolak nomor yang sudah dipakai data yang dinomori di luar
 * penghitung — mis. penyesuaian stok manual lama yang memakai "nomor terbesar
 * + 1": tanpa pemeriksaan ini penghitung membagikan nomor itu lagi, transaksi
 * pemanggil gagal unik, kenaikan penghitung ikut batal, dan nomor yang sama
 * dicoba terus sampai bulan berganti.
 *
 * Sengaja `Partial`: DocType baru tanpa entri hanya kehilangan pemeriksaan ini,
 * tidak mematahkan build. Kelengkapannya dijaga `docNumber.test.ts`.
 */
export const KOLOM_NOMOR_DOKUMEN: Partial<Record<DocType, { model: string; kolom: string }>> = {
  PO: { model: "purchaseOrder", kolom: "docNumber" },
  GRN: { model: "gRN", kolom: "docNumber" },
  WO: { model: "workOrder", kolom: "docNumber" },
  ADJ: { model: "stockAdjustment", kolom: "docNumber" },
  RET: { model: "vendorReturn", kolom: "docNumber" },
  ISSUE: { model: "materialIssue", kolom: "docNumber" },
  RECEIPT: { model: "fGReceipt", kolom: "docNumber" },
  OPN: { model: "stockOpname", kolom: "docNumber" },
  PUTUS: { model: "fieldSalesOrder", kolom: "orderNo" },
  KONSI: { model: "fieldSalesOrder", kolom: "orderNo" },
  VANLOAD: { model: "vanLoad", kolom: "docNo" },
  VANSALE: { model: "vanSale", kolom: "docNo" },
  VANRECON: { model: "vanReconcile", kolom: "docNo" },
  SPGSALE: { model: "spgSale", kolom: "docNo" },
  DELIVERY: { model: "fieldSalesDelivery", kolom: "docNo" },
  // Ketiga jenis voucher kas berbagi satu tabel (`CashVoucher.type` membedakannya).
  CASHOUT: { model: "cashVoucher", kolom: "docNumber" },
  CASHIN: { model: "cashVoucher", kolom: "docNumber" },
  CASHTRF: { model: "cashVoucher", kolom: "docNumber" },
  SUPPAY: { model: "supplierPayment", kolom: "docNumber" },
  ASSET: { model: "fixedAsset", kolom: "code" },
};

type Klien = Prisma.TransactionClient;

type DelegasiNomor = {
  findFirst(args: { where: Record<string, unknown>; select: Record<string, true> }): Promise<unknown>;
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
  }): Promise<Record<string, unknown>[]>;
};

function delegasi(klien: Klien, model: string): DelegasiNomor {
  const d = (klien as unknown as Record<string, DelegasiNomor | undefined>)[model];
  if (!d) throw new Error(`Model ${model} tidak dikenal untuk penomoran dokumen`);
  return d;
}

/** Apakah `nomor` sudah dipakai sebuah dokumen jenis `type`? */
export async function nomorSudahTerpakai(klien: Klien, type: DocType, nomor: string): Promise<boolean> {
  const tabel = KOLOM_NOMOR_DOKUMEN[type];
  if (!tabel) return false;
  const ada = await delegasi(klien, tabel.model).findFirst({
    where: { [tabel.kolom]: nomor },
    select: { [tabel.kolom]: true },
  });
  return ada != null;
}

// Kolom `lastNumber` bertipe Int (32 bit): nomor lama yang lebih besar dari ini
// tidak bisa dilompati lewat penghitung, jadi diabaikan.
const BATAS_INT = 2_147_483_646;

/** Angka terbesar yang sudah terpakai dengan awalan periode ini (0 bila tidak ada). */
async function angkaTerbesarTerpakai(klien: Klien, type: DocType, awalanPeriode: string): Promise<number> {
  const tabel = KOLOM_NOMOR_DOKUMEN[type];
  if (!tabel) return 0;
  // Semua baris periode, bukan `orderBy desc take 1`: urutan teks salah begitu
  // angka melewati lebar padding ("…/10000" < "…/9999"). Hanya jalan saat tabrakan.
  const baris = await delegasi(klien, tabel.model).findMany({
    where: { [tabel.kolom]: { startsWith: awalanPeriode } },
    select: { [tabel.kolom]: true },
  });
  let terbesar = 0;
  for (const b of baris) {
    const ekor = String(b[tabel.kolom] ?? "").slice(awalanPeriode.length);
    if (!/^\d+$/.test(ekor)) continue;
    const angka = Number.parseInt(ekor, 10);
    if (angka <= BATAS_INT && angka > terbesar) terbesar = angka;
  }
  return terbesar;
}

type ConfigRow = {
  lastNumber: number;
  year: number;
  month: number;
  prefix: string;
  padding: number;
  resetPeriod: string;
};

async function pastikanKonfigurasi(klien: Klien, type: DocType, tahun: number, bulan: number) {
  const ada = await klien.docNumberConfig.findUnique({ where: { docType: type }, select: { id: true } });
  if (ada) return;
  const def = DEFAULT_CONFIGS[type];
  // skipDuplicates (ON CONFLICT DO NOTHING / INSERT IGNORE), bukan create+catch:
  // di PostgreSQL pelanggaran unik membatalkan seluruh transaksi pemanggil.
  await klien.docNumberConfig.createMany({
    data: [
      {
        docType: type,
        prefix: def.prefix,
        resetPeriod: def.resetPeriod,
        padding: def.padding,
        lastNumber: 0,
        year: tahun,
        month: bulan,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * Konflik serialisasi PostgreSQL di kueri MENTAH keluar sebagai P2010 dengan
 * `meta.driverAdapterError.cause.kind = "TransactionWriteConflict"` (40001/40P01)
 * — bentuk yang tidak dikenali `isRetryableTxError`, jadi pemanggil
 * `runSerializable` (muat van, opname, NRI, pesanan lapangan…) gagal alih-alih
 * mengulang. Di sini diterjemahkan ke P2034 milik Prisma ("write conflict or
 * deadlock, retry"). Deadlock MariaDB (1213) sudah dikenali lewat pesannya.
 */
function konflikSerialisasiMentah(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2010") return false;
  const meta = e.meta as { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } | undefined;
  const sebab = meta?.driverAdapterError?.cause;
  return sebab?.kind === "TransactionWriteConflict" || sebab?.originalCode === "40001" || sebab?.originalCode === "40P01";
}

async function eksekusiMentah(klien: Klien, kueri: Prisma.Sql): Promise<number> {
  try {
    return await klien.$executeRaw(kueri);
  } catch (e) {
    if (!konflikSerialisasiMentah(e)) throw e;
    throw new Prisma.PrismaClientKnownRequestError(e.message, {
      code: "P2034",
      clientVersion: e.clientVersion,
      meta: e.meta,
    });
  }
}

/** Naikkan (atau reset) penghitung secara atomik lalu baca barisnya. */
async function naikkanPenghitung(klien: Klien, type: DocType, tahun: number, bulan: number): Promise<ConfigRow> {
  await eksekusiMentah(klien, Prisma.sql`
    UPDATE ${sqlId("DocNumberConfig")}
    SET
      ${sqlId("lastNumber")} = CASE
        WHEN ${sqlId("resetPeriod")} = 'NEVER' THEN ${sqlId("lastNumber")} + 1
        WHEN ${sqlId("resetPeriod")} = 'YEARLY' AND ${sqlId("year")} = ${tahun} THEN ${sqlId("lastNumber")} + 1
        WHEN ${sqlId("resetPeriod")} = 'YEARLY' AND ${sqlId("year")} <> ${tahun} THEN 1
        WHEN ${sqlId("resetPeriod")} = 'MONTHLY' AND ${sqlId("year")} = ${tahun} AND ${sqlId("month")} = ${bulan} THEN ${sqlId("lastNumber")} + 1
        ELSE 1
      END,
      ${sqlId("year")} = ${tahun},
      ${sqlId("month")} = ${bulan}
    WHERE ${sqlId("docType")} = ${type}
  `);

  const rows = await klien.$queryRaw<ConfigRow[]>(Prisma.sql`
    SELECT ${sqlId("lastNumber")}, ${sqlId("year")}, ${sqlId("month")}, ${sqlId("prefix")}, ${sqlId("padding")}, ${sqlId("resetPeriod")}
    FROM ${sqlId("DocNumberConfig")}
    WHERE ${sqlId("docType")} = ${type}
  `);
  const row = rows[0];
  if (!row) throw new Error(`DocNumberConfig missing after update: ${type}`);
  return row;
}

/** Bentuk nomor + awalan periodenya ("ADJ/2026/10/" atau "PO/2026/"). */
function susunNomor(row: ConfigRow): { nomor: string; awalanPeriode: string } {
  const angka = String(row.lastNumber).padStart(row.padding || 4, "0");
  const awalan = row.prefix.endsWith("/") ? row.prefix : row.prefix + "/";
  const awalanPeriode =
    row.resetPeriod === "MONTHLY"
      ? `${awalan}${row.year}/${String(row.month).padStart(2, "0")}/`
      : `${awalan}${row.year}/`;
  return { nomor: `${awalanPeriode}${angka}`, awalanPeriode };
}

// Satu lompatan ke atas nomor terbesar biasanya cukup; batas ini hanya pengaman
// kalau ada penulis lain yang terus menyisipkan nomor berformat sama.
const BATAS_PERCOBAAN = 5;

async function nomorBerikutnya(klien: Klien, type: DocType): Promise<string> {
  const now = new Date();
  const tahun = now.getFullYear();
  const bulan = now.getMonth() + 1;
  await pastikanKonfigurasi(klien, type, tahun, bulan);

  for (let percobaan = 0; percobaan < BATAS_PERCOBAAN; percobaan++) {
    const row = await naikkanPenghitung(klien, type, tahun, bulan);
    const { nomor, awalanPeriode } = susunNomor(row);
    if (!(await nomorSudahTerpakai(klien, type, nomor))) return nomor;

    // Nomor ini sudah dipakai data di luar penghitung: lompati SEMUA nomor
    // terpakai di periode ini sekaligus. GREATEST + baris penghitung yang masih
    // terkunci oleh UPDATE di atas → atomik; syarat tahun/bulan mencegah
    // menimpa penghitung yang baru saja direset ke periode lain.
    const terbesar = await angkaTerbesarTerpakai(klien, type, awalanPeriode);
    await eksekusiMentah(klien, Prisma.sql`
      UPDATE ${sqlId("DocNumberConfig")}
      SET ${sqlId("lastNumber")} = GREATEST(${sqlId("lastNumber")}, ${terbesar})
      WHERE ${sqlId("docType")} = ${type} AND ${sqlId("year")} = ${row.year} AND ${sqlId("month")} = ${row.month}
    `);
  }
  throw new Error(`Nomor dokumen ${type} terus bertabrakan dengan nomor yang sudah ada`);
}

/**
 * Nomor dokumen berikutnya. Atomik: kenaikan penghitung dan pembacaannya
 * berada dalam satu transaksi, jadi pemanggil paralel tidak pernah mendapat
 * nomor yang sama, dan nomor yang sudah terpakai di tabel dokumennya dilompati.
 *
 * Tanpa `tx`, generator membuka transaksinya sendiri: UPDATE lalu SELECT di
 * luar transaksi membiarkan pemanggil paralel membaca angka milik pemanggil
 * lain (terukur: 12 panggilan paralel → 5 nomor unik).
 */
export async function generateDocNumber(type: DocType, tx?: any): Promise<string> {
  if (tx) return nomorBerikutnya(tx as Klien, type);
  return prisma.$transaction((t) => nomorBerikutnya(t, type));
}

// Generate supplier code (not using document number table)
export async function generateSupplierCode(): Promise<string> {
  const count = await prisma.supplier.count();
  const num = String(count + 1).padStart(4, "0");
  return `SUP${num}`;
}
