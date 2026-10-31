/**
 * Pesan WhatsApp ke toko tentang pembayarannya — bagian yang murni.
 *
 * Tidak ada API WhatsApp berbayar: yang dibuat hanya tautan `wa.me` dengan
 * pesan terisi. Pengguna sendiri yang membaca, mengubah, dan menekan kirim.
 *
 * Dua pesan, dua saat, dan perbedaannya adalah Aturan 1 ("klaim bukan lunas"):
 *
 * - TANDA TERIMA, sesudah sales melaporkan BKM. Pembayaran DITERIMA untuk
 *   diperiksa — belum diverifikasi keuangan, jadi pesannya TIDAK BOLEH
 *   menyebut tagihan lunas atau beres. Toko yang membaca "lunas" lalu tidak
 *   membayar ketika transfernya ternyata tidak pernah masuk adalah persis
 *   kebocoran yang modul ini dibuat untuk menutup. Pembangunnya tidak menerima
 *   sisa piutang sama sekali, supaya mustahil menyebutnya.
 * - KONFIRMASI, sesudah keuangan memverifikasi. Baru di sini kata "lunas"
 *   boleh muncul, dan hanya untuk faktur yang sisa hitung-ulangnya nol.
 *
 * Teksnya lewat next-intl (namespace `pesanToko`). Bahasanya dipatok Indonesia
 * oleh pemanggil: penerimanya toko, bukan pengguna aplikasi — admin yang
 * memakai tampilan Inggris tetap mengirim pesan yang dibaca toko.
 */

import { createTranslator, type AbstractIntlMessages } from "next-intl";
import idMessages from "@/lib/i18n/messages/id.json";
import enMessages from "@/lib/i18n/messages/en.json";
import { tautanWhatsApp } from "@/lib/salesman/dasbor";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDisplayDate } from "@/lib/date-only";

export type TerjemahPesan = (kunci: string, nilai?: Record<string, string | number>) => string;

const PESAN: Record<"id" | "en", AbstractIntlMessages> = {
  id: idMessages as unknown as AbstractIntlMessages,
  en: enMessages as unknown as AbstractIntlMessages,
};

/** Penerjemah namespace `pesanToko`. Bawaan Indonesia — lihat catatan di atas. */
export function penerjemahPesanToko(locale: "id" | "en" = "id"): { t: TerjemahPesan; locale: "id" | "en" } {
  const t = createTranslator({ locale, messages: PESAN[locale], namespace: "pesanToko" });
  return { t: t as unknown as TerjemahPesan, locale };
}

const CARA_DIKENAL = ["transfer", "tunai", "giro"] as const;
const cara = (c: string) => ((CARA_DIKENAL as readonly string[]).includes(c) ? c : "transfer");

export type BahanTandaTerima = {
  toko: string;
  docNo: string;
  /** Tanggal transfer / terima tunai / serah giro yang dilaporkan. */
  tanggal: Date | string;
  cara: string;
  /** Nilai yang dibayarkan ke tiap faktur menurut laporan — BUKAN sisa piutangnya. */
  faktur: readonly { invoiceNo: string; nilai: number }[];
  nilaiFaktur: number;
  potongan: number;
  diterima: number;
  giro: { nomor: string | null; bank: string | null; efektif: Date | string | null } | null;
  diterimaOleh: string | null;
};

/**
 * Tanda terima pembayaran yang BELUM diverifikasi.
 *
 * Sengaja tidak memuat sisa piutang: yang diakui sebuah klaim yang masih
 * menunggu adalah nol, dan pesan ini dikirim justru pada saat itu.
 */
export function pesanTandaTerima(b: BahanTandaTerima, t: TerjemahPesan, locale: "id" | "en" = "id"): string {
  const tgl = (d: Date | string | null) => formatDisplayDate(d, locale);
  const baris: string[] = [t("salam", { toko: b.toko }), "", t("terima_pembuka"), ""];
  baris.push(t("noBkm", { doc: b.docNo }));
  baris.push(t("tanggal", { date: tgl(b.tanggal) }));
  baris.push(t("cara", { cara: t(`cara_${cara(b.cara)}`) }));
  if (b.faktur.length > 0) {
    baris.push(t("fakturJudul"));
    for (const f of b.faktur) baris.push(t("fakturBaris", { no: f.invoiceNo, nilai: formatIDR(f.nilai) }));
  }
  if (b.potongan > 0) {
    baris.push(t("nilaiFaktur", { nilai: formatIDR(b.nilaiFaktur) }));
    baris.push(t("potongan", { nilai: formatIDR(b.potongan) }));
  }
  baris.push(t("diterima", { nilai: formatIDR(b.diterima) }));
  if (cara(b.cara) === "giro" && b.giro) {
    baris.push(
      "",
      t("giroMenunggu", { no: b.giro.nomor ?? "—", bank: b.giro.bank ?? "—", date: tgl(b.giro.efektif) }),
    );
  }
  if (b.diterimaOleh?.trim()) baris.push("", t("diterimaOleh", { nama: b.diterimaOleh.trim() }));
  baris.push("", t("terima_penutup"));
  return baris.join("\n");
}

export type BahanKonfirmasi = {
  toko: string;
  docNo: string;
  tanggal: Date | string;
  diterima: number;
  giro: { nomor: string | null; bank: string | null } | null;
  /** Faktur yang disentuh klaim ini dengan sisa yang DIHITUNG ULANG sekarang. */
  faktur: readonly { invoiceNo: string; sisa: number }[];
  /** Potongan retur yang masih ditahan (Aturan 2) — menjelaskan kenapa faktur belum nol. */
  tertahan: number;
};

/** Konfirmasi sesudah keuangan memverifikasi: faktur mana yang lunas, mana yang masih bersisa. */
export function pesanKonfirmasi(b: BahanKonfirmasi, t: TerjemahPesan, locale: "id" | "en" = "id"): string {
  const baris: string[] = [t("salam", { toko: b.toko }), ""];
  baris.push(
    t("konfirmasi_pembuka", {
      doc: b.docNo,
      date: formatDisplayDate(b.tanggal, locale),
      nilai: formatIDR(b.diterima),
    }),
  );
  if (b.giro) baris.push(t("konfirmasi_giro", { no: b.giro.nomor ?? "—", bank: b.giro.bank ?? "—" }));

  const lunas = b.faktur.filter((f) => f.sisa <= 0);
  const bersisa = b.faktur.filter((f) => f.sisa > 0);
  if (lunas.length > 0) {
    baris.push("", t("lunasJudul"));
    for (const f of lunas) baris.push(t("lunasBaris", { no: f.invoiceNo }));
  }
  if (bersisa.length > 0) {
    baris.push("", t("sisaJudul"));
    for (const f of bersisa) baris.push(t("sisaBaris", { no: f.invoiceNo, nilai: formatIDR(f.sisa) }));
    if (b.tertahan > 0) baris.push(t("tertahan", { nilai: formatIDR(b.tertahan) }));
    baris.push(t("totalSisa", { nilai: formatIDR(bersisa.reduce((s, f) => s + f.sisa, 0)) }));
  }
  baris.push("", t("konfirmasi_penutup"));
  return baris.join("\n");
}

export type BahanPembatalan = {
  toko: string;
  docNo: string;
  tanggal: Date | string;
  diterima: number;
};

/**
 * Tanda terima yang ditarik karena salah catat (salah toko, salah faktur).
 *
 * Toko mungkin sudah memegang tanda terima untuk BKM yang kini batal; pesan ini
 * memberi tahu bahwa tanda terima ITU tidak berlaku dan penggantinya menyusul.
 * Sengaja menyebut "salah catat": uang toko memang diterima, dan pesan yang
 * terdengar seperti "pembayaran Anda batal" membuat toko mengira harus membayar
 * lagi. Tidak pernah menyebut lunas.
 */
export function pesanPembatalan(b: BahanPembatalan, t: TerjemahPesan, locale: "id" | "en" = "id"): string {
  return [
    t("salam", { toko: b.toko }),
    "",
    t("batal_pembuka", { doc: b.docNo, date: formatDisplayDate(b.tanggal, locale), nilai: formatIDR(b.diterima) }),
    "",
    t("batal_penutup"),
  ].join("\n");
}

/**
 * Pesan yang cocok untuk keadaan klaimnya, atau `null`.
 *
 * Inilah satu-satunya pintu yang memilih: DIKIRIM hanya bisa mendapat tanda
 * terima, TERVERIFIKASI hanya konfirmasi, ditolak/dibatalkan tidak mendapat
 * apa-apa. Pemanggil tidak bisa salah memilih pesan untuk keadaannya.
 */
export function pesanUntukKlaim(
  status: string,
  bahan: { tandaTerima: BahanTandaTerima; konfirmasi: BahanKonfirmasi },
  t: TerjemahPesan,
  locale: "id" | "en" = "id",
): { jenis: "TANDA_TERIMA" | "KONFIRMASI"; pesan: string } | null {
  if (status === "DIKIRIM") return { jenis: "TANDA_TERIMA", pesan: pesanTandaTerima(bahan.tandaTerima, t, locale) };
  if (status === "TERVERIFIKASI") return { jenis: "KONFIRMASI", pesan: pesanKonfirmasi(bahan.konfirmasi, t, locale) };
  return null;
}

/**
 * Tautan wa.me dengan pesan terisi. Nomor yang bukan nomor HP (telepon kantor)
 * atau kosong → tautan tanpa nomor: WhatsApp membuka pemilih obrolan dan
 * pengguna memilih kontaknya sendiri. Penormal nomornya sama dengan tombol
 * "Perlu ditagih" di beranda dan "Kirim katalog".
 */
export function tautanPesanToko(telepon: string | null | undefined, pesan: string): { url: string; adaNomor: boolean } {
  const url = tautanWhatsApp(telepon, pesan);
  return url ? { url, adaNomor: true } : { url: `https://wa.me/?text=${encodeURIComponent(pesan)}`, adaNomor: false };
}
