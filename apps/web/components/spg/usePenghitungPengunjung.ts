"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bacaPengunjungAction, kirimPengunjungAction } from "@/app/actions/spg-pengunjung";
import {
  AWALAN_KUNCI_PENGUNJUNG,
  bacaCatatan,
  catatanKedaluwarsa,
  gabungDenganServer,
  hariDariKunci,
  hariIniPengunjung,
  ketuk,
  kunciCatatan,
  perluDikirim,
  setelahDiterima,
  TOLAK_FINAL_PENGUNJUNG,
  type CatatanPengunjung,
  type PengunjungServer,
} from "@/lib/spg/pengunjung";

/**
 * Penghitung pengunjung di HP SPG — satu kait untuk layar penuh
 * (`/pwa/spg/pengunjung`) dan kartu ringkas di beranda.
 *
 * Setiap ketukan langsung ditulis ke `localStorage` (per orang × toko × hari
 * WIB), jadi menghitung tetap jalan tanpa sinyal dan tidak hilang saat layar
 * tertutup. Angka MUTLAK + waktu ubahnya dikirim ke server: beberapa detik
 * sesudah ketukan terakhir, saat sinyal kembali, saat tab kembali tampil, dan
 * setiap setengah menit selama masih ada yang belum terkirim. Hitungan hari
 * sebelumnya yang tertinggal (HP mati semalam) ikut dikirim selama server masih
 * menerimanya (tiga hari ke belakang).
 *
 * Catatan HP dibaca sebagai sumber luar (`useSyncExternalStore`): server
 * merender angka dari basis data, HP menggantinya dengan catatannya sesudah
 * hidrasi tanpa ketidakcocokan. Penyimpanan bisa dilarang (mode privat):
 * setiap akses dibungkus try/catch, dan catatan tetap hidup di memori selama
 * aplikasi terbuka — kartu beranda dan layar penuh berbagi memori yang sama.
 */

export type AwalPengunjung = { day: string; saya: PengunjungServer; totalToko: number };
/** `ditolak` = server menolak angkanya (biasanya jam HP salah) — tidak dikirim ulang. */
export type StatusSinkron = "tersimpan" | "menunggu" | "mengirim" | "luring" | "ditolak";

const JEDA_KIRIM_MS = 2_000;
const JEDA_ULANG_MS = 30_000;

// ─── Catatan di HP sebagai sumber luar ────────────────────────────────────────

const pendengar = new Set<() => void>();
/** Salinan di memori: menang atas `localStorage` selama aplikasi terbuka (penyimpanan bisa gagal ditulis). */
const memori = new Map<string, string>();

function bacaMentah(kunci: string): string | null {
  const m = memori.get(kunci);
  if (m !== undefined) return m;
  try {
    return window.localStorage.getItem(kunci);
  } catch {
    return null;
  }
}

function tulis(kunci: string, c: CatatanPengunjung | null) {
  const s = c ? JSON.stringify(c) : null;
  if (s) memori.set(kunci, s);
  else memori.delete(kunci);
  try {
    if (s) window.localStorage.setItem(kunci, s);
    else window.localStorage.removeItem(kunci);
  } catch {
    // Penyimpanan penuh atau dilarang: angka tetap hidup di memori.
  }
  for (const f of pendengar) f();
}

function langganan(f: () => void) {
  pendengar.add(f);
  // Tab lain di HP yang sama mengubah catatan: baca ulang dari penyimpanan.
  const dariTabLain = (e: StorageEvent) => {
    if (e.key?.startsWith(AWALAN_KUNCI_PENGUNJUNG)) {
      memori.delete(e.key);
      f();
    }
  };
  window.addEventListener("storage", dariTabLain);
  return () => {
    pendengar.delete(f);
    window.removeEventListener("storage", dariTabLain);
  };
}

/** Hari-hari yang punya catatan orang × toko ini (penyimpanan + memori). */
function hariTersimpan(userId: string, storeId: string): string[] {
  const kunci = new Set(memori.keys());
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) kunci.add(k);
    }
  } catch {
    // Tanpa penyimpanan: memori saja.
  }
  const hasil: string[] = [];
  for (const k of kunci) {
    const day = hariDariKunci(k, userId, storeId);
    if (day) hasil.push(day);
  }
  return hasil.sort();
}

/** Hari WIB menurut jam HP berganti tengah malam: diperiksa berkala dan saat tab tampil. */
function langgananHari(f: () => void) {
  const id = setInterval(f, JEDA_ULANG_MS);
  document.addEventListener("visibilitychange", f);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", f);
  };
}

const hariSekarang = () => hariIniPengunjung(new Date());

// ─── Kait ─────────────────────────────────────────────────────────────────────

type DataServer = { day: string; saya: PengunjungServer; totalToko: number };

export function usePenghitungPengunjung({ userId, storeId, awal }: { userId: string; storeId: string; awal?: AwalPengunjung | null }) {
  const hari = useSyncExternalStore(langgananHari, hariSekarang, () => awal?.day ?? hariSekarang());
  const mentah = useSyncExternalStore(
    langganan,
    () => bacaMentah(kunciCatatan(userId, storeId, hari)),
    () => null,
  );

  const [server, setServer] = useState<DataServer | null>(awal ?? null);
  const serverRef = useRef<DataServer | null>(awal ?? null);
  const [status, setStatus] = useState<StatusSinkron>("tersimpan");
  const sedangKirim = useRef(false);
  const perluUlang = useRef(false);
  const pewaktu = useRef<ReturnType<typeof setTimeout> | null>(null);

  const terimaServer = useCallback((d: DataServer) => {
    serverRef.current = d;
    setServer(d);
  }, []);

  /** Catatan satu hari: catatan HP digabung dengan angka server terakhir hari itu. */
  const ambilCatatan = useCallback(
    (day: string) => {
      const s = serverRef.current;
      return gabungDenganServer(bacaCatatan(bacaMentah(kunciCatatan(userId, storeId, day))), s && s.day === day ? s.saya : null);
    },
    [userId, storeId],
  );

  const kirimSemua = useCallback(async () => {
    if (sedangKirim.current) {
      perluUlang.current = true;
      return;
    }
    sedangKirim.current = true;
    try {
      do {
        perluUlang.current = false;
        const hariIni = hariSekarang();
        for (const day of [...new Set([...hariTersimpan(userId, storeId), hariIni])].sort()) {
          const kunci = kunciCatatan(userId, storeId, day);
          if (catatanKedaluwarsa(day, hariIni)) {
            tulis(kunci, null);
            continue;
          }
          const c = ambilCatatan(day);
          if (!perluDikirim(c)) continue;
          if (day === hariIni) setStatus("mengirim");
          let r: Awaited<ReturnType<typeof kirimPengunjungAction>>;
          try {
            r = await kirimPengunjungAction({ day, count: c.count, clientUpdatedAt: c.ubah });
          } catch {
            // Tidak ada sinyal: semuanya tetap di HP, dicoba lagi nanti.
            setStatus("luring");
            return;
          }
          if (r.ok) {
            terimaServer({ day, saya: r.saya, totalToko: r.totalToko });
            tulis(kunci, setelahDiterima(bacaCatatan(bacaMentah(kunci)), c.ubah, r.saya));
          } else if (TOLAK_FINAL_PENGUNJUNG.includes(r.code)) {
            // Tidak akan pernah diterima: hari lalu dibuang; hari ini tetap
            // tampil tetapi tidak dikirim ulang terus-menerus.
            if (day === hariIni) {
              tulis(kunci, { ...c, terkirim: c.ubah });
              setStatus("ditolak");
            } else tulis(kunci, null);
          } else {
            setStatus("luring");
            return;
          }
        }
      } while (perluUlang.current);
      setStatus((s) => (s === "ditolak" ? s : perluDikirim(ambilCatatan(hariSekarang())) ? "menunggu" : "tersimpan"));
    } finally {
      sedangKirim.current = false;
    }
  }, [userId, storeId, ambilCatatan, terimaServer]);

  /** Ambil angka server terbaru (rekan setoko ikut menghitung) dan gabungkan dengan catatan HP. */
  const segarkan = useCallback(
    async (day: string) => {
      let r: Awaited<ReturnType<typeof bacaPengunjungAction>>;
      try {
        r = await bacaPengunjungAction(day);
      } catch {
        return;
      }
      if (!r.ok) return;
      terimaServer({ day, saya: r.saya, totalToko: r.totalToko });
      const kunci = kunciCatatan(userId, storeId, day);
      const lokal = bacaCatatan(bacaMentah(kunci));
      const gabung = gabungDenganServer(lokal, r.saya);
      if (gabung && JSON.stringify(gabung) !== JSON.stringify(lokal)) tulis(kunci, gabung);
    },
    [userId, storeId, terimaServer],
  );

  // Saat layar dibuka: buang catatan yang terlalu lama, lalu kirim yang tertinggal.
  useEffect(() => {
    const h = hariSekarang();
    for (const day of hariTersimpan(userId, storeId)) {
      if (catatanKedaluwarsa(day, h)) tulis(kunciCatatan(userId, storeId, day), null);
    }
    void kirimSemua();
  }, [userId, storeId, kirimSemua]);

  // Hari berganti (atau kartu dipasang tanpa angka server): ambil angka server hari itu.
  useEffect(() => {
    if (serverRef.current?.day !== hari) void segarkan(hari);
  }, [hari, segarkan]);

  useEffect(() => {
    const online = () => void kirimSemua();
    const tampil = () => {
      if (document.visibilityState !== "visible") return;
      void kirimSemua().then(() => segarkan(hariSekarang()));
    };
    const berkala = setInterval(() => {
      if (hariTersimpan(userId, storeId).some((d) => perluDikirim(ambilCatatan(d)))) void kirimSemua();
    }, JEDA_ULANG_MS);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", tampil);
    return () => {
      clearInterval(berkala);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", tampil);
      if (pewaktu.current) clearTimeout(pewaktu.current);
    };
  }, [userId, storeId, kirimSemua, segarkan, ambilCatatan]);

  const ubah = useCallback(
    (delta: 1 | -1) => {
      const day = hariSekarang();
      tulis(kunciCatatan(userId, storeId, day), ketuk(ambilCatatan(day), delta, new Date()));
      setStatus("menunggu");
      if (pewaktu.current) clearTimeout(pewaktu.current);
      pewaktu.current = setTimeout(() => void kirimSemua(), JEDA_KIRIM_MS);
    },
    [userId, storeId, ambilCatatan, kirimSemua],
  );

  const serverHariIni = server && server.day === hari ? server : null;
  const catatan = gabungDenganServer(bacaCatatan(mentah), serverHariIni?.saya ?? null);
  const saya = catatan?.count ?? 0;
  // Total toko = angka rekan menurut server + angka saya yang terbaru di HP.
  const totalLain = Math.max(0, (serverHariIni?.totalToko ?? 0) - (serverHariIni?.saya?.count ?? 0));
  return {
    hari,
    saya,
    totalToko: totalLain + saya,
    status: status === "tersimpan" && perluDikirim(catatan) ? ("menunggu" as const) : status,
    tambah: () => ubah(1),
    kurangi: () => ubah(-1),
    kirimSekarang: () => void kirimSemua(),
  };
}
