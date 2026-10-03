"use server";

import { revalidatePath } from "next/cache";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { prisma } from "@elorae/db";
import idMessages from "@/lib/i18n/messages/id.json";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDate } from "@/lib/date-only";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { tokoTerkunci } from "@/lib/salesman/queries";
import type { JejakJadwal, KodeTolakJadwal, PerubahanJadwal } from "@/lib/salesman/jadwal";
import { salinMingguLalu, simpanJadwal } from "@/lib/salesman/jadwal-writer";
import { cariTokoUntukJadwal, type TokoPilihanJadwal } from "@/lib/salesman/jadwal-queries";

/**
 * Aksi jadwal kunjungan dari kantor. Mengatur = `field_sales_orders:approve`
 * (orang yang menyetujui pesanan lapangan juga yang mengatur kerja sales);
 * melihat = `field_sales_orders:view` (di halamannya).
 *
 * Mengembalikan kode, tidak melempar: di produksi Next menyamarkan pesan
 * galat menjadi digest acak.
 */

export type KodeAksiJadwal = "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "SALES_TIDAK_DITEMUKAN" | KodeTolakJadwal | "GAGAL";

export type HasilAksiJadwal =
  | { ok: true; hariBerubah: string[] }
  | {
      ok: false;
      code: KodeAksiJadwal;
      /** Hari yang ditolak (HARI_LEWAT, TERLALU_BANYAK, TIDAK_DITEMUKAN). */
      dayKey?: string;
      jumlah?: number;
      /** Nama toko yang ditolak (TOKO_*), siap ditampilkan. */
      toko?: string[];
    };

export type HasilSalinJadwal =
  | {
      ok: true;
      disalin: number;
      dilewati: { sudahAda: number; hariLewat: number; tokoTidakAktif: number; bukanMiliknya: number; penuh: number };
    }
  | { ok: false; code: "TANPA_AKSES" | "SALES_TIDAK_DITEMUKAN" | "HARI_LEWAT" | "TANGGAL_TIDAK_SAH" | "GAGAL" };

/** Satu simpan menyentuh paling banyak seminggu penuh: 7 hari × 60 toko, plus kelonggaran. */
const MAKS_ENTRI = 500;

function bolehMengatur(permissions: string[] | undefined): boolean {
  return hasPermission(permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
}

function segarkan() {
  revalidatePath("/backoffice/jadwal-kunjungan");
  revalidatePath("/backoffice/sales-lapangan");
  revalidatePath("/pwa");
  revalidatePath("/pwa/jadwal");
  revalidatePath("/pwa/rute");
}

const teks = (x: unknown): string => (typeof x === "string" ? x : "");
const catatanMasuk = (x: unknown): string | null | undefined =>
  x === undefined ? undefined : typeof x === "string" ? x : null;
const daftar = (x: unknown): Record<string, unknown>[] =>
  Array.isArray(x) ? x.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [];

/** Bentuk perubahan dari klien dirapikan; isian aneh menjadi kosong, bukan galat. */
function rapikanPerubahan(p: unknown): PerubahanJadwal | null {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const hasil: PerubahanJadwal = {
    tambah: daftar(o.tambah).map((t) => ({ dayKey: teks(t.dayKey), storeId: teks(t.storeId), note: catatanMasuk(t.note) })),
    hapus: daftar(o.hapus).map((h) => ({ dayKey: teks(h.dayKey), storeId: teks(h.storeId) })),
    catatan: daftar(o.catatan).map((c) => ({ dayKey: teks(c.dayKey), storeId: teks(c.storeId), note: catatanMasuk(c.note) ?? null })),
    ganti: daftar(o.ganti).map((g) => ({
      dayKey: teks(g.dayKey),
      toko: daftar(g.toko).map((t) => ({ storeId: teks(t.storeId), note: catatanMasuk(t.note) })),
    })),
  };
  const jumlah =
    (hasil.tambah?.length ?? 0) +
    (hasil.hapus?.length ?? 0) +
    (hasil.catatan?.length ?? 0) +
    (hasil.ganti ?? []).reduce((s, g) => s + 1 + g.toko.length, 0);
  return jumlah > MAKS_ENTRI ? null : hasil;
}

/** "Senin, 5 Okt 2026" — dipatok Indonesia: kabar disimpan sebagai satu teks. */
function labelHari(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00+07:00`);
  const hari = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" }).format(d);
  return `${hari}, ${formatDisplayDate(d)}`;
}

/**
 * Satu kabar per sales per simpan (bukan per baris), hanya bila ada hari ini
 * atau sesudahnya yang berubah — hari lalu memang tidak bisa diubah. Tautannya
 * membuka hari pertama yang berubah di `/pwa/jadwal`. Dipanggil SESUDAH
 * transaksi dan tidak pernah melempar.
 */
async function kabarJadwal(salesmanId: string, olehUserId: string, hariBerubah: string[], jejak: JejakJadwal | null) {
  if (hariBerubah.length === 0 || !jejak || salesmanId === olehUserId) return;
  try {
    const t = createTranslator({
      locale: "id",
      messages: idMessages as unknown as AbstractIntlMessages,
      namespace: "jadwalKunjungan.kabar",
    }) as unknown as (k: string, v?: Record<string, string | number>) => string;
    const pertama = hariBerubah[0];
    const jumlahToko = jejak.after[pertama]?.length ?? 0;
    const isi =
      hariBerubah.length > 1
        ? t("isiBanyakHari", { hari: hariBerubah.length, tanggal: labelHari(pertama) })
        : jumlahToko === 0
          ? t("isiDikosongkan", { tanggal: labelHari(pertama) })
          : t("isiSatuHari", { count: jumlahToko, tanggal: labelHari(pertama) });
    await kabariPengguna(salesmanId, {
      jenis: JENIS_KABAR.JADWAL_KUNJUNGAN,
      judul: t("judul"),
      isi,
      data: { tanggal: pertama },
    });
  } catch (err) {
    console.error("[kabar] jadwal kunjungan gagal", salesmanId, err);
  }
}

/** Tambah, hapus, ubah catatan atau ganti isi hari jadwal satu sales. */
export async function ubahJadwalAction(input: { salesmanId: string; perubahan: PerubahanJadwal }): Promise<HasilAksiJadwal> {
  const session = await auth();
  if (!session?.user?.id || !bolehMengatur(session.user.permissions)) return { ok: false, code: "TANPA_AKSES" };
  const perubahan = rapikanPerubahan(input?.perubahan);
  const salesmanId = teks(input?.salesmanId);
  if (!perubahan || !salesmanId) return { ok: false, code: "INPUT_TIDAK_SAH" };

  try {
    const r = await simpanJadwal({ salesmanId, olehUserId: session.user.id, perubahan });
    if (!r.ok) {
      if ("storeIds" in r) {
        const nama = await prisma.store.findMany({ where: { id: { in: r.storeIds } }, select: { id: true, name: true } });
        const peta = new Map(nama.map((n) => [n.id, n.name]));
        return { ok: false, code: r.kode, toko: r.storeIds.map((id) => peta.get(id) ?? id) };
      }
      return {
        ok: false,
        code: r.kode,
        ...("dayKey" in r ? { dayKey: r.dayKey } : {}),
        ...("jumlah" in r ? { jumlah: r.jumlah } : {}),
      };
    }
    if (r.hariBerubah.length) {
      segarkan();
      await kabarJadwal(salesmanId, session.user.id, r.hariBerubah, r.jejak);
    }
    return { ok: true, hariBerubah: r.hariBerubah };
  } catch (err) {
    console.error("simpanJadwal gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

/** Salin jadwal minggu sebelumnya ke minggu `minggu` (hari apa pun di minggu tujuan). */
export async function salinMingguLaluAction(input: { salesmanId: string; minggu: string }): Promise<HasilSalinJadwal> {
  const session = await auth();
  if (!session?.user?.id || !bolehMengatur(session.user.permissions)) return { ok: false, code: "TANPA_AKSES" };
  try {
    const r = await salinMingguLalu({
      salesmanId: teks(input?.salesmanId),
      olehUserId: session.user.id,
      minggu: teks(input?.minggu),
    });
    if (!r.ok) return { ok: false, code: r.kode };
    if (r.disalin > 0) {
      segarkan();
      await kabarJadwal(teks(input.salesmanId), session.user.id, r.hariBerubah, r.jejak);
    }
    return { ok: true, disalin: r.disalin, dilewati: r.dilewati };
  } catch (err) {
    console.error("salinMingguLalu gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

/** Cari toko untuk ditambahkan ke jadwal satu sales (pencarian di dialog "Tambah toko"). */
export async function cariTokoJadwalAction(input: {
  salesmanId: string;
  q?: string;
  groupId?: string | null;
}): Promise<{ ok: true; toko: TokoPilihanJadwal[]; terkunci: boolean } | { ok: false; code: "TANPA_AKSES" | "GAGAL" }> {
  const session = await auth();
  if (!session?.user?.id || !bolehMengatur(session.user.permissions)) return { ok: false, code: "TANPA_AKSES" };
  try {
    const terkunci = await tokoTerkunci();
    const toko = await cariTokoUntukJadwal({
      salesmanId: teks(input?.salesmanId),
      q: teks(input?.q),
      groupId: teks(input?.groupId) || null,
      terkunci,
    });
    return { ok: true, toko, terkunci };
  } catch (err) {
    console.error("cariTokoJadwal gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}
