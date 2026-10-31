"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Clock, Megaphone, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RincianPengumumanHp as Data } from "@/lib/pengumuman/queries";
import { konfirmasiPengumumanAction, tandaiPengumumanDibacaAction } from "@/app/actions/pengumuman";
import { KABAR_BERUBAH } from "@/app/pwa/kabar/peristiwa";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
/**
 * Rincian pengumuman di HP. Membuka = membaca: ditandai SEKALI sesudah tampil
 * (tanpa sinyal gagal diam-diam — tetap tampil belum dibaca, tidak ada yang
 * rusak). Wajib konfirmasi → tombol "Saya mengerti" sampai ditekan.
 */
export function RincianPengumumanHp({ data }: { data: Data }) {
  const t = useTranslations("pwa.pengumuman");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [dikonfirmasi, setDikonfirmasi] = useState(data.ada ? data.dikonfirmasiPada !== null : false);
  const sudahDitandai = useRef(false);

  const id = data.ada ? data.id : null;
  const perluTandai = data.ada && data.keadaan === "AKTIF" && !data.dibaca;
  useEffect(() => {
    if (!id || !perluTandai || sudahDitandai.current) return;
    sudahDitandai.current = true;
    void tandaiPengumumanDibacaAction(id)
      .then((r) => {
        if (r.ok && r.kabarDitandai > 0) window.dispatchEvent(new Event(KABAR_BERUBAH));
      })
      .catch(() => undefined);
  }, [id, perluTandai]);

  const kembali = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <TautanKembali cadangan="/pwa/pengumuman" />
    </Button>
  );

  if (!data.ada) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <Megaphone className="h-6 w-6" aria-hidden />
          </span>
          <p className="font-semibold">{td(`tidakTersedia.${data.alasan}`)}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("tidakTersediaHint")}</p>
        </section>
      </div>
    );
  }

  function konfirmasi() {
    if (!id) return;
    mulai(async () => {
      try {
        const r = await konfirmasiPengumumanAction(id);
        if (r.ok) {
          setDikonfirmasi(true);
          toast.success(t("okKonfirmasi"));
          window.dispatchEvent(new Event(KABAR_BERUBAH));
          router.refresh();
        } else {
          toast.error(td(`err.${r.kode}`));
          if (r.kode === "TIDAK_ADA") router.refresh();
        }
      } catch {
        toast.error(t("err.JARINGAN"));
      }
    });
  }

  const berakhir = data.keadaan === "KEDALUWARSA";

  return (
    <div className="space-y-4 p-4">
      {kembali}

      <article className="beranda-kartu space-y-3">
        <header className="space-y-1">
          {data.pinned ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
              <Pin className="h-3.5 w-3.5" aria-hidden />
              {t("disematkan")}
            </span>
          ) : null}
          <div className="flex items-center gap-1">
            <h1 className="min-w-0 break-words text-xl font-bold leading-tight">{data.title}</h1>
            <TombolBantuanHp judul={data.title} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">{t("terbitPada", { waktu: data.terbit })}</p>
        </header>
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{data.body}</p>
        {data.kedaluwarsa ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {berakhir ? t("sudahBerakhir", { waktu: data.kedaluwarsa }) : t("berlakuSampai", { waktu: data.kedaluwarsa })}
          </p>
        ) : null}
      </article>

      {data.requireAck ? (
        dikonfirmasi ? (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            {data.dikonfirmasiPada ? t("sudahDikonfirmasiPada", { waktu: data.dikonfirmasiPada }) : t("sudahDikonfirmasi")}
          </p>
        ) : berakhir ? null : (
          <section className="beranda-kartu space-y-3">
            <p className="text-sm">{t("mintaKonfirmasi")}</p>
            <Button className="h-12 w-full text-base" disabled={sibuk} onClick={konfirmasi}>
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              {t("sayaMengerti")}
            </Button>
          </section>
        )
      ) : null}
    </div>
  );
}
