"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, Bell, CalendarCheck, CalendarDays, CalendarRange, CheckCheck, ChevronRight, ClipboardCheck, Landmark, Megaphone, PackageX, Receipt, ReceiptText, Scale, ShoppingBag, Store, Truck, Undo2, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BarisKabar } from "./baris";
import { KABAR_BERUBAH } from "./peristiwa";
import { PushHp } from "./PushHp";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

const IKON: Record<string, LucideIcon> = {
  PESANAN_DISETUJUI: ShoppingBag,
  PESANAN_DITOLAK: ShoppingBag,
  PESANAN_DIKIRIM: Truck,
  PESANAN_DITUTUP: PackageX,
  PELUNASAN_TERVERIFIKASI: Wallet,
  PELUNASAN_DITOLAK: Wallet,
  PELUNASAN_DIBATALKAN: Wallet,
  RETUR_DIHITUNG: Undo2,
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

export function KabarClient({ baris, batas }: { baris: BarisKabar[]; batas: number | null }) {
  const t = useTranslations("pwa.kabar");
  const router = useRouter();
  const [menandai, startTransition] = useTransition();
  /*
   * Yang ditandai di HP ini disimpan sebagai himpunan id, bukan salinan daftar: sesudah
   * `router.refresh()` daftar dari server yang berlaku, dan kabar yang baru datang tidak ikut
   * tertandai hanya karena "semua" pernah ditekan sebelumnya.
   */
  const [dibacaLokal, setDibacaLokal] = useState<ReadonlySet<string>>(() => new Set());

  const sudahDibaca = (b: BarisKabar) => b.dibaca || dibacaLokal.has(b.id);
  const belum = baris.filter((b) => !sudahDibaca(b)).length;

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
        setDibacaLokal((lama) => new Set([...lama, ...baris.map((b) => b.id)]));
        window.dispatchEvent(new Event(KABAR_BERUBAH));
        router.refresh();
      } catch {
        toast.error(t("markAllFailed"));
      }
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

      {baris.length === 0 ? (
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
              {baris.map((b) => {
                const dibaca = sudahDibaca(b);
                const Ikon = IKON[b.jenis] ?? Bell;
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
                        {b.judul}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{b.isi}</span>
                      <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                        {b.hariIni ? t("todayAt", { time: b.waktu }) : b.waktu}
                      </span>
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

          {batas !== null ? <p className="text-center text-xs text-muted-foreground">{t("capped", { count: batas })}</p> : null}
        </>
      )}
    </div>
  );
}
