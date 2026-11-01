"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  ArrowRightLeft,
  Bell,
  Bookmark,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Inbox,
  Landmark,
  Lightbulb,
  Loader2,
  Megaphone,
  Moon,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackageX,
  Receipt,
  ReceiptText,
  Repeat,
  Scale,
  ShoppingBag,
  Store,
  Truck,
  Undo2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format/rupiah";
import { tampilanLonceng, type Penerjemah } from "@/lib/notifications/tampilan-lonceng";
import { gabungBaris, type BarisKabar } from "./baris";
import { muatKabarLagi } from "./actions";
import { KABAR_BERUBAH } from "./peristiwa";
import { PushHp } from "./PushHp";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Ikon per jenis — kabar Max dan jenis tim yang sampai ke HP. Jenis lain memakai lonceng. */
const IKON: Record<string, LucideIcon> = {
  PESANAN_DISETUJUI: ShoppingBag,
  PESANAN_DITOLAK: ShoppingBag,
  PESANAN_DIKIRIM: Truck,
  PESANAN_DITUTUP: PackageX,
  PELUNASAN_TERVERIFIKASI: Wallet,
  PELUNASAN_DITOLAK: Wallet,
  PELUNASAN_DIBATALKAN: Wallet,
  RETUR_DIHITUNG: Undo2,
  RETUR_DIPINDAH_TOKO: Undo2,
  RETUR_DIBATALKAN: Undo2,
  RETUR_DIBEBANKAN: Scale,
  PERUBAHAN_TOKO_DISETUJUI: Store,
  PERUBAHAN_TOKO_DITOLAK: Store,
  PESANAN_PORTAL: ShoppingBag,
  TOKO_BARU_DISETUJUI: Store,
  TOKO_BARU_DITOLAK: Store,
  KONTRABON_DIKONFIRMASI: ReceiptText,
  KONTRABON_DIBATALKAN: ReceiptText,
  GIRO_CAIR: Landmark,
  GIRO_DITOLAK: Landmark,
  BIAYA_DISETUJUI: Receipt,
  BIAYA_DITOLAK: Receipt,
  BIAYA_DIBAYAR: Receipt,
  RINGKASAN_HARIAN: CalendarDays,
  TUKAR_DISETUJUI: ArrowLeftRight,
  TUKAR_DITOLAK: ArrowLeftRight,
  TUKAR_SELESAI: ArrowLeftRight,
  TUKAR_DIBATALKAN: ArrowLeftRight,
  TUGAS_TAGIH_BARU: ClipboardCheck,
  JADWAL_KUNJUNGAN: CalendarRange,
  PENGUMUMAN: Megaphone,
  IZIN_DISETUJUI: CalendarCheck,
  IZIN_DITOLAK: CalendarCheck,
  IZIN_DIBATALKAN: CalendarCheck,
  MUTASI_DISETUJUI: ArrowRightLeft,
  MUTASI_DITOLAK: ArrowRightLeft,
  MUTASI_MASUK: ArrowRightLeft,
  MUTASI_DITERIMA: ArrowRightLeft,
  MUTASI_DIBATALKAN: ArrowRightLeft,
  PERMINTAAN_STOK_DIPROSES: PackageSearch,
  KIRIMAN_MENUNGGU: PackageOpen,
  KIRIMAN_BERANGKAT: Truck,
  KIRIMAN_DISERAHKAN: PackageCheck,
  KIRIMAN_DITERIMA_SELISIH: PackageX,
  KIRIMAN_RUSAK_DIPUTUSKAN: PackageX,
  PERMINTAAN_SPG_MASUK: Inbox,
  REKOMENDASI_MASUK: Lightbulb,
  REKOMENDASI_DIJAWAB: Lightbulb,
  TITIP_PESAN_TERSEDIA: Bookmark,
  JADWAL_SPG: CalendarRange,
  TUKAR_SHIFT_DIMINTA: Repeat,
  TUKAR_SHIFT_DIPUTUSKAN: Repeat,
  KOMISI_SPG: Coins,
  TUTUP_HARI_PENGINGAT: Moon,
  BEBAN_HILANG_DITETAPKAN: Scale,
  // Jenis tim yang ditujukan ke salesman, penagih, dan SPG.
  FIELD_SALES_ORDER_REJECTED: ShoppingBag,
  KONSI_ORDER_PUSHED: Truck,
  FIELD_RETURN_MISMATCH: Undo2,
  AR_OVERDUE: CalendarClock,
  COLLECTOR_ASSIGNED: ClipboardCheck,
  SETTLEMENT_APPROVED: Wallet,
  SETTLEMENT_REJECTED: Wallet,
  KONSI_COUNT_DUE: ClipboardList,
  KONSI_COUNT_OVERDUE: ClipboardList,
};

/**
 * Menandai satu kabar dibaca di server. `keepalive` karena ketukan langsung berpindah ke halaman
 * tautannya — tanpa itu permintaannya bisa terputus di tengah jalan. Gagal (mis. tanpa sinyal)
 * dibiarkan diam: kabarnya hanya akan tampil belum dibaca lagi, tidak ada yang rusak.
 */
function tandaiDibacaDiServer(id: string) {
  void fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", keepalive: true })
    .then((res) => {
      if (res.ok) window.dispatchEvent(new Event(KABAR_BERUBAH));
    })
    .catch(() => undefined);
}

export function KabarClient({
  baris,
  kursorAwal,
  belumServer,
}: {
  /** Halaman pertama, disusun server. */
  baris: BarisKabar[];
  /** Kursor halaman sesudahnya, `null` kalau tidak ada kabar yang lebih lama. */
  kursorAwal: string | null;
  /** Jumlah SEMUA kabar belum dibaca saat halaman disusun, termasuk yang belum termuat. */
  belumServer: number;
}) {
  const t = useTranslations("pwa.kabar");
  const tAkar = useTranslations();
  const router = useRouter();
  const [menandai, startTransition] = useTransition();
  const [memuat, startMuat] = useTransition();
  /*
   * Yang ditandai di HP ini disimpan sebagai himpunan id, bukan salinan daftar: sesudah
   * `router.refresh()` daftar dari server yang berlaku, dan kabar yang baru datang tidak ikut
   * tertandai hanya karena "semua" pernah ditekan sebelumnya.
   */
  const [dibacaLokal, setDibacaLokal] = useState<ReadonlySet<string>>(() => new Set());
  /*
   * Baris dari "Muat lagi", beserta halaman pertama saat itu. Disimpan terpisah dari `baris`
   * supaya `router.refresh()` (yang mengganti halaman pertama) tidak menghapusnya — termasuk baris
   * yang tergeser keluar dari halaman pertama oleh kabar baru.
   */
  const [simpanan, setSimpanan] = useState<readonly BarisKabar[]>([]);
  /** Kursor halaman berikutnya; `undefined` = belum pernah memuat lagi, jadi kursor halaman pertama berlaku. */
  const [kursorLanjut, setKursorLanjut] = useState<string | null | undefined>(undefined);
  const [gagalMuat, setGagalMuat] = useState(false);
  /*
   * Halaman pertama saat "Tandai semua" berhasil. Selama `router.refresh()` belum membawa halaman
   * baru (rujukan larik yang sama), jumlah belum dibaca = 0 — bukan angka server yang sudah usang.
   */
  const [ditandaiSemuaPada, setDitandaiSemuaPada] = useState<BarisKabar[] | null>(null);

  // Kalimat Inggris yang tersimpan (notifikasi kantor) diterjemahkan seperti di lonceng kantor.
  const penerjemah: Penerjemah = {
    t: (kunci, nilai) => tAkar(kunci as never, nilai as never),
    has: (kunci) => tAkar.has(kunci as never),
    rupiah: formatRupiah,
  };

  const tampil = gabungBaris(baris, simpanan);
  const kursor = kursorLanjut === undefined ? kursorAwal : kursorLanjut;
  const sudahDibaca = (b: BarisKabar) => b.dibaca || dibacaLokal.has(b.id);
  const belumTampil = tampil.filter((b) => !sudahDibaca(b)).length;
  const dibacaDiSini = tampil.filter((b) => !b.dibaca && dibacaLokal.has(b.id)).length;
  const belum = ditandaiSemuaPada === baris ? 0 : Math.max(belumServer - dibacaDiSini, belumTampil);

  function buka(b: BarisKabar) {
    if (sudahDibaca(b)) return;
    setDibacaLokal((lama) => new Set(lama).add(b.id));
    tandaiDibacaDiServer(b.id);
  }

  function tandaiSemua() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/notifications/read-all", { method: "POST" });
        // Sesi habis membuat proxy mengalihkan ke /login dengan 200 — itu bukan berhasil.
        if (!res.ok || res.redirected) throw new Error(`read-all ${res.status}`);
        setDibacaLokal((lama) => new Set([...lama, ...tampil.map((b) => b.id)]));
        // Baris simpanan tidak ikut disegarkan server, jadi status dibacanya dibetulkan di sini.
        setSimpanan((lama) => lama.map((b) => (b.dibaca ? b : { ...b, dibaca: true })));
        setDitandaiSemuaPada(baris);
        window.dispatchEvent(new Event(KABAR_BERUBAH));
        router.refresh();
      } catch {
        toast.error(t("markAllFailed"));
      }
    });
  }

  function muatLagi() {
    if (!kursor) return;
    setGagalMuat(false);
    startMuat(async () => {
      const hasil = await muatKabarLagi(kursor).catch(() => ({ ok: false }) as const);
      if (!hasil.ok) {
        setGagalMuat(true);
        return;
      }
      // Yang baru diambil paling segar, lalu halaman pertama saat ini, lalu simpanan lama.
      setSimpanan((lama) => gabungBaris(hasil.baris, baris, lama));
      setKursorLanjut(hasil.kursor);
    });
  }

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
      </header>

      <PushHp />

      {tampil.length === 0 ? (
        <section className="beranda-kartu flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <Bell className="h-6 w-6" aria-hidden />
          </span>
          <p className="font-semibold">{t("empty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyHint")}</p>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium" aria-live="polite">
              {belum > 0 ? t("unreadSummary", { count: belum }) : t("allRead")}
            </p>
            {belum > 0 ? (
              <Button variant="outline" size="sm" onClick={tandaiSemua} disabled={menandai}>
                <CheckCheck className="h-4 w-4" aria-hidden />
                {t("markAll")}
              </Button>
            ) : null}
          </div>

          <section className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {tampil.map((b) => {
                const dibaca = sudahDibaca(b);
                const Ikon = IKON[b.jenis] ?? Bell;
                const teks = tampilanLonceng({ type: b.jenis, title: b.judul, body: b.isi, data: b.data }, penerjemah);
                const isi = (
                  <>
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                        dibaca ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
                      )}
                    >
                      <Ikon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block leading-tight", dibaca ? "font-medium" : "font-semibold")}>
                        {!dibaca ? <span className="sr-only">{t("unread")}: </span> : null}
                        {teks.judul}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{teks.isi}</span>
                      <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                        {b.hariIni ? t("todayAt", { time: b.waktu }) : b.waktu}
                      </span>
                      {/* Tanpa layar di HP (pekerjaan kantor): katakan, supaya ketukan yang diam tidak membingungkan. */}
                      {!b.href ? <span className="mt-1 block text-xs text-muted-foreground">{t("officeOnly")}</span> : null}
                    </span>
                    {!dibaca ? <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
                    {b.href ? <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
                  </>
                );
                const kelas = cn(
                  "flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                  !dibaca && "bg-primary/5",
                );
                return (
                  <li key={b.id}>
                    {b.href ? (
                      <Link href={b.href} onClick={() => buka(b)} className={kelas}>
                        {isi}
                      </Link>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => buka(b)}
                        className={cn(kelas, "h-auto justify-start rounded-none whitespace-normal font-normal")}
                      >
                        {isi}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {kursor ? (
            <div className="space-y-2">
              {gagalMuat ? (
                <p className="text-center text-sm text-destructive" role="alert">
                  {t("loadMoreFailed")}
                </p>
              ) : null}
              <Button variant="outline" className="w-full" onClick={muatLagi} disabled={memuat}>
                {memuat ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
