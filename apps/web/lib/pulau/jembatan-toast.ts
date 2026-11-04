/*
 * Jembatan toast → pulau status.
 *
 * Aplikasi memanggil `toast.success/error/…` dari "sonner" di ratusan tempat.
 * Pemanggil itu TIDAK diubah: `components/ui/sonner.tsx` membaca daftar toast
 * aktif lewat `useSonner()` (tumpukan bawaan sonner tidak lagi dipasang) dan
 * meneruskannya ke pulau lewat `teruskanToast`. Toast yang diperbarui dengan
 * id yang sama (`toast.loading` → `toast.success`, `toast.promise`) memperbarui
 * satu pesan, bukan menumpuk.
 *
 * Murni dari React: tipe toast di sini cukup bentuk yang dibaca, dan elemen
 * React dibaca teksnya dengan "duck typing".
 */
import { tampilkanPesan, tutupPesan } from "./pulau";
import type { JenisPesan, MasukanPesan } from "./keadaan";

/** Bagian `ToastT` sonner yang dibaca jembatan. */
export type ToastMirip = {
  id: string | number;
  type?: string;
  title?: unknown;
  description?: unknown;
  action?: unknown;
  duration?: number;
  jsx?: unknown;
};

const JENIS: Record<string, JenisPesan> = {
  success: "sukses",
  error: "galat",
  warning: "peringatan",
  info: "info",
  loading: "memuat",
};

/** Id pesan pulau untuk toast sonner ber-id `id`. */
export function idPulau(id: string | number): string {
  return `sonner:${String(id)}`;
}

/** Teks polos dari isi toast (string, angka, fungsi judul, larik, atau elemen React). */
export function teksDariNode(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "bigint") return String(node);
  if (typeof node === "function") return teksDariNode((node as () => unknown)());
  if (Array.isArray(node)) return node.map(teksDariNode).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return teksDariNode(props?.children);
  }
  return "";
}

function aksiDari(action: unknown): MasukanPesan["aksi"] {
  if (action === null || typeof action !== "object") return undefined;
  const a = action as { label?: unknown; onClick?: unknown };
  if (typeof a.onClick !== "function" || !("label" in a)) return undefined;
  const onClick = a.onClick as (peristiwa: unknown) => void;
  const label = teksDariNode(a.label);
  if (!label) return undefined;
  return { label, jalankan: (peristiwa) => onClick(peristiwa) };
}

/** Satu toast sonner → masukan pesan pulau, atau null bila tidak ada teks untuk ditampilkan. */
export function pesanDariToast(t: ToastMirip): MasukanPesan | null {
  const teks = teksDariNode(t.title).trim();
  const keterangan = teksDariNode(t.description).trim();
  if (!teks && !keterangan) return null;
  const aksi = aksiDari(t.action);
  const m: MasukanPesan = {
    id: idPulau(t.id),
    jenis: JENIS[t.type ?? ""] ?? "biasa",
    teks: teks || keterangan,
    ...(teks && keterangan ? { keterangan } : {}),
    ...(aksi ? { aksi } : {}),
  };
  if (typeof t.duration === "number") {
    m.durasiMs = Number.isFinite(t.duration) ? t.duration : null;
  }
  return m;
}

/**
 * Bandingkan daftar toast aktif dengan yang terakhir diteruskan: yang baru
 * atau berubah (objek baru — `useSonner` membuat objek baru tiap pembaruan)
 * dikirim ke pulau, yang tidak ada lagi (di-dismiss) ditutup. Mengembalikan
 * peta yang dikenal untuk putaran berikutnya.
 */
export function teruskanToast(
  dikenal: ReadonlyMap<string | number, ToastMirip>,
  toasts: readonly ToastMirip[],
): Map<string | number, ToastMirip> {
  const baru = new Map<string | number, ToastMirip>();
  // useSonner menaruh yang terbaru di depan; teruskan dari yang tertua supaya
  // urutan "terbaru" di pulau sama dengan urutan munculnya.
  for (const t of [...toasts].reverse()) {
    baru.set(t.id, t);
    if (dikenal.get(t.id) === t) continue;
    const m = pesanDariToast(t);
    if (m) tampilkanPesan(m);
    else tutupPesan(idPulau(t.id));
  }
  for (const id of dikenal.keys()) {
    if (!baru.has(id)) tutupPesan(idPulau(id));
  }
  return baru;
}

/**
 * Id toast sonner yang pesannya sudah tidak ada di pulau (waktunya habis atau
 * diketuk) dan belum di-dismiss. Toast-nya perlu di-dismiss di sonner supaya
 * daftar aktif `useSonner` tidak menumpuk sepanjang sesi.
 */
export function idPerluDilepas(
  dikenal: Iterable<string | number>,
  pesanAktif: readonly { id: string }[],
  sudahDilepas: ReadonlySet<string | number>,
): (string | number)[] {
  const aktif = new Set(pesanAktif.map((p) => p.id));
  const hasil: (string | number)[] = [];
  for (const id of dikenal) {
    if (!aktif.has(idPulau(id)) && !sudahDilepas.has(id)) hasil.push(id);
  }
  return hasil;
}
