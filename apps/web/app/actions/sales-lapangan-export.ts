"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaRentang } from "@/lib/salesman/metrik-lapangan";
import { kinerjaSemuaSales, type BarisKunjunganLapangan, type KinerjaSales } from "@/lib/salesman/metrik-queries";

/**
 * Ekspor Excel dasbor "Kinerja Sales Lapangan": ringkasan per sales (dengan
 * baris total), setiap kunjungan, dan hasil kunjungan tim.
 *
 * Judul kolom DIKIRIM klien dari terjemahannya sendiri: bahasa aplikasi hanya
 * diketahui klien, dan berkas Excel harus berbahasa sama dengan layar yang
 * mengekspornya. Kolomnya ditentukan di sini (urutan + isi); klien hanya
 * memberi nama per id, jadi urutan dan isi tidak mungkin bergeser.
 */

export type KolomRingkasan =
  | "sales"
  | "kunjungan"
  | "toko"
  | "efektif"
  | "persenEfektif"
  | "rencana"
  | "rencanaDidatangi"
  | "pesanan"
  | "putus"
  | "nilaiPutus"
  | "konsi"
  | "ditolak"
  | "jarakJauh"
  | "van"
  | "nilaiVan"
  | "pelunasanDilaporkan"
  | "nilaiDilaporkan"
  | "pelunasanTerverifikasi"
  | "nilaiTerverifikasi"
  | "retur"
  | "tokoBaru"
  | "janggal"
  | "tokoMenurun"
  | "menitLapangan"
  | "target"
  | "capaiTarget"
  | "persenTarget";

export type KolomKunjungan =
  | "sales"
  | "tanggal"
  | "masuk"
  | "keluar"
  | "durasi"
  | "kodeToko"
  | "toko"
  | "hasil"
  | "catatan"
  | "efektif"
  | "pesanan"
  | "nilaiPutus"
  | "konsi"
  | "pelunasan"
  | "retur"
  | "van"
  | "jarakMeter"
  | "luarRadius"
  | "tanda"
  | "lat"
  | "lng"
  | "peta";

export type LabelEkspor = {
  namaBerkas: string;
  judul: string;
  total: string;
  ya: string;
  tidak: string;
  lembar: { ringkasan: string; kunjungan: string; hasil: string };
  ringkasan: Record<KolomRingkasan, string>;
  kunjungan: Record<KolomKunjungan, string>;
  hasilKolom: { hasil: string; jumlah: string };
  /** Nama kode hasil kunjungan dan tanda check-in. */
  kode: Record<string, string>;
};

export type HasilEkspor = { ok: true; base64: string; filename: string } | { ok: false; code: "TANPA_AKSES" | "GAGAL" };

type Sel = string | number | null;
type BarisTim = KinerjaSales & { kunjungan?: BarisKunjunganLapangan[] };

const KOLOM_RINGKASAN: readonly [KolomRingkasan, (b: Pick<BarisTim, "metrik" | "rencana" | "tokoMenurun" | "target">) => Sel][] = [
  ["kunjungan", (b) => b.metrik.kunjungan],
  ["toko", (b) => b.metrik.tokoDikunjungi],
  ["efektif", (b) => b.metrik.efektif],
  ["persenEfektif", (b) => b.metrik.persenEfektif],
  ["rencana", (b) => b.rencana?.direncanakan ?? null],
  ["rencanaDidatangi", (b) => b.rencana?.dikunjungi ?? null],
  ["pesanan", (b) => b.metrik.pesanan.jumlah],
  ["putus", (b) => b.metrik.pesanan.putus],
  ["nilaiPutus", (b) => b.metrik.pesanan.nilaiPutus],
  ["konsi", (b) => b.metrik.pesanan.konsi],
  ["ditolak", (b) => b.metrik.pesanan.ditolak],
  ["jarakJauh", (b) => b.metrik.pesanan.jarakJauh],
  ["van", (b) => b.metrik.van.jumlah],
  ["nilaiVan", (b) => b.metrik.van.nilai],
  ["pelunasanDilaporkan", (b) => b.metrik.pelunasan.dilaporkan],
  ["nilaiDilaporkan", (b) => b.metrik.pelunasan.nilaiDilaporkan],
  ["pelunasanTerverifikasi", (b) => b.metrik.pelunasan.terverifikasi],
  ["nilaiTerverifikasi", (b) => b.metrik.pelunasan.nilaiTerverifikasi],
  ["retur", (b) => b.metrik.retur],
  ["tokoBaru", (b) => b.metrik.tokoBaru],
  ["janggal", (b) => b.metrik.janggal],
  ["tokoMenurun", (b) => b.tokoMenurun],
  ["menitLapangan", (b) => b.metrik.lapangan.menit],
  ["target", (b) => b.target?.target ?? null],
  ["capaiTarget", (b) => b.target?.capai ?? null],
  ["persenTarget", (b) => b.target?.persen ?? null],
];

const jamWib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function barisKunjungan(nama: string, k: BarisKunjunganLapangan, label: LabelEkspor): Record<KolomKunjungan, Sel> {
  const tanda = [...(k.diLuarRadius ? ["LUAR_RADIUS"] : []), ...k.tanda.map((x) => x.kode)];
  return {
    sales: nama,
    tanggal: formatDateOnlyJakarta(k.checkinAt),
    masuk: jamWib.format(k.checkinAt),
    keluar: k.checkoutAt ? jamWib.format(k.checkoutAt) : null,
    durasi: k.durasiMenit,
    kodeToko: k.kodeToko,
    toko: k.toko,
    hasil: label.kode[k.kodeHasil] ?? k.kodeHasil,
    catatan: k.catatan,
    efektif: k.efektif ? label.ya : label.tidak,
    pesanan: k.pesanan,
    nilaiPutus: k.nilaiPutus,
    konsi: k.konsi,
    pelunasan: k.klaim,
    retur: k.retur,
    van: k.van,
    jarakMeter: k.jarakMeter,
    luarRadius: k.diLuarRadius ? label.ya : label.tidak,
    tanda: tanda.map((x) => label.kode[x] ?? x).join(", ") || null,
    lat: k.lat,
    lng: k.lng,
    peta: `https://www.google.com/maps?q=${k.lat},${k.lng}`,
  };
}

const URUT_KUNJUNGAN: readonly KolomKunjungan[] = [
  "sales",
  "tanggal",
  "masuk",
  "keluar",
  "durasi",
  "kodeToko",
  "toko",
  "hasil",
  "catatan",
  "efektif",
  "pesanan",
  "nilaiPutus",
  "konsi",
  "pelunasan",
  "retur",
  "van",
  "jarakMeter",
  "luarRadius",
  "tanda",
  "lat",
  "lng",
  "peta",
];

const teks = (x: unknown, cadangan: string) => (typeof x === "string" && x.trim() !== "" ? x : cadangan);

export async function eksporKinerjaSales(input: {
  rentang?: string;
  dari?: string;
  sampai?: string;
  label: LabelEkspor;
}): Promise<HasilEkspor> {
  const session = await auth();
  if (!session?.user) return { ok: false, code: "TANPA_AKSES" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) {
    return { ok: false, code: "TANPA_AKSES" };
  }

  try {
    const label = input.label;
    const sekarang = new Date();
    const { rentang } = bacaRentang({ rentang: input.rentang, dari: input.dari, sampai: input.sampai }, sekarang);
    const tim = await kinerjaSemuaSales(rentang, { sekarang, denganKunjungan: true });
    const kepala = (id: string, peta: Record<string, unknown> | undefined) => teks(peta?.[id], id);
    const judulRentang = rentang.dari === rentang.sampai ? rentang.dari : `${rentang.dari} — ${rentang.sampai}`;

    // Lembar 1: ringkasan per sales + total.
    const ringkasan: Sel[][] = [
      [teks(label?.judul, "Kinerja Sales Lapangan")],
      [judulRentang],
      [],
      [kepala("sales", label?.ringkasan), ...KOLOM_RINGKASAN.map(([id]) => kepala(id, label?.ringkasan))],
      ...tim.baris.map((b) => [b.nama, ...KOLOM_RINGKASAN.map(([, isi]) => isi(b))]),
      [
        teks(label?.total, "Total"),
        ...KOLOM_RINGKASAN.map(([id, isi]) => {
          // Rencana, toko menurun dan target tidak dijumlahkan: dasarnya per sales.
          if (["rencana", "rencanaDidatangi", "tokoMenurun", "target", "capaiTarget", "persenTarget"].includes(id)) {
            return null;
          }
          return isi({ metrik: tim.total, rencana: null, tokoMenurun: null, target: null });
        }),
      ],
    ];

    // Lembar 2: setiap kunjungan.
    const kunjungan: Sel[][] = [
      URUT_KUNJUNGAN.map((id) => kepala(id, label?.kunjungan)),
      ...tim.baris.flatMap((b) =>
        (b.kunjungan ?? []).map((k) => {
          const baris = barisKunjungan(b.nama, k, label);
          return URUT_KUNJUNGAN.map((id) => baris[id]);
        }),
      ),
    ];

    // Lembar 3: hasil kunjungan tim.
    const hasil: Sel[][] = [
      [teks(label?.hasilKolom?.hasil, "hasil"), teks(label?.hasilKolom?.jumlah, "jumlah")],
      ...tim.total.hasil.perKode.map((h) => [label?.kode?.[h.kode] ?? h.kode, h.jumlah]),
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ringkasan), teks(label?.lembar?.ringkasan, "Ringkasan").slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kunjungan), teks(label?.lembar?.kunjungan, "Kunjungan").slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hasil), teks(label?.lembar?.hasil, "Hasil").slice(0, 31));
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const nama = teks(label?.namaBerkas, "kinerja-sales").replace(/[^\w-]+/g, "-");
    return {
      ok: true,
      base64: buffer.toString("base64"),
      filename: `${nama}_${rentang.dari}_${rentang.sampai}.xlsx`,
    };
  } catch (err) {
    console.error("eksporKinerjaSales gagal", err);
    return { ok: false, code: "GAGAL" };
  }
}
