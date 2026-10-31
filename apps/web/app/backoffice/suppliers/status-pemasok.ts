import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { bacaTampilan, JENIS_TAMPILAN, type JenisTampilan } from "@/lib/tampilan/tampilan";

export type StatusPersetujuanPemasok = "PENDING_APPROVAL" | "ACTIVE" | "REJECTED";
export const STATUS_PERSETUJUAN_PEMASOK: readonly StatusPersetujuanPemasok[] = ["PENDING_APPROVAL", "ACTIVE", "REJECTED"];

/**
 * Formulir PO hanya menawarkan pemasok yang sudah disetujui DAN aktif
 * (`getSuppliersForSelect({ approvedOnly: true })` → `status = ACTIVE, isActive`)
 * — aturan yang sama dengan papan pemasok Lead time. Dulu pemasok nonaktif
 * dinyatakan "Bisa dipilih di PO" padahal hilang dari papan Lead time.
 */
export function bisaDipilihDiPo(
  status: StatusPersetujuanPemasok | null | undefined,
  isActive: boolean | null | undefined = true,
): boolean {
  return status === "ACTIVE" && isActive !== false;
}

/** `?aktif=` daftar pemasok: kosong = aktif dan nonaktif. */
export type SaringAktifPemasok = "" | "aktif" | "nonaktif";

/** Saringan keaktifan → filter `isActive` server (undefined = tanpa saringan). */
export function isActiveDariSaring(aktif: SaringAktifPemasok): boolean | undefined {
  return aktif === "aktif" ? true : aktif === "nonaktif" ? false : undefined;
}

/** Tombol Setujui/Tolak: menurut izin yang dipakai server, bukan nama peran. */
export function bolehMemutuskan(status: StatusPersetujuanPemasok | null | undefined, izin: readonly string[]): boolean {
  return status === "PENDING_APPROVAL" && hasPermission([...izin], PERMISSIONS.SUPPLIERS_APPROVE);
}

/**
 * Tombol tambah/ubah/hapus menurut izin yang sama dengan aksi servernya, supaya
 * pemegang `suppliers:view` saja tidak ditawari tombol yang pasti ditolak.
 */
export function aksiPemasok(izin: readonly string[]): { tambah: boolean; ubah: boolean; hapus: boolean } {
  const p = [...izin];
  return {
    tambah: hasPermission(p, PERMISSIONS.SUPPLIERS_CREATE),
    ubah: hasPermission(p, PERMISSIONS.SUPPLIERS_EDIT),
    hapus: hasPermission(p, PERMISSIONS.SUPPLIERS_DELETE),
  };
}

export const UKURAN_HALAMAN_PEMASOK = DEFAULT_PAGE_SIZE;
const UKURAN_HALAMAN_SAH = [10, 25, 50, 100];

export type SaringPemasok = {
  cari: string;
  jenis: string;
  status: StatusPersetujuanPemasok | "";
  /** Keaktifan (`?aktif=aktif|nonaktif`) — "Pemasok aktif" di beranda menaut ke `?aktif=aktif`. */
  aktif: SaringAktifPemasok;
  page: number;
  pageSize: number;
  /** Tabel (bawaan) / Galeri / Papan. Kosong di alamat = belum dipilih lewat alamat. */
  tampilan: JenisTampilan;
};

/** Papan menampilkan semua pemasok per jenis dalam satu layar, bukan per halaman. */
export const UKURAN_PAPAN_PEMASOK = 100;

type Param = string | string[] | undefined;
const pertama = (v: Param): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

/** Saringan daftar pemasok dari alamat (`?cari=&jenis=&status=&aktif=&page=&pageSize=`). */
export function bacaSaringPemasok(sp: {
  cari?: Param;
  jenis?: Param;
  status?: Param;
  aktif?: Param;
  page?: Param;
  pageSize?: Param;
  tampilan?: Param;
}): SaringPemasok {
  const status = pertama(sp.status);
  const aktif = pertama(sp.aktif);
  const page = Number.parseInt(pertama(sp.page), 10);
  const pageSize = Number.parseInt(pertama(sp.pageSize), 10);
  return {
    cari: pertama(sp.cari),
    jenis: pertama(sp.jenis),
    status: STATUS_PERSETUJUAN_PEMASOK.includes(status as StatusPersetujuanPemasok) ? (status as StatusPersetujuanPemasok) : "",
    aktif: aktif === "aktif" || aktif === "nonaktif" ? aktif : "",
    page: Number.isFinite(page) && page > 1 ? page : 1,
    pageSize: UKURAN_HALAMAN_SAH.includes(pageSize) ? pageSize : UKURAN_HALAMAN_PEMASOK,
    tampilan: bacaTampilan(pertama(sp.tampilan), JENIS_TAMPILAN, "tabel"),
  };
}

/** Alamat membawa tampilan sendiri (`?tampilan=`) — yang tersimpan di perangkat tidak dipakai. */
export function alamatMemilihTampilan(sp: { tampilan?: Param }): boolean {
  return pertama(sp.tampilan) !== "";
}

export function alamatSaringPemasok(pathname: string, s: SaringPemasok): string {
  const params = new URLSearchParams();
  if (s.cari.trim()) params.set("cari", s.cari.trim());
  if (s.jenis) params.set("jenis", s.jenis);
  if (s.status) params.set("status", s.status);
  if (s.aktif) params.set("aktif", s.aktif);
  if (s.page > 1) params.set("page", String(s.page));
  if (s.pageSize !== UKURAN_HALAMAN_PEMASOK) params.set("pageSize", String(s.pageSize));
  if (s.tampilan !== "tabel") params.set("tampilan", s.tampilan);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
