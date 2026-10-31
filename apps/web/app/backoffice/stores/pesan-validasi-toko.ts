/**
 * Pesan validasi formulir toko yang bisa dibaca orang. Formulir menampilkan
 * `message` apa adanya untuk kode "validation"; tanpa ini yang muncul adalah
 * JSON isu zod berbahasa Inggris.
 */

const LABEL_KOLOM: Record<string, string> = {
  code: "Kode toko",
  name: "Nama toko",
  address: "Alamat",
  phone: "Telepon",
  contactName: "Nama kontak",
  termsType: "Sistem toko",
  paymentTempo: "Tempo bayar",
  markupPercent: "Markup",
  priceDiscountPercent: "Diskon harga toko",
  lat: "Latitude",
  lng: "Longitude",
  checkinRadiusMeters: "Radius check-in",
  isPkp: "PKP",
  groupId: "Area",
  salesmanId: "Sales pemegang",
  creditLimit: "Batas kredit",
  maxOpenInvoices: "Batas faktur terbuka",
  storeClass: "Kelas toko",
};

/** Bentuk isu zod yang dibaca di sini (zod 4). */
export type IsuValidasi = {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  expected?: string;
};

const angka = (n: number | bigint) => Number(n).toLocaleString("id-ID");

export function pesanValidasiToko(issues: ReadonlyArray<IsuValidasi>): string {
  const isu = issues[0];
  if (!isu) return "Isian toko tidak sah. Periksa kembali formulir.";
  const kolom = String(isu.path[0] ?? "");
  const label = LABEL_KOLOM[kolom] ?? "Isian toko";

  if (isu.code === "too_small" && isu.minimum !== undefined) {
    if (isu.origin === "string") {
      return Number(isu.minimum) <= 1 ? `${label} wajib diisi.` : `${label} minimal ${angka(isu.minimum)} karakter.`;
    }
    return `${label} tidak boleh kurang dari ${angka(isu.minimum)}.`;
  }
  if (isu.code === "too_big" && isu.maximum !== undefined) {
    if (isu.origin === "string") return `${label} terlalu panjang (maksimal ${angka(isu.maximum)} karakter).`;
    return `${label} tidak boleh lebih dari ${angka(isu.maximum)}.`;
  }
  if (isu.code === "invalid_type" && isu.expected === "int") return `${label} harus bilangan bulat.`;
  return `${label} tidak sah. Periksa kembali isiannya.`;
}
